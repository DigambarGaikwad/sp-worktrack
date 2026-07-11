// server/routes/capacityRoutes.js
// Capacity Planning read-only API routes.

const express = require("express");
const { listProductionProgress } = require("../services/capacityPlanningService");

const router = express.Router();

router.get("/progress", async (req, res) => {
  try {
    const data = await listProductionProgress(req.query || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/capacity/progress failed:", err);
    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load capacity production progress.",
      details: err.details || null
    });
  }
});

module.exports = router;
