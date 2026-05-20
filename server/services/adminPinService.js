// server/services/adminPinService.js
// DB-only admin PIN service.
// Stores Admin PIN and recovery email in PocketBase collection: admin_settings
// Supports forgot PIN OTP recovery using SMTP email.

const crypto = require("crypto");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { sendEmail } = require("./emailService");

const COLLECTION = "admin_settings";
const PIN_KEY = "admin_pin";
const RECOVERY_EMAIL_KEY = "admin_recovery_email";
const DEFAULT_PIN = "1234";
const OTP_TTL_MS = 10 * 60 * 1000;

const otpSessions = new Map();

function clean(value) {
  return String(value ?? "").trim();
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

function textField(name, required = false) {
  return {
    name,
    type: "text",
    system: false,
    required,
    presentable: false,
    unique: name === "setting_key",
    options: {
      min: null,
      max: null,
      pattern: ""
    }
  };
}

function isValidEmail(value) {
  const email = clean(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskEmail(value) {
  const email = clean(value);
  if (!email || !email.includes("@")) return "";
  const [name, domain] = email.split("@");
  const maskedName = name.length <= 2 ? `${name.slice(0, 1)}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  const parts = domain.split(".");
  const domainMain = parts[0] || "";
  const tld = parts.slice(1).join(".");
  const maskedDomain = domainMain.length <= 2 ? `${domainMain.slice(0, 1)}*` : `${domainMain.slice(0, 2)}***`;
  return `${maskedName}@${maskedDomain}${tld ? "." + tld : ""}`;
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(clean(otp)).digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function ensureCollection() {
  let collection = null;

  try {
    collection = await pocketBaseRequest(`/api/collections/${COLLECTION}`, { method: "GET" });
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err;
  }

  if (!collection) {
    const payloads = [
      {
        name: COLLECTION,
        type: "base",
        system: false,
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [textField("setting_key", true), textField("setting_value", false)]
      },
      {
        name: COLLECTION,
        type: "base",
        system: false,
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
        schema: [textField("setting_key", true), textField("setting_value", false)]
      }
    ];

    let lastErr = null;
    for (const payload of payloads) {
      try {
        return await pocketBaseRequest("/api/collections", { method: "POST", body: payload });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  return collection;
}

async function listSettings(key) {
  await ensureCollection();
  const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
    method: "GET",
    query: {
      page: 1,
      perPage: 50,
      filter: `setting_key="${key}"`
    }
  });

  return Array.isArray(result.items) ? result.items : [];
}

async function getSettingRecord(key) {
  const items = await listSettings(key);
  return items[0] || null;
}

async function getSettingValue(key, defaultValue = "") {
  const record = await getSettingRecord(key);
  return clean(record?.setting_value || defaultValue);
}

async function upsertSettingValue(key, value) {
  await ensureCollection();
  const existing = await getSettingRecord(key);

  if (existing?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${existing.id}`, {
      method: "PATCH",
      body: { setting_value: clean(value) }
    });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "POST",
      body: { setting_key: key, setting_value: clean(value) }
    });
  }
}

async function getPinRecord() {
  return getSettingRecord(PIN_KEY);
}

async function getAdminPin() {
  const savedPin = await getSettingValue(PIN_KEY, "");

  if (savedPin) return savedPin;

  await upsertSettingValue(PIN_KEY, DEFAULT_PIN);
  return DEFAULT_PIN;
}

async function verifyAdminPin(pin) {
  const savedPin = await getAdminPin();
  return clean(pin) === clean(savedPin);
}

async function updateAdminPin(newPin) {
  const pin = clean(newPin);

  if (!pin) {
    const err = new Error("New PIN cannot be blank.");
    err.status = 400;
    throw err;
  }

  if (pin.length < 4) {
    const err = new Error("New PIN must be at least 4 characters.");
    err.status = 400;
    throw err;
  }

  await upsertSettingValue(PIN_KEY, pin);
  return { ok: true, message: "Admin PIN updated in DB." };
}

async function getAdminRecoveryEmail() {
  const email = await getSettingValue(RECOVERY_EMAIL_KEY, "");
  return {
    configured: Boolean(email),
    email,
    maskedEmail: maskEmail(email)
  };
}

async function getAdminRecoveryPublicHint() {
  const email = await getSettingValue(RECOVERY_EMAIL_KEY, "");
  return {
    configured: Boolean(email),
    maskedEmail: maskEmail(email)
  };
}

async function updateAdminRecoveryEmail(emailValue) {
  const email = clean(emailValue).toLowerCase();
  if (email && !isValidEmail(email)) {
    const err = new Error("Enter a valid recovery email address.");
    err.status = 400;
    throw err;
  }

  await upsertSettingValue(RECOVERY_EMAIL_KEY, email);
  return {
    ok: true,
    configured: Boolean(email),
    email,
    maskedEmail: maskEmail(email),
    message: email ? "Recovery email updated." : "Recovery email cleared."
  };
}

async function requestAdminPinOtp() {
  const recovery = await getAdminRecoveryEmail();
  if (!recovery.configured || !recovery.email) {
    const err = new Error("Recovery email is not configured. Login as admin and add recovery email first.");
    err.status = 400;
    err.details = { reasonCode: "RECOVERY_EMAIL_NOT_CONFIGURED" };
    throw err;
  }

  const otp = generateOtp();
  const resetToken = crypto.randomBytes(24).toString("hex");
  otpSessions.set(resetToken, {
    otpHash: hashOtp(otp),
    email: recovery.email,
    expiresAt: Date.now() + OTP_TTL_MS,
    verified: false
  });

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  await sendEmail({
    to: recovery.email,
    subject: "SP WorkTrack Admin PIN Recovery OTP",
    text: `Your SP WorkTrack Admin PIN recovery OTP is ${otp}. It is valid for 10 minutes.\n\nRequested at: ${now}\n\nIf you did not request this, please ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;">
        <h2>SP WorkTrack Admin PIN Recovery</h2>
        <p>Your OTP is:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0;">${otp}</div>
        <p>This OTP is valid for <b>10 minutes</b>.</p>
        <p><b>Requested at:</b> ${now}</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `
  });

  return {
    ok: true,
    resetToken,
    maskedEmail: recovery.maskedEmail,
    expiresInMinutes: 10
  };
}

function getOtpSession(resetToken) {
  const token = clean(resetToken);
  const session = otpSessions.get(token);
  if (!token || !session) {
    const err = new Error("OTP session not found. Please request OTP again.");
    err.status = 400;
    throw err;
  }
  if (Date.now() > session.expiresAt) {
    otpSessions.delete(token);
    const err = new Error("OTP expired. Please request a new OTP.");
    err.status = 400;
    throw err;
  }
  return session;
}

async function verifyAdminPinOtp(resetToken, otp) {
  const session = getOtpSession(resetToken);
  const valid = session.otpHash === hashOtp(otp);
  if (!valid) return { ok: true, valid: false };
  session.verified = true;
  return { ok: true, valid: true };
}

async function resetAdminPinWithOtp(resetToken, otp, newPin) {
  const session = getOtpSession(resetToken);
  if (session.otpHash !== hashOtp(otp)) {
    const err = new Error("Invalid OTP.");
    err.status = 400;
    throw err;
  }

  await updateAdminPin(newPin);
  otpSessions.delete(clean(resetToken));
  return { ok: true, message: "Admin PIN reset successful. Login with the new PIN." };
}

module.exports = {
  getAdminPin,
  verifyAdminPin,
  updateAdminPin,
  getAdminRecoveryEmail,
  getAdminRecoveryPublicHint,
  updateAdminRecoveryEmail,
  requestAdminPinOtp,
  verifyAdminPinOtp,
  resetAdminPinWithOtp
};