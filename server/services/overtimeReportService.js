// server/services/overtimeReportService.js
// Builds ideal Overtime Report from production_entries + production_entry_lines.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function hours(minutes) { return Number((num(minutes, 0) / 60).toFixed(2)); }
function pct(a, b) { return b > 0 ? Number(((a / b) * 100).toFixed(1)) : 0; }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

async function listAll(collection, options = {}) {
  const perPage = options.perPage || 500;
  const query = { page: 1, perPage, filter: options.filter || "", sort: options.sort || "-created" };
  const items = [];

  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collection}/records`, { method: "GET", query });
    items.push(...(result.items || []));
    if (!result.items?.length || query.page >= Number(result.totalPages || 1)) break;
    query.page += 1;
  }

  return items;
}

function dateRange({ period = "", year = "", month = "", fromDate = "", toDate = "" } = {}) {
  const now = new Date();
  const y = Number(year || now.getFullYear());
  const m = Number(month || (now.getMonth() + 1));
  const p = clean(period || "selectedMonth");

  if (clean(fromDate) && clean(toDate)) {
    return { from: clean(fromDate), to: clean(toDate), label: `${clean(fromDate)} to ${clean(toDate)}` };
  }

  if (p === "selectedYear") return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` };

  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}`, label: `${mm}/${y}` };
}

async function getLinesForEntries(entries) {
  const entryNos = new Set(entries.map((e) => clean(e.entry_no)).filter(Boolean));
  const byEntryNo = new Map();
  entryNos.forEach((no) => byEntryNo.set(no, []));

  const allLines = await listAll("production_entry_lines", { perPage: 20000, sort: "work_date,entry_no,line_no" });

  allLines.forEach((line) => {
    const entryNo = clean(line.entry_no);
    if (!entryNos.has(entryNo)) return;
    if (!byEntryNo.has(entryNo)) byEntryNo.set(entryNo, []);
    byEntryNo.get(entryNo).push(line);
  });

  return byEntryNo;
}

function makeLineRow(entry, line) {
  const standardMinutes = num(line.standard_minutes ?? line.standardTime ?? line.standard_time, 0);
  const actualMinutes = num(line.actual_minutes ?? line.actualTime ?? line.actual_time, 0);

  return {
    entryId: clean(entry.entry_no || entry.id),
    workDate: clean(entry.work_date),
    shift: clean(entry.shift),
    empCode: clean(entry.emp_code),
    empName: clean(entry.emp_name),
    machine: clean(entry.machine_no || entry.machine || line.machine_no || line.machine),
    machineCategory: clean(entry.machine_category || entry.machine_type || line.machine_category),
    department: clean(line.department || line.main_work || line.work_type),
    subWork: clean(line.sub_work || line.subwork || line.work_name),
    description: clean(line.description || line.remarks || line.remark),
    standardMinutes,
    actualMinutes,
    standardHours: hours(standardMinutes),
    actualHours: hours(actualMinutes),
    productivityPct: pct(standardMinutes, actualMinutes)
  };
}

async function getOvertimeReport(params = {}) {
  const range = dateRange(params);
  const filter = `work_type = "Overtime" && work_date >= "${range.from}" && work_date <= "${range.to}"`;
  const entries = await listAll("production_entries", { filter, sort: "work_date,emp_name" });
  const lineMap = await getLinesForEntries(entries);

  const rows = [];
  entries.forEach((entry) => {
    const lines = lineMap.get(clean(entry.entry_no)) || [];
    if (lines.length) {
      lines.forEach((line) => rows.push(makeLineRow(entry, line)));
      return;
    }

    rows.push({
      entryId: clean(entry.entry_no || entry.id),
      workDate: clean(entry.work_date),
      shift: clean(entry.shift),
      empCode: clean(entry.emp_code),
      empName: clean(entry.emp_name),
      machine: clean(entry.machine_no || entry.machine),
      machineCategory: clean(entry.machine_category || entry.machine_type),
      department: "",
      subWork: "",
      description: "No line details found",
      standardMinutes: num(entry.total_standard_minutes, 0),
      actualMinutes: num(entry.total_actual_minutes, 0),
      standardHours: hours(entry.total_standard_minutes),
      actualHours: hours(entry.total_actual_minutes),
      productivityPct: pct(num(entry.total_standard_minutes, 0), num(entry.total_actual_minutes, 0))
    });
  });

  const byEmployeeMap = new Map();
  rows.forEach((r) => {
    const key = r.empCode || r.empName || "Unknown";
    const emp = byEmployeeMap.get(key) || {
      empCode: r.empCode,
      empName: r.empName,
      actualMinutes: 0,
      standardMinutes: 0,
      entries: new Set(),
      lines: []
    };
    emp.actualMinutes += r.actualMinutes;
    emp.standardMinutes += r.standardMinutes;
    emp.entries.add(r.entryId || `${r.workDate}-${r.machine}`);
    emp.lines.push(r);
    byEmployeeMap.set(key, emp);
  });

  const byEmployee = Array.from(byEmployeeMap.values()).map((x) => ({
    empCode: x.empCode,
    empName: x.empName,
    actualMinutes: x.actualMinutes,
    standardMinutes: x.standardMinutes,
    actualHours: hours(x.actualMinutes),
    standardHours: hours(x.standardMinutes),
    productivityPct: pct(x.standardMinutes, x.actualMinutes),
    entries: x.entries.size,
    lineCount: x.lines.length,
    lines: x.lines.sort((a, b) => clean(a.workDate).localeCompare(clean(b.workDate)) || clean(a.machine).localeCompare(clean(b.machine)))
  })).sort((a, b) => b.actualMinutes - a.actualMinutes);

  const totalActualMinutes = rows.reduce((s, r) => s + r.actualMinutes, 0);
  const totalStandardMinutes = rows.reduce((s, r) => s + r.standardMinutes, 0);

  return {
    title: "Overtime Report",
    period: range.label,
    fromDate: range.from,
    toDate: range.to,
    summary: {
      employees: byEmployee.length,
      entries: entries.length,
      lines: rows.length,
      totalActualHours: hours(totalActualMinutes),
      totalStandardHours: hours(totalStandardMinutes),
      productivityPct: pct(totalStandardMinutes, totalActualMinutes)
    },
    byEmployee,
    rows,
    meta: { generatedAt: new Date().toISOString(), service: "overtimeReportService" }
  };
}

module.exports = { getOvertimeReport };

