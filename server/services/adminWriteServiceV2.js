// server/services/adminWriteServiceV2.js
// Faster DB admin save with sync mode.
// If syncMode = "deactivateMissing", records removed from admin screen are marked inactive.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const planned = require("./plannedAbsenceService");

function clean(value) { return String(value ?? "").trim(); }
function slug(value) { return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function bool(value, defaultValue = true) {
  if (value === true || value === false) return value;
  const text = clean(value).toLowerCase();
  if (["false", "0", "no", "inactive", "completed"].includes(text)) return false;
  if (["true", "1", "yes", "active"].includes(text)) return true;
  return defaultValue;
}
function num(value, defaultValue = 0) { const n = Number(value); return Number.isFinite(n) ? n : defaultValue; }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function isMissingCollectionError(err) { return err?.status === 404 || /missing collection context/i.test(String(err?.message || "")); }

async function listAll(collectionName, options = {}) {
  const all = [];
  let page = 1;
  const perPage = options.perPage || 500;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: { page, perPage, filter: options.filter || "", sort: options.sort || "" }
    });
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return all;
}
async function createRecord(collectionName, body) { return pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "POST", body }); }
async function updateRecord(collectionName, id, body) { return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, { method: "PATCH", body }); }
async function deleteRecord(collectionName, id) { return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, { method: "DELETE" }); }

function makeMap(records, keyFn) { const map = new Map(); records.forEach((r) => { const key = keyFn(r); if (key) map.set(key, r); }); return map; }
async function syncCollection({ collection, records, keyFn, deactivateMissing = false, deactivateBody = { active: false } }) {
  const existing = await listAll(collection, { perPage: 1000 });
  const existingMap = makeMap(existing, keyFn);
  const incomingKeys = new Set();
  const counts = { created: 0, updated: 0, deactivated: 0 };
  for (const record of records) {
    const key = keyFn(record); if (!key) continue;
    incomingKeys.add(key);
    const old = existingMap.get(key);
    if (old?.id) { await updateRecord(collection, old.id, record); counts.updated += 1; }
    else { await createRecord(collection, record); counts.created += 1; }
  }
  if (deactivateMissing) {
    for (const [key, old] of existingMap.entries()) {
      if (!incomingKeys.has(key) && old?.id && old.active !== false) { await updateRecord(collection, old.id, deactivateBody); counts.deactivated += 1; }
    }
  }
  return counts;
}

function normalizeNameList(list) {
  return (Array.isArray(list) ? list : []).map((x) => {
    if (typeof x === "string") return clean(x);
    if (x && typeof x === "object") return clean(x.name || x.reason || x.label || x.value || x.reason_name || x.area_name);
    return "";
  }).filter(Boolean);
}
function normalizeMachineTypes(data) { return (Array.isArray(data.machineTypes) ? data.machineTypes : []).map((x) => ({ type_code: clean(x.id || x.type_code || x.code || x.name), type_name: clean(x.name || x.type_name || x.id), active: bool(x.active, true) })).filter((x) => x.type_code && x.type_name); }
function normalizeMachines(data) { return (Array.isArray(data.machines) ? data.machines : []).map((x) => ({ machine_no: clean(x.name || x.machine_no || x.machineNo), machine_type_code: clean(x.type || x.machine_type_code || x.type_code), status: clean(x.status || (bool(x.active, true) ? "Active" : "Completed")), active: bool(x.active, clean(x.status).toLowerCase() !== "completed") })).filter((x) => x.machine_no); }
function normalizeEmployees(data) { return (Array.isArray(data.employees) ? data.employees : []).map((x) => ({ emp_code: clean(x.empId || x.emp_code || x.code), full_name: clean(x.name || x.full_name || x.emp_name), department: clean(x.department), designation: clean(x.designation), active: bool(x.active, true) })).filter((x) => x.emp_code && x.full_name); }
function normalizeShifts(data) { return (Array.isArray(data.shifts) ? data.shifts : []).map((x) => ({ shift_code: clean(x.id || x.shift_code || x.code || x.name), shift_name: clean(x.name || x.shift_name || x.id), start_time: clean(x.start || x.start_time), end_time: clean(x.end || x.end_time), break_minutes: num(x.breakMinutes ?? x.break_minutes, 0), flexible: bool(x.flexible, false), active: bool(x.active, true) })).filter((x) => x.shift_code && x.shift_name); }
function normalizeDepartments(data) {
  const fromMainWorks = normalizeNameList(data.mainWorks);
  const fromEmployees = normalizeEmployees(data).map((e) => e.department).filter(Boolean);
  const fromCatalog = [];
  Object.values(data.workCatalogByType || {}).forEach((catalog) => { (catalog.mainWorks || []).forEach((d) => fromCatalog.push(clean(d))); Object.keys(catalog.subWorks || {}).forEach((d) => fromCatalog.push(clean(d))); });
  return Array.from(new Set([...fromMainWorks, ...fromEmployees, ...fromCatalog].filter(Boolean))).map((name) => ({ department_code: slug(name), department_name: name, active: true }));
}
function normalizeSubworksAndPoints(data) {
  const subworks = [], bookingPoints = [], qualityPoints = [];
  const catalogByType = data.workCatalogByType || {};
  Object.entries(catalogByType).forEach(([typeCodeRaw, catalog]) => {
    const typeCode = clean(typeCodeRaw);
    Object.entries(catalog.subWorks || {}).forEach(([deptNameRaw, list]) => {
      const deptName = clean(deptNameRaw), deptCode = slug(deptName);
      (Array.isArray(list) ? list : []).forEach((sw, swIndex) => {
        const subworkName = clean(sw.name || sw.subwork_name || sw); if (!typeCode || !deptName || !subworkName) return;
        const subworkCode = slug(subworkName);
        subworks.push({ machine_type_code: typeCode, department_code: deptCode, subwork_code: subworkCode, subwork_name: subworkName, standard_time: num(sw.standardTime ?? sw.standard_time, 0), sequence_no: swIndex + 1, active: bool(sw.active, true) });
        (Array.isArray(sw.checkpoints) ? sw.checkpoints : []).forEach((bp, i) => {
          const pointName = clean(bp.name || bp.point_name || bp); if (!pointName) return;
          bookingPoints.push({ machine_type_code: typeCode, department_code: deptCode, subwork_code: subworkCode, point_code: slug(pointName), point_name: pointName, standard_time: num(bp.standardTime ?? bp.standard_time, 0), sequence_no: i + 1, active: bool(bp.active, true) });
        });
        (Array.isArray(sw.qualityCheckpoints) ? sw.qualityCheckpoints : []).forEach((qp, i) => {
          const pointName = clean(qp.name || qp.point_name || qp); if (!pointName) return;
          qualityPoints.push({ machine_type_code: typeCode, department_code: deptCode, subwork_code: subworkCode, point_code: slug(pointName), point_name: pointName, input_type: clean(qp.inputType || qp.input_type) === "reading" ? "reading" : "status", mandatory: bool(qp.mandatory, false), sequence_no: i + 1, active: bool(qp.active, true) });
        });
      });
    });
  });
  return { subworks, bookingPoints, qualityPoints };
}

function normalizeLossReasons(data) {
  return normalizeNameList(data.lossReasons).map((reason_name) => ({
    reason_code: slug(reason_name),
    reason_name,
    active: true
  })).filter((x) => x.reason_code && x.reason_name);
}

function normalizeRootAreas(data) {
  return normalizeNameList(data.rootAreas).map((area_name) => ({
    area_code: slug(area_name),
    area_name,
    active: true
  })).filter((x) => x.area_code && x.area_name);
}

async function saveAdminMasterData(rawData = {}) {
  const data = rawData.data || rawData.adminOverrides || rawData;
  const deactivateMissing = clean(rawData.syncMode || data.syncMode).toLowerCase() === "deactivatemissing";
  const machineTypes = normalizeMachineTypes(data), machines = normalizeMachines(data), employees = normalizeEmployees(data), shifts = normalizeShifts(data), departments = normalizeDepartments(data);
  const { subworks, bookingPoints, qualityPoints } = normalizeSubworksAndPoints(data);
  const lossReasons = normalizeLossReasons(data);
  const rootAreas = normalizeRootAreas(data);
  const results = {};
  results.machineTypes = await syncCollection({ collection: "machine_types", records: machineTypes, keyFn: (x) => clean(x.type_code), deactivateMissing });
  results.machines = await syncCollection({ collection: "machines", records: machines, keyFn: (x) => clean(x.machine_no), deactivateMissing, deactivateBody: { active: false, status: "Completed" } });
  results.employees = await syncCollection({ collection: "employees", records: employees, keyFn: (x) => clean(x.emp_code), deactivateMissing });
  results.shifts = await syncCollection({ collection: "shifts", records: shifts, keyFn: (x) => clean(x.shift_code), deactivateMissing });
  results.departments = await syncCollection({ collection: "departments", records: departments, keyFn: (x) => clean(x.department_code), deactivateMissing });
  results.subworks = await syncCollection({ collection: "subworks", records: subworks, keyFn: (x) => `${clean(x.machine_type_code)}|${clean(x.department_code)}|${clean(x.subwork_code)}`, deactivateMissing });
  results.bookingPoints = await syncCollection({ collection: "booking_points", records: bookingPoints, keyFn: (x) => `${clean(x.machine_type_code)}|${clean(x.department_code)}|${clean(x.subwork_code)}|${clean(x.point_code)}`, deactivateMissing });
  results.qualityPoints = await syncCollection({ collection: "quality_points", records: qualityPoints, keyFn: (x) => `${clean(x.machine_type_code)}|${clean(x.department_code)}|${clean(x.subwork_code)}|${clean(x.point_code)}`, deactivateMissing });
  results.lossReasons = await syncCollection({ collection: "loss_reasons", records: lossReasons, keyFn: (x) => clean(x.reason_code || x.reason_name), deactivateMissing });
  results.rootAreas = await syncCollection({ collection: "root_areas", records: rootAreas, keyFn: (x) => clean(x.area_code || x.area_name), deactivateMissing });
  return { ok: true, mode: deactivateMissing ? "sync-deactivate-missing" : "upsert-only", message: deactivateMissing ? "Admin master data saved. Missing records marked inactive." : "Admin master data saved to PocketBase.", results };
}

function missingSkillCollectionError() { const err = new Error("PocketBase collection skill_matrix is missing. Create it before saving skill matrix."); err.status = 400; err.details = { reasonCode: "SKILL_MATRIX_COLLECTION_MISSING", collection: "skill_matrix" }; return err; }
async function listSkillMatrix(params = {}) {
  const emp = clean(params.emp_code || params.empCode);
  const filter = emp ? `emp_code="${pbEscape(emp)}"` : "";
  try { return await listAll("skill_matrix", { perPage: 1000, sort: "emp_name,department_name,subwork_name", filter }); }
  catch (err) { if (isMissingCollectionError(err)) return []; throw err; }
}
async function saveSkillMatrix(body = {}) {
  const records = Array.isArray(body.records) ? body.records : [body];
  const saved = [];
  try {
    for (const raw of records) {
      const record = {
        emp_code: clean(raw.emp_code || raw.empCode), emp_name: clean(raw.emp_name || raw.empName),
        department_code: clean(raw.department_code || raw.departmentCode || slug(raw.department_name || raw.departmentName)), department_name: clean(raw.department_name || raw.departmentName),
        subwork_code: clean(raw.subwork_code || raw.subworkCode || slug(raw.subwork_name || raw.subworkName)), subwork_name: clean(raw.subwork_name || raw.subworkName),
        capability_pct: num(raw.capability_pct ?? raw.capabilityPct, 100), preferred: bool(raw.preferred, true), active: bool(raw.active, true), remark: clean(raw.remark)
      };
      if (!record.emp_code && !record.emp_name) throw new Error("Employee is required for skill matrix.");
      if (!record.department_name) throw new Error("Department is required for skill matrix.");
      if (!record.subwork_name) throw new Error("Sub work is required for skill matrix.");
      const existing = await listAll("skill_matrix", { perPage: 1, filter: [`emp_code="${pbEscape(record.emp_code)}"`, `department_code="${pbEscape(record.department_code)}"`, `subwork_code="${pbEscape(record.subwork_code)}"`].join(" && ") });
      if (existing[0]?.id) saved.push(await updateRecord("skill_matrix", existing[0].id, record)); else saved.push(await createRecord("skill_matrix", record));
    }
    return saved;
  } catch (err) { if (isMissingCollectionError(err)) throw missingSkillCollectionError(); throw err; }
}
async function deleteSkillMatrix(id) { try { return await deleteRecord("skill_matrix", clean(id)); } catch (err) { if (isMissingCollectionError(err)) throw missingSkillCollectionError(); throw err; } }

module.exports = {
  saveAdminMasterData,
  listPlannedAbsences: planned.listPlannedAbsences,
  savePlannedAbsence: planned.savePlannedAbsence,
  deletePlannedAbsence: planned.deletePlannedAbsence,
  listSkillMatrix,
  saveSkillMatrix,
  deleteSkillMatrix
};