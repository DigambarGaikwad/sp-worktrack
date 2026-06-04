// server/routes/reportRoutes.js
// Operational report API routes.

const express = require("express");
const { getReworkOtherReport } = require("../services/reworkOtherReportService");

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

module.exports = router;
