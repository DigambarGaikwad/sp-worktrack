// server/services/employeeCapacityService.js
// Stores employee-specific available minutes/day for absence capacity loss reports.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "employees";
const FIELD = "available_minutes_day";

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function collectionFields(collection) {
  const fields = Array.isArray(collection.fields) ? collection.fields : [];
  const schema = Array.isArray(collection.schema) ? collection.schema : [];
  return fields.length ? fields : schema;
}

function numberField(name) {
  return {
    name,
    type: "number",
    system: false,
    required: false,
    presentable: false,
    unique: false,
    options: { min: 0, max: 1440, noDecimal: true }
  };
}

async function ensureEmployeeCapacityField() {
  const collection = await pocketBaseRequest(`/api/collections/${COLLECTION}`, { method: "GET" });
  const fields = collectionFields(collection);
  if (fields.some((f) => clean(f.name) === FIELD)) return collection;

  const merged = [...fields, numberField(FIELD)];
  const body = collection.fields !== undefined ? { fields: merged } : { schema: merged };
  return pocketBaseRequest(`/api/collections/${collection.id}`, { method: "PATCH", body });
}

async function listAllEmployees() {
  const all = [];
  let page = 1;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page, perPage: 500, sort: "emp_code" }
    });
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return all;
}

async function saveEmployeeAvailableMinutes(body = {}) {
  await ensureEmployeeCapacityField();
  const records = Array.isArray(body.records) ? body.records : [];
  const employees = await listAllEmployees();
  const byCode = new Map(employees.map((e) => [clean(e.emp_code).toLowerCase(), e]));
  const saved = [];

  for (const raw of records) {
    const empCode = clean(raw.emp_code || raw.empCode || raw.empId);
    if (!empCode) continue;
    const old = byCode.get(empCode.toLowerCase());
    if (!old?.id) continue;
    const minutes = Math.max(0, Math.min(1440, Math.round(num(raw.available_minutes_day ?? raw.availableMinutesDay, 0))));
    const updated = await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${old.id}`, {
      method: "PATCH",
      body: { [FIELD]: minutes }
    });
    saved.push({ emp_code: empCode, available_minutes_day: minutes, id: updated.id });
  }

  return { saved, count: saved.length };
}

module.exports = { ensureEmployeeCapacityField, saveEmployeeAvailableMinutes };
