// server/services/maintenanceOtpService.js
// OTP verification for dangerous Maintenance actions.

const crypto = require("crypto");
const { getAdminRecoveryEmail } = require("./adminPinService");
const { sendEmail } = require("./emailService");

const OTP_TTL_MS = 10 * 60 * 1000;
const VERIFIED_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();

function clean(value) { return String(value ?? "").trim(); }
function hash(value) { return crypto.createHash("sha256").update(clean(value)).digest("hex"); }
function generateOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }

function normalizeAction(action) {
  const value = clean(action || "maintenance_action").toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 80);
  return value || "maintenance_action";
}

async function requestMaintenanceOtp(action = "maintenance_action") {
  const recovery = await getAdminRecoveryEmail();
  if (!recovery.configured || !recovery.email) {
    const err = new Error("Recovery email is not configured. Add recovery email in Change PIN tab first.");
    err.status = 400;
    err.details = { reasonCode: "RECOVERY_EMAIL_NOT_CONFIGURED" };
    throw err;
  }

  const otp = generateOtp();
  const requestToken = crypto.randomBytes(24).toString("hex");
  const actionName = normalizeAction(action);

  sessions.set(requestToken, {
    action: actionName,
    otpHash: hash(otp),
    email: recovery.email,
    expiresAt: Date.now() + OTP_TTL_MS,
    verifiedUntil: 0
  });

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  await sendEmail({
    to: recovery.email,
    subject: "SP WorkTrack Maintenance OTP",
    text: `Your SP WorkTrack Maintenance OTP is ${otp}. It is valid for 10 minutes.\n\nAction: ${actionName}\nRequested at: ${now}\n\nIf you did not request this, contact admin immediately.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;">
        <h2>SP WorkTrack Maintenance Verification</h2>
        <p>OTP for Maintenance action:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0;">${otp}</div>
        <p><b>Action:</b> ${actionName}</p>
        <p>This OTP is valid for <b>10 minutes</b>. After verification, action permission is valid for <b>5 minutes</b>.</p>
        <p><b>Requested at:</b> ${now}</p>
        <p>If you did not request this, contact admin immediately.</p>
      </div>`
  });

  return { requestToken, maskedEmail: recovery.maskedEmail, expiresInMinutes: 10, action: actionName };
}

function getSession(requestToken) {
  const token = clean(requestToken);
  const session = sessions.get(token);
  if (!token || !session) {
    const err = new Error("Maintenance OTP session not found. Request OTP again.");
    err.status = 400;
    throw err;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    const err = new Error("Maintenance OTP expired. Request a new OTP.");
    err.status = 400;
    throw err;
  }
  return session;
}

function verifyMaintenanceOtp(requestToken, otp, action = "maintenance_action") {
  const session = getSession(requestToken);
  const actionName = normalizeAction(action);
  if (session.action !== actionName) {
    const err = new Error("OTP action does not match this maintenance action.");
    err.status = 400;
    throw err;
  }
  if (session.otpHash !== hash(otp)) {
    const err = new Error("Invalid Maintenance OTP.");
    err.status = 400;
    throw err;
  }
  session.verifiedUntil = Date.now() + VERIFIED_TTL_MS;
  return { ok: true, action: actionName, verifiedForMinutes: 5 };
}

function requireMaintenanceOtp({ requestToken = "", otp = "", action = "maintenance_action" } = {}) {
  const session = getSession(requestToken);
  const actionName = normalizeAction(action);
  if (session.action !== actionName) {
    const err = new Error("OTP action does not match this maintenance action.");
    err.status = 400;
    throw err;
  }
  if (session.otpHash !== hash(otp)) {
    const err = new Error("Invalid Maintenance OTP.");
    err.status = 400;
    throw err;
  }
  session.verifiedUntil = Date.now() + VERIFIED_TTL_MS;
  return true;
}

module.exports = { requestMaintenanceOtp, verifyMaintenanceOtp, requireMaintenanceOtp, normalizeAction };
