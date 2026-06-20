// server/routes/systemRoutes.js
// Admin-only system/network info endpoints.

const express = require("express");
const { getSystemInfo } = require("../services/systemInfoService");
const { requirePermission } = require("../services/adminAccessService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.headers["X-SPWT-Admin-Token"] || req.body?.adminToken || req.query?.adminToken || "";
}

function requireSystemInfo(req) {
  return requirePermission(getAccessToken(req), "systemInfo");
}

router.get("/info", async (req, res) => {
  try {
    requireSystemInfo(req);
    const data = await getSystemInfo(req);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/system/info failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read system info.", details: err.details || null });
  }
});

module.exports = router;
