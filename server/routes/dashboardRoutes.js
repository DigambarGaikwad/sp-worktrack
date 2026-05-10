// server/routes/dashboardRoutes.js
// SP WorkTrack DB Edition - Dashboard API routes

const express = require("express");

const {
  getMachineSummary,
  getMachineDetail
} = require("../services/dashboardService");

const router = express.Router();

/**
 * GET /api/dashboard/machine-summary
 * Returns machine-wise summary cards from PocketBase.
 */
router.get("/machine-summary", async (req, res) => {
  try {
    const data = await getMachineSummary(req.query);

    res.json({
      ok: true,
      data
    });
  } catch (err) {
    console.error("GET /api/dashboard/machine-summary failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load machine dashboard summary.",
      details: err.details || null
    });
  }
});

/**
 * GET /api/dashboard/machine-detail?machine=MNGL%2026020
 * Returns detailed machine dashboard data from PocketBase.
 */
router.get("/machine-detail", async (req, res) => {
  try {
    const data = await getMachineDetail(req.query);

    res.json({
      ok: true,
      data
    });
  } catch (err) {
    console.error("GET /api/dashboard/machine-detail failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load machine dashboard detail.",
      details: err.details || null
    });
  }
});

module.exports = router;