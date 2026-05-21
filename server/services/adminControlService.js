// server/services/adminControlService.js
// Stores configurable admin control rules in admin_settings collection.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const CONTROL_KEY = "admin_controls_json";

const DEFAULT_CONTROLS = {
  overrunReasonEnabled: true,
  overrunReasonLimitPct: 120,
  bookingExtraReasonEnabled: true
};

function clean(value) {
  return String(value ?? "").trim();
}

function bool(value, defaultValue = false) {
  if (value === true || value === false) return value;
  const text = clean(value).toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(text)) return true;
  if (["false", "0", "no", "off", "disabled"].includes(text)) return false;
  return defaultValue;
}

function numberInRange(value, defaultValue, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

async function findSettingRecord(key) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: {
        page: 1,
        perPage: 1,
        filter: `setting_key="${key}"`
      }
    });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) {
    if (isMissingCollectionError(err)) return null;
    throw err;
  }
}

function normalizeAdminControls(raw = {}) {
  return {
    overrunReasonEnabled: bool(raw.overrunReasonEnabled, DEFAULT_CONTROLS.overrunReasonEnabled),
    overrunReasonLimitPct: numberInRange(
      raw.overrunReasonLimitPct,
      DEFAULT_CONTROLS.overrunReasonLimitPct,
      100,
      300
    ),
    bookingExtraReasonEnabled: bool(raw.bookingExtraReasonEnabled, DEFAULT_CONTROLS.bookingExtraReasonEnabled)
  };
}

async function getAdminControls() {
  const rec = await findSettingRecord(CONTROL_KEY);
  const saved = safeJsonParse(rec?.setting_value, DEFAULT_CONTROLS);
  return normalizeAdminControls(saved);
}

async function saveAdminControls(raw = {}) {
  const controls = normalizeAdminControls(raw.controls || raw.data || raw);
  const rec = await findSettingRecord(CONTROL_KEY);
  const body = {
    setting_key: CONTROL_KEY,
    setting_value: JSON.stringify(controls)
  };

  if (rec?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, {
      method: "PATCH",
      body
    });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "POST",
      body
    });
  }

  return controls;
}

module.exports = {
  DEFAULT_CONTROLS,
  getAdminControls,
  saveAdminControls,
  normalizeAdminControls
};
