// server/services/masterRecordMaintenanceService.js
// Lists and removes one selected master record at a time from approved PocketBase collections.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }

const TARGETS = {
  employees: { title: "Employees", labelFields: ["emp_code", "full_name"], detailFields: ["department", "designation", "active"] },
  machines: { title: "Machines", labelFields: ["machine_no"], detailFields: ["machine_type_code", "status", "active"] },
  shifts: { title: "Shifts", labelFields: ["shift_code", "shift_name"], detailFields: ["start_time", "end_time", "break_minutes", "active"] },
  loss_reasons: { title: "Loss Reasons", labelFields: ["reason_name"], detailFields: ["active"] },
  root_areas: { title: "Root Areas", labelFields: ["area_name"], detailFields: ["active"] },
  machine_types: { title: "Machine Categories", labelFields: ["type_code", "type_name"], detailFields: ["active"] },
  departments: { title: "Departments / Main Work", labelFields: ["department_code", "department_name"], detailFields: ["active"] },
  subworks: { title: "Sub Works", labelFields: ["subwork_code", "subwork_name"], detailFields: ["machine_type_code", "department_code", "standard_time", "active"] },
  booking_points: { title: "Booking Points", labelFields: ["point_code", "point_name"], detailFields: ["machine_type_code", "department_code", "subwork_code", "standard_time", "active"] },
  quality_points: { title: "Quality Points", labelFields: ["point_code", "point_name"], detailFields: ["machine_type_code", "department_code", "subwork_code", "input_type", "mandatory", "active"] }
};

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context|collection not found/i.test(String(err?.message || ""));
}

function assertTarget(collection) {
  const name = clean(collection);
  if (!TARGETS[name]) {
    const err = new Error("This master type is not allowed for individual deletion.");
    err.status = 400;
    throw err;
  }
  return name;
}

async function listRecords(collectionName) {
  const all = [];
  let page = 1;
  while (true) {
    try {
      const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
        method: "GET",
        query: { page, perPage: 500 }
      });
      const items = Array.isArray(result.items) ? result.items : [];
      all.push(...items);
      if (page >= Number(result.totalPages || 1) || !items.length) break;
      page += 1;
    } catch (err) {
      if (isMissingCollectionError(err)) return [];
      throw err;
    }
  }
  return all;
}

async function getRecord(collectionName, id) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, { method: "GET" });
}

async function removeRecord(collectionName, id) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, { method: "DELETE" });
}

function joinClean(parts, separator = " - ") {
  return parts.map(clean).filter(Boolean).join(separator);
}

function formatItem(collection, record = {}) {
  const cfg = TARGETS[collection] || {};
  const label = joinClean((cfg.labelFields || []).map(field => record[field])) || clean(record.id);
  const details = joinClean((cfg.detailFields || []).map(field => {
    const value = record[field];
    if (value === undefined || value === null || clean(value) === "") return "";
    return `${field}: ${clean(value)}`;
  }), " | ");
  return { id: record.id, label, details };
}

async function listMasterDeleteOptions() {
  const groups = [];
  for (const [collection, cfg] of Object.entries(TARGETS)) {
    const records = await listRecords(collection);
    groups.push({
      collection,
      title: cfg.title,
      count: records.length,
      items: records.map(record => formatItem(collection, record)).sort((a, b) => clean(a.label).localeCompare(clean(b.label)))
    });
  }
  return { groups };
}

async function removeSelectedMasterRecord(params = {}) {
  const collection = assertTarget(params.collection);
  const id = clean(params.id || params.recordId);
  const confirmText = clean(params.confirmText || params.confirm);

  if (!id) {
    const err = new Error("Select a record to delete.");
    err.status = 400;
    throw err;
  }
  if (confirmText !== "DELETE") {
    const err = new Error('Type DELETE to confirm individual master record deletion.');
    err.status = 400;
    throw err;
  }

  const record = await getRecord(collection, id);
  const item = formatItem(collection, record);
  await removeRecord(collection, id);
  return { collection, title: TARGETS[collection].title, deleted: 1, item };
}

module.exports = { listMasterDeleteOptions, removeSelectedMasterRecord };
