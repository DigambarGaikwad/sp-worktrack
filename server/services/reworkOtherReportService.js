// server/services/reworkOtherReportService.js
// Builds Rework / Other Work reports from DB production entries and lines.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function hours(minutes) { return Number((num(minutes, 0) / 60).toFixed(1)); }
function safeYear(value) { const y = Number(value); return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear(); }
function safeMonth(value) { const m = Number(value); return Number.isInteger(m) && m >= 1 && m <= 12 ? m : new Date().getMonth() + 1; }
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function monthName(month) { return new Date(2000, month - 1, 1).toLocaleString("en-IN", { month: "long" }); }
function inRange(value, range) { const d = clean(value); return d && d >= range.from && d <= range.to; }

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

function selectedRange(params = {}) {
  const period = clean(params.period || "selectedMonth");
  const year = safeYear(params.year);
  const month = safeMonth(params.month);
  if (period === "selectedYear") return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}`, mode: "year", year, month: "All" };
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`, label: `${monthName(month)} ${year}`, mode: "month", year, month };
}

function normalizeType(type) {
  const t = clean(type || "rework").toLowerCase();
  return t === "other" || t === "other work" ? "other" : "rework";
}

function rowMachine(entry = {}, line = {}) {
  return clean(line.machine_no || line.machine || entry.machine_no || entry.machine || entry.machine_name || entry.machine_code);
}

function uniqueMachines(entries = []) {
  return Array.from(new Set(entries.map(e => clean(e.machine_no || e.machine || e.machine_name || e.machine_code)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function lineNature(line = {}) {
  return clean(line.work_nature || line.nature || line.type || line.work_type || "Normal").toLowerCase();
}

async function getReworkOtherReport(params = {}) {
  const reportType = normalizeType(params.type);
  const wantedNature = reportType === "other" ? "other" : "rework";
  const machineFilter = clean(params.machine || params.machineNo || "All");
  const range = selectedRange(params);

  const [entriesRaw, linesRaw] = await Promise.all([
    listAll("production_entries", { perPage: 10000, sort: "-work_date" }),
    listAll("production_entry_lines", { perPage: 20000, sort: "-work_date" })
  ]);

  const entries = entriesRaw.filter(e => inRange(e.work_date, range));
  const entryByNo = new Map(entries.map(e => [clean(e.entry_no), e]));

  const rows = linesRaw
    .filter(line => entryByNo.has(clean(line.entry_no)))
    .map(line => ({ line, entry: entryByNo.get(clean(line.entry_no)) || {} }))
    .filter(({ line }) => lineNature(line) === wantedNature)
    .filter(({ entry, line }) => machineFilter === "All" || rowMachine(entry, line) === machineFilter)
    .map(({ entry, line }) => {
      const actualMinutes = num(line.actual_minutes ?? line.actual_time ?? line.actual, 0);
      const standardMinutes = num(line.standard_minutes ?? line.standard_time ?? line.standard, 0);
      return {
        workDate: clean(line.work_date || entry.work_date),
        shift: clean(line.shift_name || entry.shift_name || entry.shift_code),
        machine: rowMachine(entry, line) || "-",
        empCode: clean(line.emp_code || entry.emp_code),
        empName: clean(line.emp_name || entry.emp_name),
        department: clean(line.department_name || line.department_code || "-"),
        subWork: clean(line.subwork_name || line.sub_work || line.subwork_code || "-"),
        workNature: wantedNature === "other" ? "Other Work" : "Rework",
        rootArea: clean(line.root_area || line.rootArea || line.rework_root_area || ""),
        reason: clean(line.reason || line.rework_reason || line.other_reason || line.major_loss_reason || line.efficiency_reason || ""),
        remark: clean(line.remark || line.remarks || line.description || line.major_loss_remark || ""),
        standardMinutes,
        actualMinutes,
        standardHours: hours(standardMinutes),
        actualHours: hours(actualMinutes),
        entryNo: clean(line.entry_no)
      };
    })
    .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.machine.localeCompare(b.machine) || a.empName.localeCompare(b.empName));

  const byMachine = new Map();
  const byEmployee = new Map();
  rows.forEach(r => {
    if (!byMachine.has(r.machine)) byMachine.set(r.machine, { machine: r.machine, count: 0, actualMinutes: 0, standardMinutes: 0 });
    const m = byMachine.get(r.machine); m.count += 1; m.actualMinutes += r.actualMinutes; m.standardMinutes += r.standardMinutes;
    const empKey = `${r.empCode}|${r.empName}`;
    if (!byEmployee.has(empKey)) byEmployee.set(empKey, { empCode: r.empCode, empName: r.empName, count: 0, actualMinutes: 0, standardMinutes: 0 });
    const e = byEmployee.get(empKey); e.count += 1; e.actualMinutes += r.actualMinutes; e.standardMinutes += r.standardMinutes;
  });

  const totalActualMinutes = rows.reduce((s, r) => s + r.actualMinutes, 0);
  const totalStandardMinutes = rows.reduce((s, r) => s + r.standardMinutes, 0);

  return {
    reportType,
    title: reportType === "other" ? "Other Work Report" : "Rework Report",
    range,
    machine: machineFilter,
    kpis: {
      records: rows.length,
      totalActualHours: hours(totalActualMinutes),
      totalStandardHours: hours(totalStandardMinutes),
      machines: new Set(rows.map(r => r.machine)).size,
      employees: new Set(rows.map(r => `${r.empCode}|${r.empName}`)).size
    },
    rows,
    byMachine: Array.from(byMachine.values()).map(x => ({ ...x, actualHours: hours(x.actualMinutes), standardHours: hours(x.standardMinutes) })).sort((a, b) => b.actualMinutes - a.actualMinutes),
    byEmployee: Array.from(byEmployee.values()).map(x => ({ ...x, actualHours: hours(x.actualMinutes), standardHours: hours(x.standardMinutes) })).sort((a, b) => b.actualMinutes - a.actualMinutes),
    filterOptions: { machines: ["All", ...uniqueMachines(entriesRaw)] },
    meta: { generatedAt: new Date().toISOString(), service: "reworkOtherReportService" }
  };
}

module.exports = { getReworkOtherReport };
