// server/routes/systemConfigRoutes.js
// Protected routes for editing selected runtime .env settings.

const express = require("express");
const { getSystemConfig, saveSystemConfig } = require("../services/systemConfigService");
const { sendTestEmail } = require("../services/emailService");
const { requirePermission } = require("../services/adminAccessService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.headers["X-SPWT-Admin-Token"] || req.body?.adminToken || req.query?.adminToken || "";
}

function requireSystemConfig(req) {
  return requirePermission(getAccessToken(req), "systemConfig");
}

router.get("/settings", async (req, res) => {
  try {
    requireSystemConfig(req);
    res.json({ ok: true, data: getSystemConfig() });
  } catch (err) {
    console.error("GET /api/system-config/settings failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read system settings.", details: err.details || null });
  }
});

router.post("/settings", async (req, res) => {
  try {
    requireSystemConfig(req);
    res.json({ ok: true, data: saveSystemConfig(req.body || {}) });
  } catch (err) {
    console.error("POST /api/system-config/settings failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save system settings.", details: err.details || null });
  }
});

router.post("/test-email", async (req, res) => {
  try {
    requireSystemConfig(req);
    const to = String(req.body?.to || "").trim();
    const result = await sendTestEmail(to);
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("POST /api/system-config/test-email failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send test email.", details: err.details || null });
  }
});

module.exports = router;
