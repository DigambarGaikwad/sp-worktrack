// server/services/skillMatrixService.js
// Stores employee skill matrix as one admin_settings record per skill.
// Efficiency is derived from production_entry_lines history, not hardcoded/manual input.

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
function round1(value) { return Number(num(value, 0).toFixed(1)); }
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

async function listAll(collection, query = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collection}/records`, {
      method: "GET",
      query: { page, perPage: 500, ...query }
    });
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return all;
}

async function listSettings() {
  return listAll(COLLECTION, { sort: "setting_key" });
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
    if (old?.id) return pocketBaseRequest(`/api/collections/${COLLECTION}/records/${old.id}`, { method: "PATCH", body });
    return pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  } catch (err) {
    const e = new Error(pocketBaseMessage(err, "Failed to save skill matrix record."));
    e.status = err.status || 500;
    e.details = err.details || null;
    throw e;
  }
}

function skillKeyParts(r = {}) {
  return [
    clean(r.emp_code).toLowerCase(),
    clean(r.machine_type_code || r.machine_category).toLowerCase(),
    clean(r.skill_department_code || r.department_code || slug(r.skill_department_name || r.department_name)).toLowerCase(),
    clean(r.subwork_code || slug(r.subwork_name)).toLowerCase()
  ];
}

function validSkillKeyParts(parts = []) {
  return parts.length === 4 && parts.every(Boolean);
}

function uniqueKey(r = {}) {
  const parts = skillKeyParts(r);
  return validSkillKeyParts(parts) ? parts.join("|") : "";
}

function settingKeyFor(record) {
  return `${RECORD_PREFIX}${hashKey(uniqueKey(record))}`;
}

function normalizeRecord(raw = {}, existing = {}) {
  const skillDepartmentName = clean(raw.skill_department_name || raw.department_name || raw.main_work || raw.mainWork || existing.skill_department_name);
  const subworkName = clean(raw.subwork_name || raw.subwork || existing.subwork_name);
  const level = Math.max(0, Math.min(4, Math.round(num(raw.skill_level ?? raw.skillLevel ?? existing.skill_level, 0))));
  const efficiency = Math.max(0, num(raw.efficiency_pct ?? raw.efficiencyPct ?? existing.efficiency_pct, 0));
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
    efficiency_pct: round1(efficiency),
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
    const key = uniqueKey(record);
    if (!key) return;
    if (!record.setting_key) record.setting_key = settingKeyFor(record);
    byKey.set(key, record);
  });
  return Array.from(byKey.values()).filter(x => x.id);
}

function lineRecord(line = {}) {
  const deptName = clean(line.department_name || line.department || line.department_code);
  const subworkName = clean(line.subwork_name || line.sub_work || line.subwork_code);
  const typeCode = clean(line.machine_type_code || line.machine_category || line.machine_type_name);
  return {
    emp_code: clean(line.emp_code || line.employee_code || line.emp_id),
    emp_name: clean(line.emp_name || line.employee_name),
    employee_department: "",
    machine_type_code: typeCode,
    machine_type_name: clean(line.machine_category || line.machine_type_name || typeCode),
    skill_department_code: clean(line.department_code || slug(deptName)),
    skill_department_name: deptName,
    subwork_code: clean(line.subwork_code || slug(subworkName)),
    subwork_name: subworkName
  };
}

function lineToPerformanceKey(line = {}) {
  return uniqueKey(lineRecord(line));
}

async function buildPerformanceMap() {
  const lines = await listAll("production_entry_lines", { sort: "-work_date" }).catch(() => []);
  const map = new Map();

  for (const line of lines) {
    const standard = num(line.standard_minutes, 0);
    const actual = num(line.actual_minutes, 0);
    const base = lineRecord(line);
    const key = uniqueKey(base);
    if (!key || standard <= 0 || actual <= 0) continue;

    const current = map.get(key) || {
      ...base,
      history_count: 0,
      history_standard_minutes: 0,
      history_actual_minutes: 0,
      first_work_date: "",
      last_work_date: ""
    };
    current.history_count += 1;
    current.history_standard_minutes += standard;
    current.history_actual_minutes += actual;
    const workDate = clean(line.work_date);
    if (workDate && (!current.first_work_date || workDate < current.first_work_date)) current.first_work_date = workDate;
    if (workDate && workDate > current.last_work_date) current.last_work_date = workDate;
    if (!current.emp_name && base.emp_name) current.emp_name = base.emp_name;
    if (!current.machine_type_name && base.machine_type_name) current.machine_type_name = base.machine_type_name;
    if (!current.skill_department_name && base.skill_department_name) current.skill_department_name = base.skill_department_name;
    if (!current.subwork_name && base.subwork_name) current.subwork_name = base.subwork_name;
    map.set(key, current);
  }

  for (const item of map.values()) {
    item.history_efficiency_pct = item.history_actual_minutes > 0 ? round1((item.history_standard_minutes / item.history_actual_minutes) * 100) : 0;
    item.history_standard_minutes = round1(item.history_standard_minutes);
    item.history_actual_minutes = round1(item.history_actual_minutes);
  }

  return map;
}

function applyPerformance(records = [], performanceMap = new Map()) {
  return records.map((record) => {
    const perf = performanceMap.get(uniqueKey(record)) || null;
    const historyCount = num(perf?.history_count, 0);
    const historyEff = historyCount ? num(perf.history_efficiency_pct, 0) : 0;
    return {
      ...record,
      emp_name: clean(record.emp_name || perf?.emp_name),
      machine_type_name: clean(record.machine_type_name || perf?.machine_type_name),
      skill_department_name: clean(record.skill_department_name || perf?.skill_department_name),
      subwork_name: clean(record.subwork_name || perf?.subwork_name),
      efficiency_pct: round1(historyEff),
      history_count: historyCount,
      history_standard_minutes: round1(perf?.history_standard_minutes || 0),
      history_actual_minutes: round1(perf?.history_actual_minutes || 0),
      history_efficiency_pct: round1(historyEff),
      first_work_date: clean(perf?.first_work_date),
      last_work_date: clean(perf?.last_work_date)
    };
  });
}

function inferLevel(historyCount, efficiencyPct) {
  const count = num(historyCount, 0);
  const eff = num(efficiencyPct, 0);
  if (count >= 8 && eff >= 90) return 4;
  if (count >= 2) return 3;
  return 2;
}

function autoRecordFromPerformance(perf = {}) {
  const level = inferLevel(perf.history_count, perf.history_efficiency_pct);
  return normalizeRecord({
    emp_code: perf.emp_code,
    emp_name: perf.emp_name,
    employee_department: perf.employee_department,
    machine_type_code: perf.machine_type_code,
    machine_type_name: perf.machine_type_name,
    skill_department_code: perf.skill_department_code,
    skill_department_name: perf.skill_department_name,
    subwork_code: perf.subwork_code,
    subwork_name: perf.subwork_name,
    skill_level: level,
    efficiency_pct: perf.history_efficiency_pct,
    can_work_independently: level >= 3,
    can_train_others: false,
    remarks: `Auto added from past production history (${perf.history_count || 0} entries). Trainer approval remains manual.`
  });
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
  const historyRows = active.filter(r => num(r.history_count, 0) > 0 && num(r.history_actual_minutes, 0) > 0);
  const totalStd = historyRows.reduce((s, r) => s + num(r.history_standard_minutes, 0), 0);
  const totalActual = historyRows.reduce((s, r) => s + num(r.history_actual_minutes, 0), 0);
  const avgEfficiency = totalActual > 0 ? round1((totalStd / totalActual) * 100) : 0;
  const independent = active.filter(r => r.can_work_independently).length;
  const trainers = active.filter(r => r.can_train_others).length;
  return { activeSkills: active.length, employees: employees.size, departments: departments.size, subworks: subworks.size, avgEfficiency, historySkills: historyRows.length, independent, trainers };
}

async function listSkillMatrix(query = {}) {
  const performanceMap = await buildPerformanceMap();
  const records = applyPerformance(await readAll(), performanceMap);
  const filtered = applyFilters(records, query);
  return { records: filtered, summary: buildSummary(records), total: filtered.length };
}

async function saveSkillMatrix(payload = {}) {
  const incoming = Array.isArray(payload.records) ? payload.records : Array.isArray(payload.items) ? payload.items : [payload.record || payload.data || payload];
  const existing = await readAll();
  const performanceMap = await buildPerformanceMap();
  const byKey = new Map(existing.map(r => [uniqueKey(r), r]));
  let created = 0, updated = 0, skipped = 0;

  for (const raw of incoming) {
    const prepared = normalizeRecord(raw);
    if (!uniqueKey(prepared)) { skipped += 1; continue; }
    const old = byKey.get(uniqueKey(prepared));
    const withHistory = applyPerformance([prepared], performanceMap)[0];
    const record = normalizeRecord({ ...prepared, efficiency_pct: withHistory.history_efficiency_pct }, old || {});
    record.setting_key = old?.setting_key || settingKeyFor(record);
    record.id = old?.id || record.id;
    await saveSetting(record.setting_key, JSON.stringify(record));
    byKey.set(uniqueKey(record), record);
    if (old) updated += 1; else created += 1;
  }

  const saved = applyPerformance(await readAll(), performanceMap);
  return { ok: true, created, updated, skipped, summary: buildSummary(saved), records: applyFilters(saved, payload.query || {}) };
}

async function autoCreateSkillsFromHistory(options = {}) {
  const minEntries = Math.max(1, Math.round(num(options.minEntries, 1)));
  const existing = await readAll();
  const performanceMap = await buildPerformanceMap();
  const byKey = new Map(existing.map(r => [uniqueKey(r), r]));
  let created = 0, alreadyExists = 0, skipped = 0;

  for (const perf of performanceMap.values()) {
    if (num(perf.history_count, 0) < minEntries) { skipped += 1; continue; }
    const record = autoRecordFromPerformance(perf);
    const key = uniqueKey(record);
    if (!key) { skipped += 1; continue; }
    const old = byKey.get(key);
    if (old) { alreadyExists += 1; continue; }
    record.setting_key = settingKeyFor(record);
    await saveSetting(record.setting_key, JSON.stringify(record));
    byKey.set(key, record);
    created += 1;
  }

  const saved = applyPerformance(await readAll(), performanceMap);
  return {
    ok: true,
    created,
    alreadyExists,
    skipped,
    minEntries,
    source: "production_entry_lines",
    summary: buildSummary(saved),
    records: applyFilters(saved, options.query || {})
  };
}

async function deleteSkillMatrix(recordId) {
  const idValue = clean(recordId);
  if (!idValue) { const err = new Error("Skill record id is required."); err.status = 400; throw err; }
  const records = await readAll();
  const record = records.find(r => r.id === idValue);
  if (!record) { const err = new Error("Skill record not found."); err.status = 404; throw err; }
  const deleted = { ...record, active: false, updated_at: nowIso() };
  await saveSetting(record.setting_key || settingKeyFor(deleted), JSON.stringify(deleted));
  return { ok: true, deleted: 1, summary: buildSummary(applyPerformance(await readAll(), await buildPerformanceMap())) };
}

module.exports = { listSkillMatrix, saveSkillMatrix, autoCreateSkillsFromHistory, deleteSkillMatrix, normalizeRecord };
