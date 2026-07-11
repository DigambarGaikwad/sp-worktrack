// server/services/capacityPlanningService.js
// Read-only helpers for Capacity Planning.
// Keeps planning progress separate from existing production/dashboard code.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }
function key(value) { return clean(value).toLowerCase(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round1(value) { return Number(num(value, 0).toFixed(1)); }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function isMissingCollection(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

async function listAll(collectionName, query = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
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

function isPlanningProductionLine(line = {}) {
  const nature = key(line.work_nature || line.type || "Normal");
  if (!nature) return true;
  return nature === "normal" || nature === "production";
}

function progressKeyOf(line = {}) {
  return [
    clean(line.machine_no),
    clean(line.machine_type_code || line.machine_category),
    clean(line.department_name || line.department_code),
    clean(line.subwork_name || line.subwork_code)
  ].map(key).join("|");
}

function buildDateFilter(params = {}) {
  const fromDate = clean(params.from_date || params.fromDate);
  const cutoffDate = clean(params.cutoff_date || params.cutoffDate || params.to_date || params.toDate);
  const parts = [];
  if (fromDate) parts.push(`work_date>=\"${pbEscape(fromDate)}\"`);
  if (cutoffDate) parts.push(`work_date<=\"${pbEscape(cutoffDate)}\"`);
  return { fromDate, cutoffDate, filter: parts.join(" && ") };
}

async function listProductionProgress(params = {}) {
  const { fromDate, cutoffDate, filter } = buildDateFilter(params);

  let lines = [];
  try {
    lines = await listAll("production_entry_lines", { filter, sort: "-work_date" });
  } catch (err) {
    if (isMissingCollection(err)) lines = [];
    else throw err;
  }

  const map = new Map();
  for (const line of lines) {
    if (!isPlanningProductionLine(line)) continue;
    const machineNo = clean(line.machine_no);
    const dept = clean(line.department_name || line.department_code);
    const subwork = clean(line.subwork_name || line.subwork_code);
    const standard = num(line.standard_minutes, 0);
    if (!machineNo || !dept || !subwork || standard <= 0) continue;

    const k = progressKeyOf(line);
    const old = map.get(k) || {
      key: k,
      machine_no: machineNo,
      machine_type_code: clean(line.machine_type_code || line.machine_category),
      machine_type_name: clean(line.machine_category || line.machine_type_name || line.machine_type_code),
      department_name: dept,
      subwork_name: subwork,
      consumed_standard_minutes: 0,
      consumed_actual_minutes: 0,
      entries: 0,
      first_work_date: "",
      last_work_date: ""
    };

    old.consumed_standard_minutes += standard;
    old.consumed_actual_minutes += num(line.actual_minutes, 0);
    old.entries += 1;
    const workDate = clean(line.work_date);
    if (workDate && (!old.first_work_date || workDate < old.first_work_date)) old.first_work_date = workDate;
    if (workDate && workDate > old.last_work_date) old.last_work_date = workDate;
    map.set(k, old);
  }

  const records = Array.from(map.values()).map((x) => ({
    ...x,
    consumed_standard_minutes: round1(x.consumed_standard_minutes),
    consumed_actual_minutes: round1(x.consumed_actual_minutes)
  })).sort((a, b) => clean(a.machine_no).localeCompare(clean(b.machine_no)) || clean(a.department_name).localeCompare(clean(b.department_name)) || clean(a.subwork_name).localeCompare(clean(b.subwork_name)));

  return { fromDate, cutoffDate, records, total: records.length };
}

module.exports = { listProductionProgress };
