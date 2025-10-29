"use strict";

const fs = require("fs");
const path = require("path");

const dataRoot = path.join(__dirname, "..", "data");

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

module.exports = {
  readJson,
  writeJson,
};
