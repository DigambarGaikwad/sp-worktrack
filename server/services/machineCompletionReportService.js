// server/services/machineCompletionReportService.js
// Builds machine completion report with period summary and month-wise current-year counts.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function hours(min) { return Number((num(min, 0) / 60).toFixed(2)); }

async function listAll(collectionName, options = {}) {
  const all = [];
  let page = 1;
  const perPage = options.perPage || 1000;
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

function dateOnly(value) {
  const s = clean(value);
  if (!s) return "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : ymd(d);
}

function statusOfMachine(m = {}) {
  const raw = clean(m.status || m.machineStatus || m.machine_status).toLowerCase();
  if (raw === "completed" || raw === "complete") return "Completed";
  if (["inactive", "deleted", "delete", "disabled"].includes(raw)) return "Inactive";
  if (m.active === false) return "Completed";
  return "Active";
}

function rangeFromParams(params = {}) {
  const today = new Date();
  const y = Number(params.year) || today.getFullYear();
  const range = clean(params.range || "currentMonth");

  if ((range === "custom" || range === "selectedDateRange") && params.from && params.to) {
    return { from: clean(params.from), to: clean(params.to), label: "Selected Date Range", mode: "custom", year: y };
  }

  if (range === "currentYear") {
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Current Year ${y}`, mode: "currentYear", year: y };
  }

  const month = Number(params.month) || today.getMonth() + 1;
  const first = new Date(y, month - 1, 1);
  const last = new Date(y, month, 0);
  const monthName = first.toLocaleString("en-IN", { month: "short" });
  return { from: ymd(first), to: ymd(last), label: `Current Month ${monthName} ${y}`, mode: "currentMonth", year: y };
}

function completionDateOf(machine = {}, latestWorkDate = "") {
  return dateOnly(
    machine.completed_date ||
    machine.completion_date ||
    machine.end_date ||
    machine.completedDate ||
    machine.endDate ||
    machine.done_date ||
    machine.closed_date ||
    machine.updated ||
    latestWorkDate ||
    machine.created
  );
}

function monthName(index) {
  return new Date(2000, index, 1).toLocaleString("en-IN", { month: "short" });
}

async function getMachineCompletionReport(params = {}) {
  const range = rangeFromParams(params);
  const monthlyYear = Number(params.year) || range.year || new Date().getFullYear();

  const [machines, machineTypes, lines] = await Promise.all([
    listAll("machines", { perPage: 2000 }),
    listAll("machine_types", { perPage: 1000 }),
    listAll("production_entry_lines", { perPage: 10000, sort: "-work_date" })
  ]);

  const typeNameByCode = new Map(machineTypes.map(t => [clean(t.type_code || t.id || t.typeCode), clean(t.type_name || t.name || t.typeName)]));
  const lineStats = new Map();

  lines.forEach(line => {
    const machineNo = clean(line.machine_no);
    if (!machineNo) return;
    if (!lineStats.has(machineNo)) lineStats.set(machineNo, { latestWorkDate: "", standardMinutes: 0, actualMinutes: 0, lineCount: 0, typeCode: "", category: "" });
    const item = lineStats.get(machineNo);
    const workDate = dateOnly(line.work_date);
    if (workDate > item.latestWorkDate) item.latestWorkDate = workDate;
    if (clean(line.work_nature || "Normal").toLowerCase() === "normal") item.standardMinutes += num(line.standard_minutes, 0);
    item.actualMinutes += num(line.actual_minutes, 0);
    item.lineCount += 1;
    if (!item.typeCode) item.typeCode = clean(line.machine_type_code);
    if (!item.category) item.category = clean(line.machine_category);
  });

  const completedMachines = machines
    .map(m => {
      const machineNo = clean(m.machine_no || m.name || m.machineNo);
      const stats = lineStats.get(machineNo) || {};
      const typeCode = clean(m.machine_type_code || m.type || stats.typeCode || "");
      const category = clean(typeNameByCode.get(typeCode) || m.machine_category || stats.category || typeCode || "-");
      const status = statusOfMachine(m);
      const completionDate = completionDateOf(m, stats.latestWorkDate || "");
      return {
        machineNo,
        machineCategory: category,
        machineTypeCode: typeCode,
        status,
        completionDate,
        startDate: dateOnly(m.start_date || m.startDate || m.created),
        standardHours: hours(stats.standardMinutes || 0),
        actualHours: hours(stats.actualMinutes || 0),
        entryLines: num(stats.lineCount, 0),
        dateSource: clean(m.completed_date || m.completion_date || m.end_date || m.done_date) ? "explicit completion date" : clean(m.updated) ? "machine updated date" : stats.latestWorkDate ? "latest work date" : "created date"
      };
    })
    .filter(m => m.machineNo && m.status === "Completed" && m.completionDate);

  const periodRows = completedMachines
    .filter(m => m.completionDate >= range.from && m.completionDate <= range.to)
    .sort((a, b) => b.completionDate.localeCompare(a.completionDate) || a.machineNo.localeCompare(b.machineNo));

  const monthWise = Array.from({ length: 12 }, (_, i) => {
    const monthNo = i + 1;
    const count = completedMachines.filter(m => m.completionDate.startsWith(`${monthlyYear}-${String(monthNo).padStart(2, "0")}-`)).length;
    return { monthNo, month: monthName(i), year: monthlyYear, count };
  });

  const categoryMap = new Map();
  periodRows.forEach(row => {
    const key = row.machineCategory || "-";
    if (!categoryMap.has(key)) categoryMap.set(key, { name: key, count: 0, standardHours: 0, actualHours: 0 });
    const item = categoryMap.get(key);
    item.count += 1;
    item.standardHours = Number((item.standardHours + num(row.standardHours)).toFixed(2));
    item.actualHours = Number((item.actualHours + num(row.actualHours)).toFixed(2));
  });

  return {
    range,
    summary: {
      completedInPeriod: periodRows.length,
      completedCurrentYear: monthWise.reduce((sum, row) => sum + row.count, 0),
      completedTotal: completedMachines.length,
      standardHours: Number(periodRows.reduce((sum, row) => sum + num(row.standardHours), 0).toFixed(2)),
      actualHours: Number(periodRows.reduce((sum, row) => sum + num(row.actualHours), 0).toFixed(2))
    },
    rows: periodRows,
    byCategory: Array.from(categoryMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    monthWise,
    meta: {
      service: "machineCompletionReportService",
      dateRule: "completed_date/completion_date/end_date if available, otherwise machine updated date, otherwise latest work date",
      machinesChecked: machines.length,
      completedMachines: completedMachines.length,
      monthlyYear
    }
  };
}

module.exports = { getMachineCompletionReport };
