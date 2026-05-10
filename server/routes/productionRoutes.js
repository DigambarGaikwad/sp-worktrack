// server/routes/productionRoutes.js
// SP WorkTrack DB Edition - Production API routes

const express = require("express");
const { submitProduction } = require("../services/productionSubmitService");

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

module.exports = router;