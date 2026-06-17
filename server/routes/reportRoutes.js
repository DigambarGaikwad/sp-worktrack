// server/routes/reportRoutes.js
// Operational report API routes.

const express = require("express");
const { getReworkOtherReport } = require("../services/reworkOtherReportService");
const { getOvertimeReport } = require("../services/overtimeReportService");
const { getLossHoursReport } = require("../services/lossHoursReportService");

const router = express.Router();

router.get("/rework-other", async (req, res) => {
  try {
    const data = await getReworkOtherReport(req.query || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/reports/rework-other failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to build rework/other work report.", details: err.details || null });
  }
});

router.get("/loss-hours", async (req, res) => {
  try {
    const data = await getLossHoursReport(req.query || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/reports/loss-hours failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to build loss hours report.", details: err.details || null });
  }
});

router.get("/overtime", async (req, res) => {
  try {
    const data = await getOvertimeReport(req.query || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/reports/overtime failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to build overtime report" });
  }
});

module.exports = router;
