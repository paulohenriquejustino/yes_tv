"use strict";

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const crypto = require("crypto");

const { readJson, writeJson } = require("./storage");

const PORT = process.env.PORT || 3000;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_LOG_ENTRIES = 200;

const BODY_LIMIT = process.env.BODY_LIMIT || "150mb";

const app = express();

app.use(cors());
app.use(
  express.json({
    limit: BODY_LIMIT,
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: BODY_LIMIT,
  })
);
app.use(morgan("dev"));

const otpCache = new Map();

function now() {
  return Date.now();
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOtp(phone, code) {
  otpCache.set(phone, { code, expiresAt: now() + OTP_TTL_MS });
}

function validateOtp(phone, code) {
  const entry = otpCache.get(phone);
  if (!entry) {
    return false;
  }
  if (entry.expiresAt < now()) {
    otpCache.delete(phone);
    return false;
  }
  const ok = entry.code === code;
  if (ok) {
    otpCache.delete(phone);
  }
  return ok;
}

function loadCatalog() {
  return readJson("catalog.json", []);
}

function saveCatalog(items) {
  writeJson("catalog.json", items);
}

function loadClients() {
  return readJson("clients.json", []);
}

function saveClients(items) {
  writeJson("clients.json", items);
}

function loadLogs() {
  return readJson("logs.json", []);
}

function saveLogs(items) {
  writeJson("logs.json", items);
}

function ensureClientByPhone(phone) {
  const normalized = phone.trim();
  if (!normalized) {
    return null;
  }
  const clients = loadClients();
  let client = clients.find((item) => item.phone === normalized);
  if (!client) {
    client = {
      id: crypto.randomUUID(),
      name: `Cliente ${normalized}`,
      phone: normalized,
      status: "pending",
      createdAt: new Date().toISOString(),
      validatedAt: null,
    };
    clients.push(client);
    saveClients(clients);
  }
  return client;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/catalog", (_req, res) => {
  res.json(loadCatalog());
});

app.get("/admin/catalog", (_req, res) => {
  res.json({ items: loadCatalog() });
});

app.post("/admin/catalog", (req, res) => {
  const payload = req.body;
  const items = payload && Array.isArray(payload.items) ? payload.items : null;
  if (!items) {
    return res.status(400).json({ error: "Campo 'items' deve ser uma lista." });
  }
  saveCatalog(items);
  return res.json({ ok: true, count: items.length });
});

app.get("/logs/playback", (_req, res) => {
  const logs = loadLogs();
  res.json(logs);
});

app.post("/logs/playback", (req, res) => {
  const logs = loadLogs();
  const entry = {
    id: crypto.randomUUID(),
    event: req.body?.event ?? "unknown",
    source: req.body?.source ?? "",
    contentId: req.body?.contentId ?? null,
    reason: req.body?.reason ?? null,
    timestamp: new Date().toISOString(),
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.length = MAX_LOG_ENTRIES;
  }
  saveLogs(logs);
  res.status(201).json(entry);
});

app.get("/admin/clients", (_req, res) => {
  res.json(loadClients());
});

app.patch("/admin/clients/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!status) {
    return res.status(400).json({ error: "Campo 'status' é obrigatório." });
  }
  const clients = loadClients();
  const index = clients.findIndex((client) => client.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Cliente não encontrado." });
  }
  clients[index] = {
    ...clients[index],
    status,
    validatedAt:
      status.toLowerCase() === "active"
        ? new Date().toISOString()
        : clients[index].validatedAt,
  };
  saveClients(clients);
  res.json(clients[index]);
});

app.post("/auth/request-otp", (req, res) => {
  const phone = req.body?.phone?.toString().trim();
  if (!phone) {
    return res.status(400).json({ error: "Informe o telefone." });
  }
  const code = generateOtp();
  ensureClientByPhone(phone);
  storeOtp(phone, code);
  console.log(`[OTP] Código gerado para ${phone}: ${code}`);
  res.json({ ok: true });
});

app.post("/auth/resend-otp", (req, res) => {
  const phone = req.body?.phone?.toString().trim();
  if (!phone) {
    return res.status(400).json({ error: "Informe o telefone." });
  }
  const code = generateOtp();
  ensureClientByPhone(phone);
  storeOtp(phone, code);
  console.log(`[OTP] Código re-enviado para ${phone}: ${code}`);
  res.json({ ok: true });
});

app.get("/users", (req, res) => {
  const phone = req.query?.phone?.toString().trim();
  const otp = req.query?.otp?.toString().trim();
  if (!phone || !otp) {
    return res.json([]);
  }
  if (!validateOtp(phone, otp)) {
    return res.json([]);
  }

  const clients = loadClients();
  const client =
    clients.find((item) => item.phone === phone) ?? ensureClientByPhone(phone);

  res.json([
    {
      id: client.id,
      name: client.name,
      phone: client.phone,
      status: client.status ?? "pending",
    },
  ]);
});

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

app.listen(PORT, () => {
  console.log(`YES TV API rodando na porta ${PORT}`);
});
