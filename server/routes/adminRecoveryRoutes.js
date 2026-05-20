// server/routes/adminRecoveryRoutes.js
// Admin PIN recovery APIs: recovery email, OTP request, OTP verification and reset.

const express = require("express");
const {
  getAdminRecoveryEmail,
  getAdminRecoveryPublicHint,
  updateAdminRecoveryEmail,
  requestAdminPinOtp,
  verifyAdminPinOtp,
  resetAdminPinWithOtp
} = require("../services/adminPinService");
const { requirePermission } = require("../services/adminAccessService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.body?.adminToken || req.query?.adminToken || "";
}

router.get("/recovery", async (req, res) => {
  try {
    const data = await getAdminRecoveryEmail();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load recovery email.", details: err.details || null });
  }
});

router.get("/recovery/public", async (req, res) => {
  try {
    const data = await getAdminRecoveryPublicHint();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load recovery hint.", details: err.details || null });
  }
});

router.post("/recovery", async (req, res) => {
  try {
    requirePermission(getAccessToken(req), "pin");
    const data = await updateAdminRecoveryEmail(req.body?.email || "");
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save recovery email.", details: err.details || null });
  }
});

router.post("/forgot/request-otp", async (req, res) => {
  try {
    const data = await requestAdminPinOtp();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send recovery OTP.", details: err.details || null });
  }
});

router.post("/forgot/verify-otp", async (req, res) => {
  try {
    const data = await verifyAdminPinOtp(req.body?.resetToken || "", req.body?.otp || "");
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to verify OTP.", details: err.details || null });
  }
});

router.post("/forgot/reset", async (req, res) => {
  try {
    const data = await resetAdminPinWithOtp(req.body?.resetToken || "", req.body?.otp || "", req.body?.newPin || "");
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to reset PIN.", details: err.details || null });
  }
});

module.exports = router;
