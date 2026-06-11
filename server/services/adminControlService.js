// server/services/adminControlService.js
// Stores configurable admin control rules in admin_settings collection.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const CONTROL_KEY = "admin_controls_json";

const DEFAULT_SCORE_RULES = {
  productivityWeight: 45,
  utilizationWeight: 20,
  efficiencyWeight: 15,
  attendanceWeight: 20,
  productivityCapPct: 120,
  utilizationCapPct: 100,
  efficiencyCapPct: 120,
  attendanceCapPct: 100,
  reworkPenaltyPerHour: 1,
  otherWorkPenaltyPerHour: 0.3,
  unplannedAbsentPenaltyPerDay: 2,
  plannedAbsentPenaltyPerDay: 0,
  plannedLeaveAllowedPerYear: 12,
  plannedExtraPenaltyPerDay: 0.5,
  minScore: 0,
  maxScore: 100
};

const DEFAULT_CONTROLS = {
  overrunReasonEnabled: true,
  overrunReasonLimitPct: 120,
  bookingExtraReasonEnabled: true,
  allowVpnAccess: false,
  performanceScoreRules: DEFAULT_SCORE_RULES
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

function normalizePerformanceScoreRules(raw = {}) {
  return {
    productivityWeight: numberInRange(raw.productivityWeight, DEFAULT_SCORE_RULES.productivityWeight, 0, 100),
    utilizationWeight: numberInRange(raw.utilizationWeight, DEFAULT_SCORE_RULES.utilizationWeight, 0, 100),
    efficiencyWeight: numberInRange(raw.efficiencyWeight, DEFAULT_SCORE_RULES.efficiencyWeight, 0, 100),
    attendanceWeight: numberInRange(raw.attendanceWeight, DEFAULT_SCORE_RULES.attendanceWeight, 0, 100),
    productivityCapPct: numberInRange(raw.productivityCapPct, DEFAULT_SCORE_RULES.productivityCapPct, 1, 300),
    utilizationCapPct: numberInRange(raw.utilizationCapPct, DEFAULT_SCORE_RULES.utilizationCapPct, 1, 300),
    efficiencyCapPct: numberInRange(raw.efficiencyCapPct, DEFAULT_SCORE_RULES.efficiencyCapPct, 1, 300),
    attendanceCapPct: numberInRange(raw.attendanceCapPct, DEFAULT_SCORE_RULES.attendanceCapPct, 1, 100),
    reworkPenaltyPerHour: numberInRange(raw.reworkPenaltyPerHour, DEFAULT_SCORE_RULES.reworkPenaltyPerHour, 0, 50),
    otherWorkPenaltyPerHour: numberInRange(raw.otherWorkPenaltyPerHour, DEFAULT_SCORE_RULES.otherWorkPenaltyPerHour, 0, 50),
    unplannedAbsentPenaltyPerDay: numberInRange(raw.unplannedAbsentPenaltyPerDay, DEFAULT_SCORE_RULES.unplannedAbsentPenaltyPerDay, 0, 50),
    plannedAbsentPenaltyPerDay: numberInRange(raw.plannedAbsentPenaltyPerDay, DEFAULT_SCORE_RULES.plannedAbsentPenaltyPerDay, 0, 50),
    plannedLeaveAllowedPerYear: numberInRange(raw.plannedLeaveAllowedPerYear, DEFAULT_SCORE_RULES.plannedLeaveAllowedPerYear, 0, 366),
    plannedExtraPenaltyPerDay: numberInRange(raw.plannedExtraPenaltyPerDay, DEFAULT_SCORE_RULES.plannedExtraPenaltyPerDay, 0, 50),
    minScore: numberInRange(raw.minScore, DEFAULT_SCORE_RULES.minScore, 0, 100),
    maxScore: numberInRange(raw.maxScore, DEFAULT_SCORE_RULES.maxScore, 1, 150)
  };
}

function normalizeAdminControls(raw = {}) {
  const mergedScoreRules = {
    ...DEFAULT_SCORE_RULES,
    ...(raw.performanceScoreRules || raw.scoreRules || {})
  };

  return {
    overrunReasonEnabled: bool(raw.overrunReasonEnabled, DEFAULT_CONTROLS.overrunReasonEnabled),
    overrunReasonLimitPct: numberInRange(
      raw.overrunReasonLimitPct,
      DEFAULT_CONTROLS.overrunReasonLimitPct,
      100,
      300
    ),
    bookingExtraReasonEnabled: bool(raw.bookingExtraReasonEnabled, DEFAULT_CONTROLS.bookingExtraReasonEnabled),
    allowVpnAccess: bool(raw.allowVpnAccess, DEFAULT_CONTROLS.allowVpnAccess),
    performanceScoreRules: normalizePerformanceScoreRules(mergedScoreRules)
  };
}

async function getAdminControls() {
  const rec = await findSettingRecord(CONTROL_KEY);
  const saved = safeJsonParse(rec?.setting_value, DEFAULT_CONTROLS);
  return normalizeAdminControls(saved);
}

async function getPerformanceScoreRules() {
  const controls = await getAdminControls();
  return controls.performanceScoreRules || normalizePerformanceScoreRules();
}

async function saveAdminControls(raw = {}) {
  const incoming = raw.controls || raw.data || raw;
  const rec = await findSettingRecord(CONTROL_KEY);
  const current = normalizeAdminControls(safeJsonParse(rec?.setting_value, DEFAULT_CONTROLS));
  const controls = normalizeAdminControls({
    ...current,
    ...incoming,
    performanceScoreRules: {
      ...(current.performanceScoreRules || DEFAULT_SCORE_RULES),
      ...(incoming.performanceScoreRules || incoming.scoreRules || {})
    }
  });
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
  DEFAULT_SCORE_RULES,
  getAdminControls,
  getPerformanceScoreRules,
  saveAdminControls,
  normalizeAdminControls,
  normalizePerformanceScoreRules
};

