// server/services/backupControlService.js
// Stores backup control settings and last backup result in PocketBase admin_settings.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const CONTROL_KEY = "backup_controls_json";

const DEFAULT_BACKUP_CONTROLS = {
  googleSheetBackupEnabled: true,
  dailyBackupEnabled: false,
  dailyBackupTime: "20:00",
  lastRunAt: "",
  lastRunType: "",
  lastRunWorkDate: "",
  lastRunOk: null,
  lastRunMessage: "",
  lastAutoRunKey: "",
  lastRunSummary: null
};

function clean(value) { return String(value ?? "").trim(); }

function bool(value, defaultValue = false) {
  if (value === true || value === false) return value;
  const text = clean(value).toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(text)) return true;
  if (["false", "0", "no", "off", "disabled"].includes(text)) return false;
  return defaultValue;
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function normalizeTime(value, defaultValue = "20:00") {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return defaultValue;
  const hh = Math.min(23, Math.max(0, Number(match[1])));
  const mm = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

async function findSettingRecord(key) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1, filter: `setting_key="${key}"` }
    });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) {
    if (isMissingCollectionError(err)) return null;
    throw err;
  }
}

function normalizeBackupControls(raw = {}) {
  return {
    ...DEFAULT_BACKUP_CONTROLS,
    ...raw,
    googleSheetBackupEnabled: bool(raw.googleSheetBackupEnabled, DEFAULT_BACKUP_CONTROLS.googleSheetBackupEnabled),
    dailyBackupEnabled: bool(raw.dailyBackupEnabled, DEFAULT_BACKUP_CONTROLS.dailyBackupEnabled),
    dailyBackupTime: normalizeTime(raw.dailyBackupTime, DEFAULT_BACKUP_CONTROLS.dailyBackupTime),
    lastRunAt: clean(raw.lastRunAt),
    lastRunType: clean(raw.lastRunType),
    lastRunWorkDate: clean(raw.lastRunWorkDate),
    lastRunOk: raw.lastRunOk === true ? true : raw.lastRunOk === false ? false : null,
    lastRunMessage: clean(raw.lastRunMessage),
    lastAutoRunKey: clean(raw.lastAutoRunKey),
    lastRunSummary: raw.lastRunSummary && typeof raw.lastRunSummary === "object" ? raw.lastRunSummary : null
  };
}

async function getBackupControls() {
  const rec = await findSettingRecord(CONTROL_KEY);
  const saved = safeJsonParse(rec?.setting_value, DEFAULT_BACKUP_CONTROLS);
  return normalizeBackupControls(saved);
}

async function saveBackupControls(raw = {}) {
  const current = await getBackupControls();
  const next = normalizeBackupControls({ ...current, ...(raw.controls || raw.data || raw) });
  await saveBackupControlsRecord(next);
  return next;
}

async function saveBackupControlsRecord(controls) {
  const rec = await findSettingRecord(CONTROL_KEY);
  const body = { setting_key: CONTROL_KEY, setting_value: JSON.stringify(normalizeBackupControls(controls)) };
  if (rec?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, { method: "PATCH", body });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  }
}

async function saveBackupResult(result = {}, meta = {}) {
  const current = await getBackupControls();
  const workDate = clean(meta.workDate || result.workDate || "");
  const next = normalizeBackupControls({
    ...current,
    lastRunAt: new Date().toISOString(),
    lastRunType: clean(meta.runType || "manual"),
    lastRunWorkDate: workDate,
    lastRunOk: result.ok !== false,
    lastRunMessage: result.ok === false ? clean(result.message || "Backup failed") : "Backup completed successfully.",
    lastAutoRunKey: meta.autoRunKey ? clean(meta.autoRunKey) : current.lastAutoRunKey,
    lastRunSummary: result
  });
  await saveBackupControlsRecord(next);
  return next;
}

module.exports = {
  DEFAULT_BACKUP_CONTROLS,
  getBackupControls,
  saveBackupControls,
  saveBackupResult,
  normalizeBackupControls
};
