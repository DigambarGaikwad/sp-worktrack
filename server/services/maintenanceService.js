// server/services/maintenanceService.js
// Admin Maintenance service: backup, cleanup, employee entry deletion, old sheet import placeholder.

const fs = require("fs");
const path = require("path");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }
function toNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function todayStamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }

const MASTER_COLLECTIONS = [
  "employees",
  "machines",
  "shifts",
  "loss_reasons",
  "root_areas",
  "machine_types",
  "departments",
  "subworks",
  "admin_settings"
];

const SETUP_CLEAR_COLLECTIONS = [
  "quality_points",
  "booking_points",
  "subworks",
  "departments",
  "machine_types",
  "machines",
  "employees"
];

const TRANSACTION_COLLECTIONS = [
  "production_entries",
  "production_entry_lines",
  "booking_logs",
  "booking_status",
  "quality_logs",
  "attendance"
];

const DELETE_BY_EMP_COLLECTIONS = [
  "production_entries",
  "production_entry_lines",
  "booking_logs",
  "quality_logs",
  "attendance"
];

const DATE_FIELD_BY_COLLECTION = {
  production_entries: "work_date",
  production_entry_lines: "work_date",
  booking_logs: "work_date",
  booking_status: "last_work_date",
  quality_logs: "work_date",
  attendance: "work_date"
};

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context|collection not found/i.test(String(err?.message || ""));
}

function buildDateFilter({ fromDate = "", toDate = "" } = {}, dateField = "work_date") {
  const parts = [];
  if (clean(fromDate)) parts.push(`${dateField} >= "${pbEscape(fromDate)}"`);
  if (clean(toDate)) parts.push(`${dateField} <= "${pbEscape(toDate)}"`);
  return parts;
}

function buildEmployeeDateFilter({ empCode = "", fromDate = "", toDate = "" } = {}, collectionName = "") {
  const parts = [];
  if (clean(empCode)) parts.push(`emp_code = "${pbEscape(empCode)}"`);
  parts.push(...buildDateFilter({ fromDate, toDate }, DATE_FIELD_BY_COLLECTION[collectionName] || "work_date"));
  return parts.join(" && ");
}

function buildCollectionDateFilter(params = {}, collectionName = "") {
  return buildDateFilter(params, DATE_FIELD_BY_COLLECTION[collectionName] || "work_date").join(" && ");
}

async function listRecords(collectionName, { filter = "", perPage = 200 } = {}) {
  const all = [];
  let page = 1;
  while (true) {
    try {
      const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
        method: "GET",
        query: { page, perPage, filter }
      });
      const items = Array.isArray(result.items) ? result.items : [];
      all.push(...items);
      const totalPages = Number(result.totalPages || 1);
      if (page >= totalPages || !items.length) break;
      page += 1;
    } catch (err) {
      if (isMissingCollectionError(err)) return [];
      throw err;
    }
  }
  return all;
}

async function countRecords(collectionName, filter = "") {
  try {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1, filter }
    });
    return Number(result.totalItems || 0);
  } catch (err) {
    if (isMissingCollectionError(err)) return 0;
    const error = new Error(`${collectionName}: ${err.message || "PocketBase count failed"}`);
    error.status = err.status || 500;
    error.details = err.details || null;
    throw error;
  }
}

async function deleteRecord(collectionName, id) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, { method: "DELETE" });
}

async function deleteByFilter(collectionName, filter = "") {
  const items = await listRecords(collectionName, { filter, perPage: 200 });
  let deleted = 0;
  for (const item of items) {
    if (!item?.id) continue;
    await deleteRecord(collectionName, item.id);
    deleted += 1;
  }
  return { collection: collectionName, deleted };
}

async function createRecord(collectionName, body) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "POST", body });
}

function bookingKey(log) {
  return [clean(log.machine_no), clean(log.department_name), clean(log.subwork_name), clean(log.point_name)].map(x => x.toLowerCase()).join("|");
}

async function rebuildBookingStatus() {
  await deleteByFilter("booking_status", "");
  const logs = await listRecords("booking_logs", { perPage: 500 });
  const map = new Map();

  logs.forEach((log) => {
    const key = bookingKey(log);
    if (!key.replace(/\|/g, "")) return;
    const current = map.get(key) || {
      machine_no: clean(log.machine_no),
      machine_type_code: clean(log.machine_type_code),
      machine_category: clean(log.machine_category),
      department_code: clean(log.department_code),
      department_name: clean(log.department_name),
      subwork_code: clean(log.subwork_code),
      subwork_name: clean(log.subwork_name),
      point_code: clean(log.point_code),
      point_name: clean(log.point_name),
      standard_minutes: toNumber(log.original_minutes, 0),
      consumed_minutes: 0,
      last_entry_no: "",
      last_work_date: "",
      last_emp_code: "",
      last_emp_name: ""
    };
    current.standard_minutes = current.standard_minutes || toNumber(log.original_minutes, 0);
    current.consumed_minutes += toNumber(log.standard_consumed, 0);
    const logDate = clean(log.work_date);
    if (!current.last_work_date || logDate >= current.last_work_date) {
      current.last_entry_no = clean(log.entry_no);
      current.last_work_date = logDate;
      current.last_emp_code = clean(log.emp_code);
      current.last_emp_name = clean(log.emp_name);
    }
    map.set(key, current);
  });

  let rebuilt = 0;
  for (const item of map.values()) {
    const standard = toNumber(item.standard_minutes, 0);
    const consumed = toNumber(item.consumed_minutes, 0);
    const remaining = Math.max(0, standard - consumed);
    const completion = standard > 0 ? Math.min(100, (consumed / standard) * 100) : 0;
    await createRecord("booking_status", { ...item, remaining_minutes: remaining, completion_percent: Number(completion.toFixed(2)), status: remaining <= 0 ? "DONE" : consumed > 0 ? "PARTIAL" : "PENDING" });
    rebuilt += 1;
  }
  return { rebuilt, sourceLogs: logs.length };
}

async function backupDb({ includeMaster = true, includeTransactions = true } = {}) {
  const collections = [];
  if (includeMaster !== false) collections.push(...MASTER_COLLECTIONS);
  if (includeTransactions !== false) collections.push(...TRANSACTION_COLLECTIONS);
  const data = { createdAt: new Date().toISOString(), collections: {} };
  for (const collection of collections) data.collections[collection] = await listRecords(collection, { perPage: 500 });
  const dir = path.resolve(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `spwt-db-backup-${todayStamp()}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return { fileName, filePath, collections: Object.fromEntries(Object.entries(data.collections).map(([k, v]) => [k, v.length])) };
}

async function previewDeleteByEmployee(params = {}) {
  const empCode = clean(params.empCode || params.emp_code);
  if (!empCode) {
    const err = new Error("Employee code is required.");
    err.status = 400;
    throw err;
  }
  const counts = {};
  const filters = {};
  for (const collection of DELETE_BY_EMP_COLLECTIONS) {
    const filter = buildEmployeeDateFilter(params, collection);
    filters[collection] = filter;
    counts[collection] = await countRecords(collection, filter);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { empCode, fromDate: clean(params.fromDate), toDate: clean(params.toDate), filters, counts, total };
}

async function deleteByEmployee(params = {}) {
  const preview = await previewDeleteByEmployee(params);
  const confirmText = clean(params.confirmText || params.confirm);
  if (confirmText !== "DELETE") {
    const err = new Error('Type DELETE to confirm employee entry deletion.');
    err.status = 400;
    throw err;
  }
  const results = [];
  for (const collection of DELETE_BY_EMP_COLLECTIONS) results.push(await deleteByFilter(collection, preview.filters[collection] || ""));
  const bookingRebuild = await rebuildBookingStatus();
  return { ...preview, deleted: results, bookingRebuild };
}

async function previewClearTransactions(params = {}) {
  const counts = {};
  const filters = {};
  for (const collection of TRANSACTION_COLLECTIONS) {
    const filter = buildCollectionDateFilter(params, collection);
    filters[collection] = filter;
    counts[collection] = await countRecords(collection, filter);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { fromDate: clean(params.fromDate), toDate: clean(params.toDate), filters, counts, total };
}

async function clearTransactions(params = {}) {
  const confirmText = clean(params.confirmText || params.confirm);
  if (confirmText !== "CLEAR") {
    const err = new Error('Type CLEAR to confirm transaction data deletion.');
    err.status = 400;
    throw err;
  }
  const preview = await previewClearTransactions(params);
  const results = [];
  for (const collection of TRANSACTION_COLLECTIONS) results.push(await deleteByFilter(collection, preview.filters[collection] || ""));
  return { ...preview, deleted: results };
}

async function previewClearSetupData() {
  const counts = {};
  for (const collection of SETUP_CLEAR_COLLECTIONS) counts[collection] = await countRecords(collection, "");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { collections: SETUP_CLEAR_COLLECTIONS, counts, total };
}

async function clearSetupData(params = {}) {
  const confirmText = clean(params.confirmText || params.confirm);
  if (confirmText !== "MASTER") {
    const err = new Error('Type MASTER to confirm setup/master data deletion.');
    err.status = 400;
    throw err;
  }
  const preview = await previewClearSetupData();
  const results = [];
  for (const collection of SETUP_CLEAR_COLLECTIONS) results.push(await deleteByFilter(collection, ""));
  return { ...preview, deleted: results };
}

async function importOldSheetData() {
  const err = new Error("Old sheet import requires column mapping. Upload/export V1 sheet first, then run migration mapping.");
  err.status = 501;
  err.details = { nextStep: "Upload V1 Excel/CSV and map columns to production_entries, lines, attendance, quality_logs." };
  throw err;
}

module.exports = {
  backupDb,
  previewDeleteByEmployee,
  deleteByEmployee,
  previewClearTransactions,
  clearTransactions,
  previewClearSetupData,
  clearSetupData,
  importOldSheetData
};
