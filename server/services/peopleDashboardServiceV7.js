// server/services/peopleDashboardServiceV7.js
// People Dashboard V7: fixed-shift production entries count as present; flexible/OT entries do not.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { getPeopleDashboard: getPeopleDashboardV6 } = require("./peopleDashboardServiceV6");

function clean(value) { return String(value ?? "").trim(); }
function key(value) { return clean(value).toLowerCase(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function empKey(code, name) { return clean(code || name).toLowerCase(); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(date, days) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() + days); return d; }
function pct(numerator, denominator) { const den = num(denominator, 0); return den > 0 ? Number(((num(numerator, 0) / den) * 100).toFixed(1)) : 0; }
function inRange(value, range) { const d = clean(value); return d && d >= range.from && d <= range.to; }
function isActive(value) { if (value === false) return false; const t = key(value); return !["false", "0", "inactive", "no"].includes(t); }

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

function workingDates(range) {
  const dates = [];
  const [fy, fm, fd] = clean(range.from).split("-").map(Number);
  const [ty, tm, td] = clean(range.to).split("-").map(Number);
  let cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cursor <= end) {
    if (cursor.getDay() !== 0) dates.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function normalizeShiftName(value) { return key(value).replace(/[^a-z0-9]+/g, ""); }
function shiftNames(row = {}) {
  return [row.shift_name, row.shift_code, row.name, row.id].map(clean).filter(Boolean);
}
function isFlexibleShift(row = {}) {
  if (row.flexible === true || row.is_flexible === true) return true;
  const text = shiftNames(row).join(" ").toLowerCase();
  return text.includes("overtime") || text.includes("flexible") || text === "ot";
}
function buildFixedShiftLookup(shiftsRaw = []) {
  const fixedKeys = new Set();
  const fixedLabelByKey = new Map();
  (shiftsRaw || []).filter((s) => isActive(s.active)).filter((s) => !isFlexibleShift(s)).forEach((s) => {
    const label = clean(s.shift_name || s.name || s.shift_code || s.id || "Fixed Shift");
    shiftNames(s).forEach((name) => {
      const k = normalizeShiftName(name);
      if (!k) return;
      fixedKeys.add(k);
      fixedLabelByKey.set(k, label);
    });
  });
  return { fixedKeys, fixedLabelByKey };
}
function entryShiftKey(entry = {}) { return normalizeShiftName(entry.shift_name || entry.shift_code || entry.shift_id || entry.shift || ""); }
function entryShiftLabel(entry = {}, fixedLabelByKey = new Map()) {
  const k = entryShiftKey(entry);
  return clean(fixedLabelByKey.get(k) || entry.shift_name || entry.shift_code || entry.shift_id || "Fixed Shift");
}
function isFixedShiftEntry(entry = {}, fixedLookup, shiftFilter) {
  const k = entryShiftKey(entry);
  if (!k || !fixedLookup.fixedKeys.has(k)) return false;
  const requested = clean(shiftFilter || "All");
  if (requested === "All") return true;
  const requestedKey = normalizeShiftName(requested);
  return requestedKey && requestedKey === k;
}
function hasBookedWork(entry = {}) {
  return num(entry.total_actual_minutes, 0) > 0 || num(entry.total_standard_minutes, 0) > 0 || clean(entry.entry_no);
}

function normalizeEmployee(row = {}) {
  return {
    code: clean(row.emp_code || row.code),
    name: clean(row.full_name || row.emp_name || row.name || row.emp_code || row.code),
    department: clean(row.department) || "-",
    availableMinutesDay: num(row.available_minutes_day ?? row.availableMinutesDay, 0)
  };
}
function scopedEmployees(base, employeesRaw, deptFilter, employeeFilter) {
  const details = Array.isArray(base?.filterOptions?.employeeDetails) && base.filterOptions.employeeDetails.length
    ? base.filterOptions.employeeDetails
    : employeesRaw.map(normalizeEmployee);
  return details
    .map(normalizeEmployee)
    .filter((e) => e.code || e.name)
    .filter((e) => deptFilter === "All" || clean(e.department) === deptFilter)
    .filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter);
}
function normalizePlannedAbsences(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    code: key(r.emp_code || r.empCode),
    name: key(r.emp_name || r.empName),
    from: clean(r.from_date || r.fromDate),
    to: clean(r.to_date || r.toDate || r.from_date || r.fromDate),
    status: key(r.status || "Planned")
  })).filter((r) => (r.code || r.name) && r.from && !["cancelled", "canceled", "deleted"].includes(r.status));
}
function isPlannedAbsent(emp, date, plannedAbsences) {
  const code = key(emp.code);
  const name = key(emp.name);
  return plannedAbsences.some((p) => ((p.code && code && p.code === code) || (p.name && name && p.name === name)) && date >= p.from && date <= p.to);
}

function fixedShiftPresence({ base, employees, entriesRaw, shiftsRaw, plannedAbsencesRaw, shiftFilter, deptFilter, employeeFilter }) {
  const dates = workingDates(base.range || {});
  const fixedLookup = buildFixedShiftLookup(shiftsRaw);
  const presentByDate = new Map();
  const shiftByEmpDate = new Map();
  const employeeMap = new Map();
  employees.forEach((e) => employeeMap.set(empKey(e.code, e.name), e));

  entriesRaw
    .filter((entry) => inRange(entry.work_date, base.range || {}))
    .filter((entry) => isFixedShiftEntry(entry, fixedLookup, shiftFilter))
    .filter(hasBookedWork)
    .forEach((entry) => {
      const d = clean(entry.work_date);
      const k = empKey(entry.emp_code, entry.emp_name);
      if (!d || !k || !employeeMap.has(k)) return;
      if (!presentByDate.has(d)) presentByDate.set(d, new Set());
      presentByDate.get(d).add(k);
      const sk = `${k}|${d}`;
      const label = entryShiftLabel(entry, fixedLookup.fixedLabelByKey);
      if (!shiftByEmpDate.has(sk)) shiftByEmpDate.set(sk, new Set());
      shiftByEmpDate.get(sk).add(label);
    });

  const presentRows = [];
  const absentRows = [];
  employees.forEach((emp) => {
    const k = empKey(emp.code, emp.name);
    const presentDates = [];
    const absentDates = [];
    const shifts = new Set();
    dates.forEach((d) => {
      if (presentByDate.get(d)?.has(k)) {
        presentDates.push(d);
        (shiftByEmpDate.get(`${k}|${d}`) || new Set()).forEach((s) => shifts.add(s));
      } else {
        absentDates.push(d);
      }
    });
    if (presentDates.length) presentRows.push({ ...emp, shift: Array.from(shifts).sort().join(", ") || "Fixed Shift", days: presentDates.length, presentDates });
    if (absentDates.length) absentRows.push({ ...emp, shift: "Fixed Shift", days: absentDates.length, absentDates });
  });

  const plannedAbsences = normalizePlannedAbsences(plannedAbsencesRaw);
  const plannedMap = new Map();
  const unplannedMap = new Map();
  let plannedAbsentDays = 0;
  let unplannedAbsentDays = 0;
  absentRows.forEach((row) => {
    row.absentDates.forEach((date) => {
      const planned = isPlannedAbsent(row, date, plannedAbsences);
      const target = planned ? plannedMap : unplannedMap;
      const k = row.code || row.name;
      if (!target.has(k)) target.set(k, { ...row, absentDates: [], days: 0, absenceType: planned ? "Planned" : "Unplanned" });
      target.get(k).absentDates.push(date);
      target.get(k).days += 1;
      if (planned) plannedAbsentDays += 1;
      else unplannedAbsentDays += 1;
    });
  });

  const sortPeople = (a, b) => num(b.days, 0) - num(a.days, 0) || clean(a.name).localeCompare(clean(b.name));
  const absentPersonDays = absentRows.reduce((sum, row) => sum + num(row.days, 0), 0);
  const totalPersonDays = employees.length * dates.length;

  return {
    present: presentRows.sort(sortPeople),
    absent: absentRows.sort(sortPeople),
    plannedAbsent: Array.from(plannedMap.values()).sort(sortPeople),
    unplannedAbsent: Array.from(unplannedMap.values()).sort(sortPeople),
    plannedAbsentEmployees: plannedMap.size,
    unplannedAbsentEmployees: unplannedMap.size,
    plannedAbsentDays,
    unplannedAbsentDays,
    absentPct: pct(absentPersonDays, totalPersonDays),
    absentPersonDays,
    totalPersonDays,
    fixedShiftLabels: Array.from(new Set(Array.from(fixedLookup.fixedLabelByKey.values()))).sort()
  };
}

async function getPeopleDashboard(params = {}) {
  const base = await getPeopleDashboardV6(params);
  const shiftFilter = clean(params.shift || "All");
  const deptFilter = clean(params.department || "All");
  const employeeFilter = clean(params.employee || "All");

  const [employeesRaw, entriesRaw, shiftsRaw, plannedAbsencesRaw] = await Promise.all([
    listAll("employees", { perPage: 1000 }),
    listAll("production_entries", { perPage: 5000, sort: "-work_date" }),
    listAll("shifts", { perPage: 500 }),
    listAll("planned_absences", { perPage: 5000 }).catch(() => [])
  ]);

  const employees = scopedEmployees(base, employeesRaw, deptFilter, employeeFilter);
  const presence = fixedShiftPresence({ base, employees, entriesRaw, shiftsRaw, plannedAbsencesRaw, shiftFilter, deptFilter, employeeFilter });

  base.presentList = presence.present;
  base.yesterdayAbsent = presence.absent;
  base.monthAbsent = presence.absent;
  base.plannedAbsent = presence.plannedAbsent;
  base.unplannedAbsent = presence.unplannedAbsent;
  base.kpis = {
    ...(base.kpis || {}),
    presentEmployees: presence.present.length,
    absentEmployees: presence.absent.length,
    plannedAbsentEmployees: presence.plannedAbsentEmployees,
    unplannedAbsentEmployees: presence.unplannedAbsentEmployees,
    plannedAbsentDays: presence.plannedAbsentDays,
    unplannedAbsentDays: presence.unplannedAbsentDays,
    absentPctCurrentMonth: presence.absentPct,
    monthAbsentDays: presence.absentPersonDays,
    monthAvailablePersonDays: presence.totalPersonDays
  };
  base.meta = {
    ...(base.meta || {}),
    service: "peopleDashboardServiceV7",
    attendanceRule: "present_when_work_booked_in_any_fixed_shift; flexible_overtime_shift_ignored_for_presence",
    fixedPresenceShifts: presence.fixedShiftLabels
  };
  return base;
}

module.exports = { getPeopleDashboard };
