// server/routes/dashboardRoutes.js
// SP WorkTrack DB Edition - Dashboard API routes

const express = require("express");

const {
  getMachineSummary,
  getMachineDetail,
  getLossSummary,
  getMachineCompletionReport
} = require("../services/dashboardServiceV2");

const {
  getPeopleDashboard
} = require("../services/peopleDashboardServiceV6");

const router = express.Router();

router.get("/machine-summary", async (req, res) => {
  try {
    const data = await getMachineSummary(req.query);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/dashboard/machine-summary failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load machine dashboard summary.", details: err.details || null });
  }
});

router.get("/machine-detail", async (req, res) => {
  try {
    const data = await getMachineDetail(req.query);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/dashboard/machine-detail failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load machine dashboard detail.", details: err.details || null });
  }
});

router.get("/loss-summary", async (req, res) => {
  try {
    const data = await getLossSummary(req.query);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/dashboard/loss-summary failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load loss summary.", details: err.details || null });
  }
});

router.get("/machine-completion-report", async (req, res) => {
  try {
    const data = await getMachineCompletionReport(req.query);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/dashboard/machine-completion-report failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load machine completion report.", details: err.details || null });
  }
});

router.get("/people", async (req, res) => {
  try {
    const data = await getPeopleDashboard(req.query);
    data.meta = {
      ...(data.meta || {}),
      service: data.meta?.service || "peopleDashboardServiceV6",
      scoringVersion: "people-score-v3-year-month-2026-06-04"
    };
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/dashboard/people failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load people dashboard.", details: err.details || null });
  }
});

module.exports = router;
