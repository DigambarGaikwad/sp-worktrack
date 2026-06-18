// server/routes/transferRoutes.js
// Admin-only database transfer package endpoints.

const express = require("express");
const path = require("path");
const {
  getDatabaseTransferStatus,
  createTransferPackage,
  listTransferPackages,
  resolvePackagePath
} = require("../services/databaseTransferService");
const { requirePermission } = require("../services/adminAccessService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.body?.adminToken || req.query?.adminToken || "";
}

function requireDatabaseTransfer(req) {
  return requirePermission(getAccessToken(req), "databaseTransfer");
}

router.get("/status", async (req, res) => {
  try {
    requireDatabaseTransfer(req);
    const data = await getDatabaseTransferStatus();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/transfer/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read database transfer status.", details: err.details || null });
  }
});

router.get("/packages", async (req, res) => {
  try {
    requireDatabaseTransfer(req);
    const data = await listTransferPackages();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/transfer/packages failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to list transfer packages.", details: err.details || null });
  }
});

router.post("/package", async (req, res) => {
  try {
    requireDatabaseTransfer(req);
    const data = await createTransferPackage(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/package failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to create transfer package.", details: err.details || null });
  }
});

router.get("/package/download/:fileName", async (req, res) => {
  try {
    requireDatabaseTransfer(req);
    const fullPath = await resolvePackagePath(req.params.fileName);
    res.download(fullPath, path.basename(fullPath));
  } catch (err) {
    console.error("GET /api/transfer/package/download failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to download transfer package.", details: err.details || null });
  }
});

module.exports = router;