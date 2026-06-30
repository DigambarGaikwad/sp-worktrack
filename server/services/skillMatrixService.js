// server/services/skillMatrixService.js
// Stores employee skill matrix as one admin_settings record per skill.
// This avoids large JSON values and requires no PocketBase schema change.

const crypto = require("crypto");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const LEGACY_KEY = "skill_matrix_json";
const RECORD_PREFIX = "skill_matrix_record_";

function clean(value) { return String(value ?? "").trim(); }
function slug(value) { return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function bool(value, fallback = false) {
  if (value === true || value === false) return value;
  const s = clean(value).toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return fallback;
}
function nowIso() { return new Date().toISOString(); }
function id() { return crypto.randomBytes(8).toString("hex"); }
function hashKey(value) { return crypto.createHash("sha1").update(clean(value)).digest("hex").slice(0, 24); }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function parseSkillJson(value) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) { return null; }
}

function parseLegacyList(value) {
  try {
    const parsed = JSON.parse(value || "");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function pocketBaseMessage(err, fallback) {
  const details = err?.details?.data || err?.details || null;
  if (!details) return err?.message || fallback;
  const extra = typeof details === "string" ? details : JSON.stringify(details);
  return `${err?.message || fallback}: ${extra}`;
}

async function listSettings() {
  const all = [];
  let page = 1;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page, perPage: 500, sort: "setting_key" }
    });
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return all;
}

async function findSetting(key) {
  const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
    method: "GET",
    query: { page: 1, perPage: 1, filter: `setting_key="${pbEscape(key)}"` }
  });
  return Array.isArray(result.items) ? result.items[0] || null : null;
}

async function saveSetting(key, value) {
  const body = { setting_key: key, setting_value: value };
  const old = await findSetting(key);
  try {
    if (old?.id) {
      return await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${old.id}`, { method: "PATCH", body });
    }
    return await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  } catch (err) {
    const e = new Error(pocketBaseMessage(err, "Failed to save skill matrix record."));
    e.status = err.status || 500;
    e.details = err.details || null;
    throw e;
  }
}

function uniqueKey(r = {}) {
  return [
    clean(r.emp_code).toLowerCase(),
    clean(r.machine_type_code).toLowerCase(),
    clean(r.skill_department_code || slug(r.skill_department_name)).toLowerCase(),
    clean(r.subwork_code || slug(r.subwork_name)).toLowerCase()
  ].join("|");
}

function settingKeyFor(record) {
  return `${RECORD_PREFIX}${hashKey(uniqueKey(record))}`;
}

function normalizeRecord(raw = {}, existing = {}) {
  const skillDepartmentName = clean(raw.skill_department_name || raw.department_name || raw.main_work || raw.mainWork || existing.skill_department_name);
  const subworkName = clean(raw.subwork_name || raw.subwork || existing.subwork_name);
  const level = Math.max(0, Math.min(4, Math.round(num(raw.skill_level ?? raw.skillLevel ?? existing.skill_level, 0))));
  const efficiency = Math.max(0, Math.min(150, num(raw.efficiency_pct ?? raw.efficiencyPct ?? existing.efficiency_pct, 0)));
  const active = bool(raw.active ?? existing.active, true);
  const createdAt = existing.created_at || raw.created_at || nowIso();

  return {
    id: clean(raw.id || existing.id || id()),
    setting_key: clean(raw.setting_key || existing.setting_key),
    emp_code: clean(raw.emp_code || raw.empCode || raw.employee_code || existing.emp_code),
    emp_name: clean(raw.emp_name || raw.empName || raw.employee_name || existing.emp_name),
    employee_department: clean(raw.employee_department || raw.employeeDepartment || raw.home_department || existing.employee_department),
    machine_type_code: clean(raw.machine_type_code || raw.machineTypeCode || raw.type_code || existing.machine_type_code),
    machine_type_name: clean(raw.machine_type_name || raw.machineTypeName || raw.type_name || existing.machine_type_name),
    skill_department_code: clean(raw.skill_department_code || raw.department_code || slug(skillDepartmentName) || existing.skill_department_code),
    skill_department_name: skillDepartmentName,
    subwork_code: clean(raw.subwork_code || slug(subworkName) || existing.subwork_code),
    subwork_name: subworkName,
    skill_level: level,
    efficiency_pct: efficiency,
    can_work_independently: bool(raw.can_work_independently ?? raw.canWorkIndependently ?? existing.can_work_independently, level >= 3),
    can_train_others: bool(raw.can_train_others ?? raw.canTrainOthers ?? existing.can_train_others, level >= 4),
    remarks: clean(raw.remarks || existing.remarks),
    active,
    created_at: createdAt,
    updated_at: nowIso()
  };
}

async function readAll() {
  const settings = await listSettings();
  const records = [];

  settings.forEach((setting) => {
    const key = clean(setting.setting_key);
    if (key.startsWith(RECORD_PREFIX)) {
      const parsed = parseSkillJson(setting.setting_value);
      if (parsed) records.push(normalizeRecord({ ...parsed, setting_key: key }));
    }
    if (key === LEGACY_KEY) {
      parseLegacyList(setting.setting_value).forEach((row) => records.push(normalizeRecord(row)));
    }
  });

  const byKey = new Map();
  records.forEach((record) => {
    if (!record.setting_key) record.setting_key = settingKeyFor(record);
    byKey.set(uniqueKey(record), record);
  });
  return Array.from(byKey.values()).filter(x => x.id);
}

function applyFilters(records, query = {}) {
  const emp = clean(query.emp_code || query.empCode || query.employee || "").toLowerCase();
  const type = clean(query.machine_type_code || query.machineTypeCode || query.type || "").toLowerCase();
  const dept = clean(query.skill_department_code || query.department || query.mainWork || "").toLowerCase();
  const includeInactive = bool(query.includeInactive, false);
  return records
    .filter(r => includeInactive || r.active !== false)
    .filter(r => !emp || clean(r.emp_code).toLowerCase() === emp)
    .filter(r => !type || clean(r.machine_type_code).toLowerCase() === type)
    .filter(r => !dept || clean(r.skill_department_code).toLowerCase() === dept || clean(r.skill_department_name).toLowerCase() === dept)
    .sort((a, b) => clean(a.emp_name).localeCompare(clean(b.emp_name)) || clean(a.machine_type_name).localeCompare(clean(b.machine_type_name)) || clean(a.skill_department_name).localeCompare(clean(b.skill_department_name)) || clean(a.subwork_name).localeCompare(clean(b.subwork_name)));
}

function buildSummary(records) {
  const active = records.filter(r => r.active !== false);
  const employees = new Set(active.map(r => r.emp_code).filter(Boolean));
  const departments = new Set(active.map(r => r.skill_department_name).filter(Boolean));
  const subworks = new Set(active.map(uniqueKey).filter(Boolean));
  const avgEfficiency = active.length ? Number((active.reduce((s, r) => s + num(r.efficiency_pct), 0) / active.length).toFixed(1)) : 0;
  const independent = active.filter(r => r.can_work_independently).length;
  const trainers = active.filter(r => r.can_train_others).length;
  return { activeSkills: active.length, employees: employees.size, departments: departments.size, subworks: subworks.size, avgEfficiency, independent, trainers };
}

async function listSkillMatrix(query = {}) {
  const records = await readAll();
  const filtered = applyFilters(records, query);
  return { records: filtered, summary: buildSummary(records), total: filtered.length };
}

async function saveSkillMatrix(payload = {}) {
  const incoming = Array.isArray(payload.records) ? payload.records : Array.isArray(payload.items) ? payload.items : [payload.record || payload.data || payload];
  const existing = await readAll();
  const byKey = new Map(existing.map(r => [uniqueKey(r), r]));
  let created = 0, updated = 0, skipped = 0;

  for (const raw of incoming) {
    const prepared = normalizeRecord(raw);
    if (!prepared.emp_code || !prepared.machine_type_code || !prepared.skill_department_name || !prepared.subwork_name) { skipped += 1; continue; }
    const old = byKey.get(uniqueKey(prepared));
    const record = normalizeRecord(prepared, old || {});
    record.setting_key = old?.setting_key || settingKeyFor(record);
    record.id = old?.id || record.id;
    await saveSetting(record.setting_key, JSON.stringify(record));
    byKey.set(uniqueKey(record), record);
    if (old) updated += 1; else created += 1;
  }

  const saved = await readAll();
  return { ok: true, created, updated, skipped, summary: buildSummary(saved), records: applyFilters(saved, payload.query || {}) };
}

async function deleteSkillMatrix(recordId) {
  const idValue = clean(recordId);
  if (!idValue) { const err = new Error("Skill record id is required."); err.status = 400; throw err; }
  const records = await readAll();
  const record = records.find(r => r.id === idValue);
  if (!record) { const err = new Error("Skill record not found."); err.status = 404; throw err; }
  const deleted = { ...record, active: false, updated_at: nowIso() };
  await saveSetting(record.setting_key || settingKeyFor(deleted), JSON.stringify(deleted));
  return { ok: true, deleted: 1, summary: buildSummary(await readAll()) };
}

module.exports = { listSkillMatrix, saveSkillMatrix, deleteSkillMatrix, normalizeRecord };
