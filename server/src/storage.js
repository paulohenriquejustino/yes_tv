"use strict";

const fs = require("fs");
const path = require("path");

const dataRoot = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.join(__dirname, "..", "data");

if (!fs.existsSync(dataRoot)) {
  fs.mkdirSync(dataRoot, { recursive: true });
}

function _safePath(filename) {
  return path.join(dataRoot, filename);
}

function readJson(filename, fallback) {
  const filePath = _safePath(filename);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw err;
  }
}

function writeJson(filename, data) {
  const filePath = _safePath(filename);
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, filePath);
}

function loadImportLogs() {
  return readJson("import_logs.json", []);
}

function saveImportLogs(items) {
  writeJson("import_logs.json", items);
}

module.exports = {
  readJson,
  writeJson,
  loadImportLogs,
  saveImportLogs,
};
