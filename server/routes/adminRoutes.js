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
} = require("../services/adminWriteServiceV3");
const { saveEmployeeAvailableMinutes } = require("../services/employeeCapacityService");
const {
  getAdminPin,
  verifyAdminPin,
  updateAdminPin
} = require("../services/adminPinService");
const {
  listAccessUsers,
  upsertAccessUsers,
  loginAdminAccess,
  requirePermission,
  getSessionUser,
  userCan
} = require("../services/adminAccessService");
const {
  getAdminControls,
  saveAdminControls
} = require("../services/adminControlService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.body?.adminToken || req.query?.adminToken || "";
}

function requireAdminPermission(req, permission) {
  return requirePermission(getAccessToken(req), permission);
}

function requireAdminSession(req) {
  const user = getSessionUser(getAccessToken(req));
  if (!user) {
    const err = new Error("Login session required.");
    err.status = 401;
    throw err;
  }
  return user;
}

router.get("/master-data", async (req, res) => {
  try {
    const data = await getAdminMasterData();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/master-data failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load admin master data", details: err.details || null });
  }
});

router.get("/controls", async (req, res) => {
  try {
    const data = await getAdminControls();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/controls failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load admin controls", details: err.details || null });
  }
});

router.post("/controls", async (req, res) => {
  try {
    requireAdminPermission(req, "adminControls");
    const data = await saveAdminControls(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/controls failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save admin controls", details: err.details || null });
  }
});

router.post("/master-data", async (req, res) => {
  try {
    const user = requireAdminSession(req);
    const canEditMaster = userCan(user, "masterData");
    const canEditStandardTime = userCan(user, "standardTime");
    const data = await saveAdminMasterData(req.body || {}, { canEditMaster, canEditStandardTime });
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/master-data failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save admin master data", details: err.details || null });
  }
});

router.get("/pin", async (req, res) => {
  try {
    const data = await getAdminPin();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/pin failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load admin PIN", details: err.details || null });
  }
});

router.post("/pin/verify", async (req, res) => {
  try {
    const data = await verifyAdminPin(req.body?.pin);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/pin/verify failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "PIN verify failed", details: err.details || null });
  }
});

router.post("/pin", async (req, res) => {
  try {
    requireAdminPermission(req, "pin");
    const data = await updateAdminPin(req.body?.newPin || req.body?.pin || req.body || "");
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/pin failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "PIN update failed", details: err.details || null });
  }
});

router.get("/access-users", async (req, res) => {
  try {
    requireAdminPermission(req, "userAccess");
    const data = await listAccessUsers();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/access-users failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to list access users", details: err.details || null });
  }
});

router.post("/access-users", async (req, res) => {
  try {
    requireAdminPermission(req, "userAccess");
    const data = await upsertAccessUsers(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/access-users failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save access users", details: err.details || null });
  }
});

router.post("/access/login", async (req, res) => {
  try {
    const data = await loginAdminAccess(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/access/login failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Access login failed", details: err.details || null });
  }
});

router.get("/planned-absences", async (req, res) => {
  try {
    const data = await listPlannedAbsences(req.query || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/planned-absences failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to list planned absences", details: err.details || null });
  }
});

router.post("/planned-absences", async (req, res) => {
  try {
    const data = await savePlannedAbsence(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/planned-absences failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save planned absence", details: err.details || null });
  }
});

router.delete("/planned-absences/:id", async (req, res) => {
  try {
    const data = await deletePlannedAbsence(req.params.id);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("DELETE /api/admin/planned-absences/:id failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to delete planned absence", details: err.details || null });
  }
});

router.get("/skill-matrix", async (req, res) => {
  try {
    const data = await listSkillMatrix(req.query || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/admin/skill-matrix failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to list skill matrix", details: err.details || null });
  }
});

router.post("/skill-matrix", async (req, res) => {
  try {
    const data = await saveSkillMatrix(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/admin/skill-matrix failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save skill matrix", details: err.details || null });
  }
});

router.delete("/skill-matrix/:id", async (req, res) => {
  try {
    const data = await deleteSkillMatrix(req.params.id);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("DELETE /api/admin/skill-matrix/:id failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to delete skill matrix", details: err.details || null });
  }
});

module.exports = router;
