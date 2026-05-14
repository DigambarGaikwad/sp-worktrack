// server/routes/adminRoutes.js
// Admin/master-data API routes.

const express = require("express");
const { getAdminMasterData } = require("../services/adminMasterService");
const {
  saveAdminMasterData,
  listPlannedAbsences,
  savePlannedAbsence,
  deletePlannedAbsence,
  listSkillMatrix,
  saveSkillMatrix,
  deleteSkillMatrix
} = require("../services/adminWriteServiceV2");
const {
  getAdminPin,
  verifyAdminPin,
  updateAdminPin
} = require("../services/adminPinService");

const router = express.Router();

router.get("/master-data", async (req, res) => {
  try {
    const data = await getAdminMasterData();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/master-data failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load admin master data", details: err.details || null });
  }
});

router.get("/pin/status", async (req, res) => {
  try {
    await getAdminPin();
    res.json({ ok: true, pinConfigured: true });
  } catch (err) {
    console.error("GET /api/admin/pin/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read admin PIN status", details: err.details || null });
  }
});

router.post("/pin/verify", async (req, res) => {
  try {
    const valid = await verifyAdminPin(req.body?.pin || "");
    res.json({ ok: true, valid });
  } catch (err) {
    console.error("POST /api/admin/pin/verify failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to verify admin PIN", details: err.details || null });
  }
});

router.post("/pin/update", async (req, res) => {
  try {
    const result = await updateAdminPin(req.body?.newPin || req.body?.pin || "");
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("POST /api/admin/pin/update failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to update admin PIN", details: err.details || null });
  }
});

router.post("/save-master-data", async (req, res) => {
  try {
    const result = await saveAdminMasterData(req.body || {});
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("POST /api/admin/save-master-data failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save admin master data", details: err.details || null });
  }
});

router.get("/planned-absences", async (req, res) => {
  try {
    const items = await listPlannedAbsences(req.query || {});
    res.json({ ok: true, items });
  } catch (err) {
    console.error("GET /api/admin/planned-absences failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load planned absences", details: err.details || null });
  }
});

router.post("/planned-absences", async (req, res) => {
  try {
    const item = await savePlannedAbsence(req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    console.error("POST /api/admin/planned-absences failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save planned absence", details: err.details || null });
  }
});

router.delete("/planned-absences/:id", async (req, res) => {
  try {
    await deletePlannedAbsence(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/planned-absences failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to delete planned absence", details: err.details || null });
  }
});

router.get("/skill-matrix", async (req, res) => {
  try {
    const items = await listSkillMatrix(req.query || {});
    res.json({ ok: true, items });
  } catch (err) {
    console.error("GET /api/admin/skill-matrix failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load skill matrix", details: err.details || null });
  }
});

router.post("/skill-matrix", async (req, res) => {
  try {
    const items = await saveSkillMatrix(req.body || {});
    res.json({ ok: true, items });
  } catch (err) {
    console.error("POST /api/admin/skill-matrix failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save skill matrix", details: err.details || null });
  }
});

router.delete("/skill-matrix/:id", async (req, res) => {
  try {
    await deleteSkillMatrix(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/skill-matrix failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to delete skill matrix", details: err.details || null });
  }
});

module.exports = router;
