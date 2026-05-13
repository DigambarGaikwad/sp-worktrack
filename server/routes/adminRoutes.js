// server/routes/adminRoutes.js
// Admin/master-data API routes.

const express = require("express");
const { getAdminMasterData } = require("../services/adminMasterService");
const {
  saveAdminMasterData,
  listPlannedAbsences,
  savePlannedAbsence,
  deletePlannedAbsence
} = require("../services/adminWriteService");

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

/**
 * POST /api/admin/save-master-data
 * Saves admin screen master data into PocketBase using safe upsert logic.
 * This route does not delete missing old records automatically.
 */
router.post("/save-master-data", async (req, res) => {
  try {
    const result = await saveAdminMasterData(req.body || {});

    res.json({
      ok: true,
      data: result
    });
  } catch (err) {
    console.error("POST /api/admin/save-master-data failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to save admin master data",
      details: err.details || null
    });
  }
});

/**
 * GET /api/admin/planned-absences
 * Lists planned absences.
 */
router.get("/planned-absences", async (req, res) => {
  try {
    const items = await listPlannedAbsences(req.query || {});

    res.json({
      ok: true,
      items
    });
  } catch (err) {
    console.error("GET /api/admin/planned-absences failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to load planned absences",
      details: err.details || null
    });
  }
});

/**
 * POST /api/admin/planned-absences
 * Creates or updates a planned absence.
 */
router.post("/planned-absences", async (req, res) => {
  try {
    const item = await savePlannedAbsence(req.body || {});

    res.json({
      ok: true,
      item
    });
  } catch (err) {
    console.error("POST /api/admin/planned-absences failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to save planned absence",
      details: err.details || null
    });
  }
});

/**
 * DELETE /api/admin/planned-absences/:id
 * Deletes a planned absence record.
 */
router.delete("/planned-absences/:id", async (req, res) => {
  try {
    await deletePlannedAbsence(req.params.id);

    res.json({
      ok: true
    });
  } catch (err) {
    console.error("DELETE /api/admin/planned-absences failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to delete planned absence",
      details: err.details || null
    });
  }
});

module.exports = router;