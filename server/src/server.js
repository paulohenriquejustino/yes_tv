"use strict";

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const crypto = require("crypto");
const os = require("os");

const { readJson, writeJson } = require("./storage");

const PORT = process.env.PORT || 3000;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_LOG_ENTRIES = 200;

const BODY_LIMIT = process.env.BODY_LIMIT || "512mb";

const app = express();

const allowedOrigins = [
  "https://yes-tv-ab8fb.web.app",
  "https://api.blutv.online",
  "http://api.blutv.online",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
app.options("*", cors());
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

function catalogKey(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  if (item.id !== undefined && item.id !== null && item.id !== "") {
    return `id:${item.id}`;
  }
  if (typeof item.title === "string" && item.title.trim()) {
    return `title:${item.title.trim().toLowerCase()}`;
  }
  return null;
}

function mergeCatalogItems(existing, incoming, options = {}) {
  const replace = options.replace === true;
  const merged = [];
  const positionByKey = new Map();
  const existingKeys = new Set();
  const incomingKeys = new Set();
  let autoIndex = 0;

  function registerExisting(rawItem) {
    if (!rawItem || typeof rawItem !== "object") {
      return;
    }
    const item = { ...rawItem };
    const key = catalogKey(item) ?? `auto:${autoIndex++}`;
    existingKeys.add(key);
    if (replace) {
      return;
    }
    if (positionByKey.has(key)) {
      merged[positionByKey.get(key)] = item;
    } else {
      positionByKey.set(key, merged.length);
      merged.push(item);
    }
  }

  existing.forEach(registerExisting);

  function upsert(rawItem) {
    if (!rawItem || typeof rawItem !== "object") {
      return;
    }
    const item = { ...rawItem };
    const key = catalogKey(item) ?? `auto:${autoIndex++}`;
    incomingKeys.add(key);
    if (positionByKey.has(key)) {
      const index = positionByKey.get(key);
      merged[index] = item;
    } else {
      positionByKey.set(key, merged.length);
      merged.push(item);
    }
  }

  incoming.forEach(upsert);

  const stats = { added: 0, updated: 0 };
  incomingKeys.forEach((key) => {
    if (existingKeys.has(key)) {
      stats.updated += 1;
    } else {
      stats.added += 1;
    }
  });

  return { items: merged, stats };
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

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "YES TV API" });
});

app.get("/catalog", (_req, res) => {
  res.json(loadCatalog());
});

app.get("/admin/catalog", (_req, res) => {
  res.json({ items: loadCatalog() });
});

app.post("/admin/catalog", (req, res) => {
  const payload = req.body ?? {};
  const items = Array.isArray(payload.items) ? payload.items : null;
  if (!items) {
    return res.status(400).json({ error: "Campo 'items' deve ser uma lista." });
  }
  const mode =
    typeof payload.mode === "string"
      ? payload.mode.toLowerCase()
      : "replace";
  const replace = mode !== "merge";
  const current = loadCatalog();
  const { items: merged, stats } = mergeCatalogItems(current, items, {
    replace,
  });
  saveCatalog(merged);
  return res.json({
    ok: true,
    total: merged.length,
    received: items.length,
    added: stats.added,
    updated: stats.updated,
    mode: replace ? "replace" : "merge",
  });
});

app.delete("/admin/catalog", (_req, res) => {
  saveCatalog([]);
  res.json({ ok: true, total: 0 });
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
  logAccessUrls();
});

function logAccessUrls() {
  const interfaces = os.networkInterfaces();
  const lanAddresses = [];
  Object.values(interfaces).forEach((entries) => {
    entries
      ?.filter(
        (entry) => entry.family === "IPv4" && entry.internal !== true && entry.address,
      )
      .forEach((entry) => lanAddresses.push(entry.address));
  });

  const uniqueLan = [...new Set(lanAddresses)];
  if (uniqueLan.length) {
    console.log("Acesse pela rede local:");
    uniqueLan.forEach((address) => {
      console.log(`  → http://${address}:${PORT}`);
    });
  } else {
    console.log("Nenhum endereço de rede local detectado.");
  }
  console.log("Emuladores conhecidos:");
  console.log(`  → Android Emulator: http://10.0.2.2:${PORT}`);
  console.log(`  → iOS Simulator:   http://127.0.0.1:${PORT}`);
}
