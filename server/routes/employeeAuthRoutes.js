// server/routes/employeeAuthRoutes.js
// Employee password reset/status for Admin and employee login for production entry.

const express = require("express");
const { requirePermission } = require("../services/adminAccessService");
const {
  listEmployeePasswordStatus,
  resetEmployeePassword,
  loginEmployee,
  verifyEmployeeSessionToken
} = require("../services/employeeAuthService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.body?.adminToken || req.query?.adminToken || "";
}

function requireEmployeePasswordAdmin(req) {
  const token = getAccessToken(req);
  try { return requirePermission(token, "employees"); }
  catch (err) { return requirePermission(token, "userAccess"); }
}

router.get("/admin/status", async (req, res) => {
  try {
    requireEmployeePasswordAdmin(req);
    const data = await listEmployeePasswordStatus();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/employee-auth/admin/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load employee password status", details: err.details || null });
  }
});

router.post("/admin/reset", async (req, res) => {
  try {
    requireEmployeePasswordAdmin(req);
    const data = await resetEmployeePassword(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/employee-auth/admin/reset failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to reset employee password", details: err.details || null });
  }
});

router.post("/login", async (req, res) => {
  try {
    const data = await loginEmployee(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/employee-auth/login failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Employee password verification failed", details: err.details || null });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const empCode = req.body?.empCode || req.body?.emp_code || "";
    const token = req.body?.token || req.body?.employeeAuthToken || "";
    res.json({ ok: true, data: { valid: verifyEmployeeSessionToken(empCode, token) } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Employee token verify failed", details: err.details || null });
  }
});

module.exports = router;
