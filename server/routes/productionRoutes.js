// server/routes/productionRoutes.js
// SP WorkTrack DB Edition - Production API routes

const express = require("express");

const {
  submitProduction,
  getBookingStatus,
  getQualityStatus
} = require("../services/productionSubmitService");

const router = express.Router();

/**
 * POST /api/production/submit
 * Saves production entry into PocketBase transaction collections.
 */
router.post("/submit", async (req, res) => {
  try {
    const result = await submitProduction(req.body);

    res.json({
      ok: true,
      message: "Production entry saved successfully.",
      ...result
    });
  } catch (err) {
    console.error("POST /api/production/submit failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to submit production entry.",
      details: err.details || null
    });
  }
});

/**
 * GET /api/production/booking-status
 * Returns current booking point status from PocketBase.
 */
router.get("/booking-status", async (req, res) => {
  try {
    const items = await getBookingStatus(req.query);

    res.json({
      ok: true,
      count: items.length,
      items
    });
  } catch (err) {
    console.error("GET /api/production/booking-status failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load booking status.",
      details: err.details || null
    });
  }
});

/**
 * GET /api/production/quality-status
 * Returns latest quality point status from PocketBase.
 */
router.get("/quality-status", async (req, res) => {
  try {
    const items = await getQualityStatus(req.query);

    res.json({
      ok: true,
      count: items.length,
      items
    });
  } catch (err) {
    console.error("GET /api/production/quality-status failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load quality status.",
      details: err.details || null
    });
  }
});

module.exports = router;