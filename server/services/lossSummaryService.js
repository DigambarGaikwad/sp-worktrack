// server/services/lossSummaryService.js
// Builds Rework / Other / Major Loss / Unplanned Absent summary for Machine Dashboard.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(v) { return String(v ?? "").trim(); }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function hours(min) { return Number((num(min, 0) / 60).toFixed(2)); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d, days) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + days); return x; }
function isActive(value) { if (value === false) return false; return !["false", "0", "inactive", "no", "deleted"].includes(clean(value).toLowerCase()); }
function employeeKey(code, name) { return clean(code || name).toLowerCase(); }

function rangeFromParams(params = {}) {
  const today = new Date();
  const range = clean(params.range || "currentMonth");
  if (params.from && params.to) return { from: clean(params.from), to: clean(params.to), label: "Custom Range" };
  const y = today.getFullYear(), m = today.getMonth();
  if (range === "lastMonth") return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)), label: "Last Month" };
  if (range === "last6Months") return { from: ymd(new Date(y, m - 5, 1)), to: ymd(today), label: "Last 6 Months" };
  if (range === "year") return { from: `${y}-01-01`, to: ymd(today), label: "Current Year" };
  return { from: ymd(new Date(y, m, 1)), to: ymd(today), label: "Current Month" };
}

function inRange(date, range) {
  const d = clean(date);
  return d && d >= range.from && d <= range.to;
}

function workingDates(range) {
  const dates = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) return dates;
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  let cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cursor <= end) {
    if (cursor.getDay() !== 0) dates.push(ymd(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

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

async function listAllSafe(collectionName, options = {}) {
  try { return await listAll(collectionName, options); }
  catch (err) {
    if (err?.status === 404 || /missing collection context/i.test(String(err?.message || ""))) return [];
    throw err;
  }
}

function timeToMinutes(value) {
  const m = clean(value).match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function shiftMinutes(shift = {}) {
  const explicit = num(shift.available_minutes, 0) || num(shift.shift_available, 0);
  if (explicit > 0) return explicit;
  const start = timeToMinutes(shift.start_time || shift.start);
  const end = timeToMinutes(shift.end_time || shift.end);
  if (start == null || end == null) return 465;
  const gross = end >= start ? end - start : end + 1440 - start;
  return Math.max(0, gross - num(shift.break_minutes ?? shift.breakMinutes, 0));
}

function generalShiftMinutes(shifts = []) {
  const general = shifts.find(s => clean(s.shift_name || s.shift_code).toLowerCase().includes("general"));
  return shiftMinutes(general || shifts[0] || {}) || 465;
}

function plannedDateSet(plannedAbsences = []) {
  const set = new Set();
  plannedAbsences.forEach(p => {
    const key = employeeKey(p.emp_code, p.emp_name);
    const from = clean(p.from_date);
    const to = clean(p.to_date || p.from_date);
    if (!key || !from) return;
    workingDates({ from, to }).forEach(d => set.add(`${d}|${key}`));
  });
  return set;
}

function group(rows, keyFn) {
  const map = new Map();
  rows.forEach(r => {
    const name = clean(keyFn(r) || "-");
    if (!map.has(name)) map.set(name, { name, count: 0, hours: 0 });
    const x = map.get(name);
    x.count += 1;
    x.hours = Number((x.hours + num(r.hours, 0)).toFixed(2));
  });
  return Array.from(map.values()).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}

async function getLossSummary(params = {}) {
  const range = rangeFromParams(params);
  const [entries, lines, employees, attendance, plannedAbsences, shifts] = await Promise.all([
    listAll("production_entries", { perPage: 5000, sort: "-work_date" }),
    listAll("production_entry_lines", { perPage: 10000, sort: "-work_date" }),
    listAllSafe("employees", { perPage: 2000 }),
    listAllSafe("attendance", { perPage: 10000, sort: "-work_date" }),
    listAllSafe("planned_absences", { perPage: 5000 }),
    listAllSafe("shifts", { perPage: 500 })
  ]);

  const reworkRows = [];
  const otherRows = [];
  const majorRows = [];
  const absentRows = [];

  lines.filter(l => inRange(l.work_date, range)).forEach(l => {
    const nature = clean(l.work_nature).toLowerCase();
    if (!["rework", "other"].includes(nature)) return;
    const row = {
      workDate: clean(l.work_date),
      type: nature === "rework" ? "Rework" : "Other Work",
      machineNo: clean(l.machine_no),
      department: clean(l.department_name || l.department_code),
      subwork: clean(l.subwork_name || l.subwork_code),
      rootArea: clean(l.root_area),
      reason: clean(l.description || l.efficiency_reason || l.remarks),
      hours: hours(l.actual_minutes),
      empCode: clean(l.emp_code),
      empName: clean(l.emp_name || l.emp_code)
    };
    if (nature === "rework") reworkRows.push(row); else otherRows.push(row);
  });

  entries.filter(e => inRange(e.work_date, range)).forEach(e => {
    const min = num(e.major_loss_minutes, 0);
    if (min <= 0) return;
    majorRows.push({
      workDate: clean(e.work_date),
      type: "Major Loss",
      machineNo: "-",
      department: "-",
      subwork: "-",
      rootArea: "-",
      reason: clean(e.major_loss_reason || e.remarks || "Major Loss"),
      hours: hours(min),
      empCode: clean(e.emp_code),
      empName: clean(e.emp_name || e.emp_code)
    });
  });

  const activeEmployees = employees
    .filter(e => isActive(e.active))
    .map(e => ({ code: clean(e.emp_code || e.empId), name: clean(e.full_name || e.emp_name || e.name), department: clean(e.department) || "-" }))
    .filter(e => e.code || e.name);

  const attended = new Set(
    attendance
      .filter(a => inRange(a.work_date, range))
      .filter(a => clean(a.status || "Present").toLowerCase() !== "absent")
      .map(a => `${clean(a.work_date)}|${employeeKey(a.emp_code, a.emp_name)}`)
  );
  const planned = plannedDateSet(plannedAbsences);
  const dayMinutes = generalShiftMinutes(shifts);

  workingDates(range).forEach(d => {
    activeEmployees.forEach(e => {
      const key = employeeKey(e.code, e.name);
      if (!key || attended.has(`${d}|${key}`) || planned.has(`${d}|${key}`)) return;
      absentRows.push({
        workDate: d,
        type: "Unplanned Absent",
        machineNo: "Manpower",
        department: e.department || "-",
        subwork: "Absent",
        rootArea: "-",
        reason: "No attendance entry and not planned absent",
        hours: hours(dayMinutes),
        empCode: e.code,
        empName: e.name || e.code
      });
    });
  });

  const reworkHours = reworkRows.reduce((s, r) => s + num(r.hours), 0);
  const otherHours = otherRows.reduce((s, r) => s + num(r.hours), 0);
  const majorLossHours = majorRows.reduce((s, r) => s + num(r.hours), 0);
  const unplannedAbsentHours = absentRows.reduce((s, r) => s + num(r.hours), 0);
  const details = [...reworkRows, ...otherRows, ...majorRows, ...absentRows]
    .sort((a, b) => clean(b.workDate).localeCompare(clean(a.workDate)) || clean(a.type).localeCompare(clean(b.type)))
    .slice(0, 1000);

  return {
    range,
    summary: {
      reworkHours: Number(reworkHours.toFixed(2)),
      otherHours: Number(otherHours.toFixed(2)),
      majorLossHours: Number(majorLossHours.toFixed(2)),
      unplannedAbsentHours: Number(unplannedAbsentHours.toFixed(2)),
      unplannedAbsentDays: absentRows.length,
      totalLossHours: Number((reworkHours + otherHours + majorLossHours + unplannedAbsentHours).toFixed(2))
    },
    rework: { byRootArea: group(reworkRows, r => r.rootArea || "Not Specified") },
    otherWork: { byDepartment: group(otherRows, r => r.department || "Not Specified") },
    majorLoss: { byReason: group(majorRows, r => r.reason || "Not Specified") },
    unplannedAbsent: { byEmployee: group(absentRows, r => r.empName || r.empCode || "Unknown"), byDepartment: group(absentRows, r => r.department || "Not Specified") },
    byType: group(details, r => r.type || "Not Specified"),
    details,
    meta: { service: "lossSummaryService", reworkRows: reworkRows.length, otherRows: otherRows.length, majorRows: majorRows.length, unplannedAbsentRows: absentRows.length, activeEmployees: activeEmployees.length, workingDays: workingDates(range).length, shiftMinutesUsed: dayMinutes }
  };
}

module.exports = { getLossSummary };
