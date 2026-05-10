// server/routes/adminRoutes.js
// Admin/master-data API routes.

const express = require("express");
const { getAdminMasterData } = require("../services/adminMasterService");

const router = express.Router();

/**
 * GET /api/admin/master-data
 * Returns PocketBase master data in frontend-compatible adminOverrides format.
 */
router.get("/master-data", async (req, res) => {
  try {
    const data = await getAdminMasterData();

    res.json({
      ok: true,
      data
    });
  } catch (err) {
    console.error("GET /api/admin/master-data failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load admin master data",
      details: err.details || null
    });
  }
});

module.exports = router;