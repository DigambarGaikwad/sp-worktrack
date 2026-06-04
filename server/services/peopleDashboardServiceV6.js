// server/services/peopleDashboardServiceV6.js
// People Dashboard DB service with selected Month/Year filters, planned absence split and configurable scoring.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { getPerformanceScoreRules } = require("./adminControlService");

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, num(value, 0))); }
function isActive(value) { if (value === false) return false; const t = clean(value).toLowerCase(); return !["false", "0", "inactive", "no"].includes(t); }
function empKey(code, name) { return clean(code || name).toLowerCase(); }
function hours(minutes) { return Number((num(minutes, 0) / 60).toFixed(1)); }
function pct(numerator, denominator) { const den = num(denominator, 0); return den > 0 ? Number(((num(numerator, 0) / den) * 100).toFixed(1)) : 0; }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(date, days) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() + days); return d; }
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function safeYear(value) { const y = Number(value); return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null; }
function safeMonth(value) { const m = Number(value); return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null; }
function inRange(value, range) { const d = clean(value); return d && d >= range.from && d <= range.to; }
function isGeneralShift(value) { const t = clean(value).toLowerCase(); return t.includes("general") || t === "g" || t === "gen"; }
function timeToMinutes(value) { const m = clean(value).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function monthName(month) { return new Date(2000, month - 1, 1).toLocaleString("en-IN", { month: "long" }); }

function capFutureRange(range) {
  const today = dateKey(new Date());
  if (range.from <= today && range.to > today) return { ...range, to: today };
  return range;
}

function periodRange(period) {
  const today = new Date();
  const key = clean(period || "yesterday");
  if (key === "today") return { from: dateKey(today), to: dateKey(today), label: "Today", mode: "day" };
  if (key === "yesterday") { const y = addDays(today, -1); return { from: dateKey(y), to: dateKey(y), label: "Yesterday", mode: "day" }; }
  if (key === "last7") return { from: dateKey(addDays(today, -6)), to: dateKey(today), label: "Last 7 Days", mode: "last7" };
  return { from: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: dateKey(today), label: "This Month", mode: "month" };
}

function selectedRange(params = {}) {
  const period = clean(params.period || "yesterday");
  const now = new Date();
  const year = safeYear(params.year) || now.getFullYear();
  const month = safeMonth(params.month) || (now.getMonth() + 1);
  if (period === "selectedYear") return capFutureRange({ from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}`, mode: "year", year, month: "All" });
  if (period === "selectedMonth") return capFutureRange({ from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`, label: `${monthName(month)} ${year}`, mode: "month", year, month });
  return periodRange(period);
}

function workingDates(range) {
  const dates = [];
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  let cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cursor <= end) { if (cursor.getDay() !== 0) dates.push(dateKey(cursor)); cursor = addDays(cursor, 1); }
  return dates;
}

async function listAll(collectionName, options = {}) {
  const all = [];
  let page = 1;
  const perPage = options.perPage || 500;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "GET", query: { page, perPage, filter: options.filter || "", sort: options.sort || "" } });
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return all;
}

function calculateShiftMinutes(shift) {
  const explicit = num(shift.available_minutes, 0) || num(shift.shift_available, 0);
  if (explicit > 0) return explicit;
  const start = timeToMinutes(shift.start_time || shift.start);
  const end = timeToMinutes(shift.end_time || shift.end);
  if (start == null || end == null) return 0;
  let total = end - start;
  if (total < 0) total += 24 * 60;
  return Math.max(total - num(shift.break_minutes ?? shift.breakMinutes, 0), 0);
}

function getGeneralShiftMinutes(shifts) {
  const general = shifts.find((s) => isGeneralShift(s.shift_name || s.shift_code || s.name));
  return general ? calculateShiftMinutes(general) : 0;
}

function employeeDailyMinutes(emp, fallbackMinutes) {
  return num(emp.availableMinutesDay ?? emp.available_minutes_day, 0) || fallbackMinutes || 465;
}

function personBase(emp = {}) {
  return { code: clean(emp.code || emp.emp_code), name: clean(emp.name || emp.full_name || emp.emp_name || emp.code || emp.emp_code), masterDepartment: clean(emp.department), designation: clean(emp.designation), availableMinutesDay: num(emp.availableMinutesDay ?? emp.available_minutes_day, 0), available: 0, actual: 0, standard: 0, normalAvailable: 0, normalStandard: 0, overtimeActual: 0, overtimeStandard: 0, rework: 0, other: 0, majorLoss: 0, entries: 0, presentDates: new Set(), deptMinutes: new Map() };
}

function preferredDepartment(person) {
  if (person.masterDepartment) return person.masterDepartment;
  let bestDept = "-", bestMinutes = 0;
  person.deptMinutes.forEach((minutes, dept) => { if (minutes > bestMinutes) { bestMinutes = minutes; bestDept = dept; } });
  return bestDept;
}

function scorePart(percent, weight, capPct) {
  return Number(((clamp(percent, 0, capPct) / Math.max(1, num(capPct, 100))) * num(weight, 0)).toFixed(1));
}

function scorePerson(metrics, rules) {
  if (metrics.availableHours <= 0) return { score: 0, positive: 0, penalties: 0, details: {} };
  const details = {
    productivity: scorePart(metrics.productivityPct, rules.productivityWeight, rules.productivityCapPct),
    utilization: scorePart(metrics.utilizationPct, rules.utilizationWeight, rules.utilizationCapPct),
    efficiency: scorePart(metrics.efficiencyPct, rules.efficiencyWeight, rules.efficiencyCapPct),
    attendance: scorePart(metrics.attendancePct, rules.attendanceWeight, rules.attendanceCapPct),
    reworkPenalty: Number((clamp(metrics.reworkHours, 0, 999) * num(rules.reworkPenaltyPerHour, 0)).toFixed(1)),
    otherWorkPenalty: Number((clamp(metrics.otherWorkHours, 0, 999) * num(rules.otherWorkPenaltyPerHour, 0)).toFixed(1)),
    unplannedAbsentPenalty: Number((clamp(metrics.unplannedAbsentDays, 0, 366) * num(rules.unplannedAbsentPenaltyPerDay, 0)).toFixed(1)),
    plannedAbsentPenalty: Number((clamp(metrics.plannedAbsentDays, 0, 366) * num(rules.plannedAbsentPenaltyPerDay, 0)).toFixed(1)),
    plannedExtraPenalty: Number((Math.max(0, num(metrics.plannedLeaveYearDays, 0) - num(rules.plannedLeaveAllowedPerYear, 0)) * num(rules.plannedExtraPenaltyPerDay, 0)).toFixed(1))
  };
  const positive = Number((details.productivity + details.utilization + details.efficiency + details.attendance).toFixed(1));
  const penalties = Number((details.reworkPenalty + details.otherWorkPenalty + details.unplannedAbsentPenalty + details.plannedAbsentPenalty + details.plannedExtraPenalty).toFixed(1));
  const score = Number(clamp(positive - penalties, rules.minScore, rules.maxScore).toFixed(1));
  return { score, positive, penalties, details };
}

function makeOutputPerson(person, absenceStats, workingDays, scoreRules) {
  const key = empKey(person.code, person.name);
  const productivityPct = pct(person.standard, person.available);
  const utilizationPct = pct(person.actual, person.available);
  const efficiencyPct = pct(person.standard, person.actual);
  const availableHours = hours(person.available);
  const reworkHours = hours(person.rework);
  const otherWorkHours = hours(person.other);
  const plannedAbsentDays = num(absenceStats.planned.get(key), 0);
  const unplannedAbsentDays = num(absenceStats.unplanned.get(key), 0);
  const absentDays = plannedAbsentDays + unplannedAbsentDays;
  const plannedLeaveYearDays = num(absenceStats.plannedYear.get(key), 0);
  const attendancePct = pct(person.presentDates.size, workingDays.length);
  const scoreResult = scorePerson({ productivityPct, utilizationPct, efficiencyPct, attendancePct, reworkHours, otherWorkHours, availableHours, plannedAbsentDays, unplannedAbsentDays, plannedLeaveYearDays }, scoreRules);

  return { code: person.code, name: person.name || person.code || "Unknown", department: preferredDepartment(person), designation: person.designation, availableMinutesDay: person.availableMinutesDay, score: scoreResult.score, scoreBreakdown: scoreResult, scoreInputs: { productivityPct, utilizationPct, efficiencyPct, attendancePct, reworkHours, otherWorkHours, plannedAbsentDays, unplannedAbsentDays, absentDays, plannedLeaveYearDays }, yesterdayProductivityPct: productivityPct, monthProductivityPct: productivityPct, overtimeHours: hours(person.overtimeActual), absentDays, plannedAbsentDays, unplannedAbsentDays, plannedLeaveYearDays, normalProductivityPct: pct(person.normalStandard, person.normalAvailable), overtimeProductivityPct: pct(person.overtimeStandard, person.overtimeActual), efficiencyPct, reworkHours, otherWorkHours, presentDays: person.presentDates.size, availableHours, utilizedHours: hours(person.actual), standardOutputHours: hours(person.standard), badges: [] };
}

function addUnique(list, value) { const v = clean(value); if (v && !list.includes(v)) list.push(v); }
function yearsFromDates(...lists) { const years = new Set(); lists.flat().forEach((x) => { const y = clean(x?.work_date).slice(0, 4); if (/^\d{4}$/.test(y)) years.add(y); }); years.add(String(new Date().getFullYear())); return Array.from(years).sort((a, b) => Number(b) - Number(a)); }

function buildAttendanceByDate(attendance, range, shiftFilter) {
  const map = new Map();
  attendance.filter((a) => inRange(a.work_date, range)).filter((a) => isGeneralShift(a.shift_name || a.shift_code)).filter((a) => shiftFilter === "All" || clean(a.shift_name || a.shift_code) === shiftFilter).forEach((a) => {
    const d = clean(a.work_date), key = empKey(a.emp_code, a.emp_name);
    if (!d || !key) return;
    if (!map.has(d)) map.set(d, new Set());
    map.get(d).add(key);
  });
  return map;
}

function buildPresenceLists(activeEmployees, attendanceByDate, dates, deptFilter, employeeFilter) {
  const employees = activeEmployees.filter((e) => deptFilter === "All" || clean(e.department) === deptFilter).filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter);
  const presentMap = new Map(), absentMap = new Map();
  employees.forEach((e) => { const k = empKey(e.code, e.name); presentMap.set(k, { ...e, presentDates: [] }); absentMap.set(k, { ...e, absentDates: [] }); });
  dates.forEach((d) => { const set = attendanceByDate.get(d) || new Set(); employees.forEach((e) => { const k = empKey(e.code, e.name); if (set.has(k)) presentMap.get(k).presentDates.push(d); else absentMap.get(k).absentDates.push(d); }); });
  const present = Array.from(presentMap.values()).filter((x) => x.presentDates.length > 0).map((x) => ({ code: x.code, name: x.name || x.code, department: x.department || "-", availableMinutesDay: x.availableMinutesDay, shift: "General", days: x.presentDates.length, presentDates: x.presentDates })).sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));
  const absent = Array.from(absentMap.values()).filter((x) => x.absentDates.length > 0).map((x) => ({ code: x.code, name: x.name || x.code, department: x.department || "-", availableMinutesDay: x.availableMinutesDay, shift: "General", days: x.absentDates.length, absentDates: x.absentDates })).sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));
  return { present, absent };
}

function normalizePlannedAbsences(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ code: clean(r.emp_code || r.empCode).toLowerCase(), name: clean(r.emp_name || r.empName).toLowerCase(), department: clean(r.department), from: clean(r.from_date || r.fromDate), to: clean(r.to_date || r.toDate || r.from_date || r.fromDate), reason: clean(r.reason), remark: clean(r.remark), status: clean(r.status || "Planned") })).filter((r) => (r.code || r.name) && r.from && !["cancelled", "canceled", "deleted"].includes(r.status.toLowerCase()));
}

function isPlannedAbsent(emp, date, plannedAbsences) {
  const code = clean(emp.code).toLowerCase();
  const name = clean(emp.name).toLowerCase();
  return plannedAbsences.some((p) => {
    const sameEmployee = (p.code && code && p.code === code) || (p.name && name && p.name === name);
    return sameEmployee && date >= p.from && date <= p.to;
  });
}

function splitAbsentRowsByPlan(absentRows, plannedAbsences) {
  const plannedMap = new Map(), unplannedMap = new Map();
  let plannedAbsentDays = 0, unplannedAbsentDays = 0;
  (absentRows || []).forEach((row) => {
    (row.absentDates || []).forEach((date) => {
      const planned = isPlannedAbsent(row, date, plannedAbsences);
      const target = planned ? plannedMap : unplannedMap;
      const key = row.code || row.name;
      if (!target.has(key)) target.set(key, { ...row, absentDates: [], days: 0, absenceType: planned ? "Planned" : "Unplanned" });
      target.get(key).absentDates.push(date);
      target.get(key).days += 1;
      if (planned) plannedAbsentDays += 1;
      else unplannedAbsentDays += 1;
    });
  });
  return { plannedAbsent: Array.from(plannedMap.values()), unplannedAbsent: Array.from(unplannedMap.values()), plannedAbsentEmployees: plannedMap.size, unplannedAbsentEmployees: unplannedMap.size, plannedAbsentDays, unplannedAbsentDays };
}

function absenceStatsForScoring(absentRows, plannedAbsences, activeEmployees, year) {
  const planned = new Map(), unplanned = new Map(), plannedYear = new Map();
  (absentRows || []).forEach((row) => {
    const key = empKey(row.code, row.name);
    (row.absentDates || []).forEach((date) => {
      const map = isPlannedAbsent(row, date, plannedAbsences) ? planned : unplanned;
      map.set(key, num(map.get(key), 0) + 1);
    });
  });
  const employeesByCode = new Map();
  activeEmployees.forEach((e) => { if (e.code) employeesByCode.set(e.code.toLowerCase(), empKey(e.code, e.name)); if (e.name) employeesByCode.set(e.name.toLowerCase(), empKey(e.code, e.name)); });
  plannedAbsences.forEach((p) => {
    const key = employeesByCode.get(p.code) || employeesByCode.get(p.name) || p.code || p.name;
    const from = p.from < `${year}-01-01` ? `${year}-01-01` : p.from;
    const to = p.to > `${year}-12-31` ? `${year}-12-31` : p.to;
    if (from > to) return;
    let [fy, fm, fd] = from.split("-").map(Number);
    let [ty, tm, td] = to.split("-").map(Number);
    let d = new Date(fy, fm - 1, fd), end = new Date(ty, tm - 1, td);
    while (d <= end) { if (d.getDay() !== 0) plannedYear.set(key, num(plannedYear.get(key), 0) + 1); d = addDays(d, 1); }
  });
  return { planned, unplanned, plannedYear };
}

function absencePctForRange(activeEmployees, attendanceRaw, range, shiftFilter, deptFilter, employeeFilter) {
  const dates = workingDates(range);
  const scopedEmployees = activeEmployees.filter((e) => deptFilter === "All" || clean(e.department) === deptFilter).filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter);
  const attendanceByDate = buildAttendanceByDate(attendanceRaw, range, shiftFilter);
  const presence = buildPresenceLists(scopedEmployees, attendanceByDate, dates, "All", "All");
  const absentPersonDays = presence.absent.reduce((sum, x) => sum + num(x.days, 0), 0);
  const totalPersonDays = scopedEmployees.length * dates.length;
  return { absentPersonDays, totalPersonDays, absentPct: pct(absentPersonDays, totalPersonDays) };
}

function buildInsights(kpis, departments, employees, label) {
  const insights = [];
  if (num(kpis.unplannedAbsentEmployees) > 0) insights.push({ icon: "PEOPLE", title: "Unplanned Absence", text: `${kpis.unplannedAbsentEmployees} unplanned absent employee(s) in ${label}. Review manpower allocation.` });
  else if (num(kpis.absentEmployees) > 0) insights.push({ icon: "PEOPLE", title: "Planned Absence", text: `${kpis.absentEmployees} absent employee(s) in ${label}. Check planned leave coverage.` });
  const weakDept = departments.find((d) => num(d.productivityPct) < 70 && num(d.people) > 0);
  if (weakDept) insights.push({ icon: "TREND", title: "Department Efficiency Watch", text: `${weakDept.department} is at ${weakDept.productivityPct}% productivity. Review delay, rework or support need.` });
  if (num(kpis.reworkHours) > 0) insights.push({ icon: "ALERT", title: "Rework Visibility", text: `${kpis.reworkHours} rework hour(s) recorded in selected period.` });
  const top = employees.find((e) => num(e.score) > 0);
  if (top) insights.push({ icon: "TOP", title: "Recognition", text: `${top.name} is leading selected period with score ${top.score}.` });
  if (!insights.length) insights.push({ icon: "INFO", title: "No Major Risk", text: "No major manpower or productivity issue detected for selected period." });
  return insights;
}

async function getPeopleDashboard(params = {}) {
  const period = clean(params.period || "yesterday");
  const shiftFilter = clean(params.shift || "All");
  const deptFilter = clean(params.department || "All");
  const employeeFilter = clean(params.employee || "All");
  const range = selectedRange(params);
  const selectedWorkingDays = workingDates(range);
  const scoreRules = await getPerformanceScoreRules().catch(() => null);
  const activeScoreRules = scoreRules || { productivityWeight: 45, utilizationWeight: 20, efficiencyWeight: 15, attendanceWeight: 20, productivityCapPct: 120, utilizationCapPct: 100, efficiencyCapPct: 120, attendanceCapPct: 100, reworkPenaltyPerHour: 1, otherWorkPenaltyPerHour: 0.3, unplannedAbsentPenaltyPerDay: 2, plannedAbsentPenaltyPerDay: 0, plannedLeaveAllowedPerYear: 12, plannedExtraPenaltyPerDay: 0.5, minScore: 0, maxScore: 100 };

  const [employeesRaw, entriesRaw, linesRaw, attendanceRaw, shiftsRaw, departmentsRaw, plannedAbsencesRaw] = await Promise.all([
    listAll("employees", { perPage: 1000 }),
    listAll("production_entries", { perPage: 5000, sort: "-work_date" }),
    listAll("production_entry_lines", { perPage: 10000, sort: "-work_date" }),
    listAll("attendance", { perPage: 10000, sort: "-work_date" }),
    listAll("shifts", { perPage: 500 }),
    listAll("departments", { perPage: 1000 }),
    listAll("planned_absences", { perPage: 5000 }).catch(() => [])
  ]);

  const generalShiftMinutes = getGeneralShiftMinutes(shiftsRaw) || 465;
  const activeEmployees = employeesRaw.filter((e) => isActive(e.active)).map((e) => ({ code: clean(e.emp_code), name: clean(e.full_name), department: clean(e.department) || "-", designation: clean(e.designation), availableMinutesDay: num(e.available_minutes_day, 0) || generalShiftMinutes })).filter((e) => e.code || e.name);
  const scopedActiveEmployees = activeEmployees.filter((e) => deptFilter === "All" || clean(e.department) === deptFilter).filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter);
  const peopleMap = new Map();
  activeEmployees.forEach((e) => {
    const p = personBase(e);
    p.availableMinutesDay = employeeDailyMinutes(e, generalShiftMinutes);
    p.available = selectedWorkingDays.length * p.availableMinutesDay;
    p.normalAvailable = p.available;
    peopleMap.set(empKey(e.code, e.name), p);
  });

  const selectedEntries = entriesRaw.filter((entry) => inRange(entry.work_date, range)).filter((entry) => shiftFilter === "All" || clean(entry.shift_name || entry.shift_code) === shiftFilter).filter((entry) => employeeFilter === "All" || clean(entry.emp_name || entry.emp_code) === employeeFilter);
  const entrySet = new Set(selectedEntries.map((e) => clean(e.entry_no)).filter(Boolean));
  const selectedLines = linesRaw.filter((line) => entrySet.has(clean(line.entry_no)));

  selectedEntries.forEach((entry) => {
    const key = empKey(entry.emp_code, entry.emp_name);
    if (!peopleMap.has(key)) peopleMap.set(key, personBase({ code: entry.emp_code, name: entry.emp_name, availableMinutesDay: generalShiftMinutes }));
    const p = peopleMap.get(key);
    if (!p.available) { p.availableMinutesDay = p.availableMinutesDay || generalShiftMinutes; p.available = selectedWorkingDays.length * p.availableMinutesDay; p.normalAvailable = p.available; }
    const actual = num(entry.total_actual_minutes, 0), standard = num(entry.total_standard_minutes, 0);
    const isOvertime = clean(entry.work_type).toLowerCase() === "overtime" || num(entry.flexible_shift_minutes, 0) > 0;
    p.actual += actual; p.standard += standard; p.majorLoss += num(entry.major_loss_minutes, 0); p.entries += 1; p.presentDates.add(clean(entry.work_date));
    if (isOvertime) { p.overtimeActual += actual; p.overtimeStandard += standard; } else { p.normalStandard += standard; }
  });

  selectedLines.forEach((line) => {
    const key = empKey(line.emp_code, line.emp_name);
    if (!peopleMap.has(key)) peopleMap.set(key, personBase({ code: line.emp_code, name: line.emp_name, availableMinutesDay: generalShiftMinutes }));
    const p = peopleMap.get(key);
    const actual = num(line.actual_minutes, 0), dept = clean(line.department_name || line.department_code || "-"), nature = clean(line.work_nature || "Normal").toLowerCase();
    p.deptMinutes.set(dept, num(p.deptMinutes.get(dept), 0) + actual);
    if (nature === "rework") p.rework += actual;
    if (nature === "other") p.other += actual;
  });

  const attendanceByDate = buildAttendanceByDate(attendanceRaw, range, shiftFilter);
  const presence = buildPresenceLists(activeEmployees, attendanceByDate, selectedWorkingDays, deptFilter, employeeFilter);
  const plannedAbsences = normalizePlannedAbsences(plannedAbsencesRaw);
  const absentBreakdown = splitAbsentRowsByPlan(presence.absent, plannedAbsences);
  const monthAbsence = absencePctForRange(activeEmployees, attendanceRaw, range, shiftFilter, deptFilter, employeeFilter);
  const scoringAbsence = absenceStatsForScoring(presence.absent, plannedAbsences, activeEmployees, safeYear(range.year) || Number(clean(range.from).slice(0, 4)) || new Date().getFullYear());
  const manpowerAvailableMinutes = scopedActiveEmployees.reduce((sum, e) => sum + selectedWorkingDays.length * employeeDailyMinutes(e, generalShiftMinutes), 0);

  let people = Array.from(peopleMap.values()).map((p) => makeOutputPerson(p, scoringAbsence, selectedWorkingDays, activeScoreRules));
  if (deptFilter !== "All") people = people.filter((p) => clean(p.department) === deptFilter);
  if (employeeFilter !== "All") people = people.filter((p) => clean(p.name || p.code) === employeeFilter);
  people.sort((a, b) => num(b.score) - num(a.score) || clean(a.name).localeCompare(clean(b.name)));

  const deptMap = new Map();
  selectedLines.forEach((line) => {
    const dept = clean(line.department_name || line.department_code || "-");
    if (deptFilter !== "All" && dept !== deptFilter) return;
    if (!deptMap.has(dept)) deptMap.set(dept, { department: dept, peopleSet: new Set(), standard: 0, actual: 0, rework: 0, other: 0 });
    const d = deptMap.get(dept), actual = num(line.actual_minutes, 0), nature = clean(line.work_nature || "Normal").toLowerCase();
    d.peopleSet.add(empKey(line.emp_code, line.emp_name)); d.standard += num(line.standard_minutes, 0); d.actual += actual;
    if (nature === "rework") d.rework += actual;
    if (nature === "other") d.other += actual;
  });

  const departments = Array.from(deptMap.values()).map((d) => ({ department: d.department, people: d.peopleSet.size, productivityPct: pct(d.standard, d.actual), status: pct(d.standard, d.actual) >= 90 ? "Good Control" : pct(d.standard, d.actual) < 70 ? "Review Required" : d.rework > 0 ? "Watch Rework" : "Stable", standardHours: hours(d.standard), actualHours: hours(d.actual), reworkHours: hours(d.rework), otherWorkHours: hours(d.other) })).sort((a, b) => num(b.actualHours) - num(a.actualHours) || clean(a.department).localeCompare(clean(b.department)));

  const totalActual = selectedEntries.reduce((s, x) => s + num(x.total_actual_minutes, 0), 0);
  const totalStandard = selectedEntries.reduce((s, x) => s + num(x.total_standard_minutes, 0), 0);
  const kpis = {
    presentEmployees: presence.present.length,
    absentEmployees: presence.absent.length,
    plannedAbsentEmployees: absentBreakdown.plannedAbsentEmployees,
    unplannedAbsentEmployees: absentBreakdown.unplannedAbsentEmployees,
    plannedAbsentDays: absentBreakdown.plannedAbsentDays,
    unplannedAbsentDays: absentBreakdown.unplannedAbsentDays,
    absentPctCurrentMonth: monthAbsence.absentPct,
    monthAbsentDays: monthAbsence.absentPersonDays,
    monthAvailablePersonDays: monthAbsence.totalPersonDays,
    availableHours: hours(manpowerAvailableMinutes),
    utilizedHours: hours(totalActual),
    standardOutputHours: hours(totalStandard),
    productivityPct: pct(totalStandard, manpowerAvailableMinutes),
    utilizationPct: pct(totalActual, manpowerAvailableMinutes),
    reworkHours: hours(selectedLines.filter((x) => clean(x.work_nature).toLowerCase() === "rework").reduce((s, x) => s + num(x.actual_minutes, 0), 0)),
    otherWorkHours: hours(selectedLines.filter((x) => clean(x.work_nature).toLowerCase() === "other").reduce((s, x) => s + num(x.actual_minutes, 0), 0)),
    lossHours: hours(selectedEntries.reduce((s, x) => s + num(x.major_loss_minutes, 0), 0))
  };

  const shifts = []; shiftsRaw.forEach((s) => addUnique(shifts, s.shift_name || s.shift_code)); entriesRaw.forEach((e) => addUnique(shifts, e.shift_name || e.shift_code)); shifts.sort((a, b) => a.localeCompare(b));
  const departmentsForFilter = [];
  departmentsRaw.filter((d) => isActive(d.active)).forEach((d) => addUnique(departmentsForFilter, d.department_name || d.department_code || d.name));
  departmentsForFilter.sort((a, b) => a.localeCompare(b));
  const employeesForFilter = activeEmployees.map((e) => e.name || e.code).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const employeeDetails = activeEmployees.map((e) => ({ code: e.code, name: e.name, department: e.department, availableMinutesDay: employeeDailyMinutes(e, generalShiftMinutes) }));
  const years = yearsFromDates(entriesRaw, linesRaw, attendanceRaw);
  const topPeriod = people.find((p) => num(p.score) > 0) || null;
  const topMonth = people.filter((p) => num(p.score) > 0).slice(0, 3).map((p, idx) => ({ ...p, badges: [`Selected Rank ${idx + 1}`] }));

  return { ok: true, source: "pocketbase", period, range, selectedYear: params.year || "", selectedMonth: params.month || "", filterOptions: { shifts, departments: departmentsForFilter, employees: employeesForFilter, employeeDetails, years, months: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) })) }, scoreRules: activeScoreRules, kpis, topYesterday: topPeriod ? { ...topPeriod, badges: ["Selected Period Topper"] } : null, topMonth, presentList: presence.present, yesterdayAbsent: presence.absent, monthAbsent: presence.absent, plannedAbsent: absentBreakdown.plannedAbsent, unplannedAbsent: absentBreakdown.unplannedAbsent, employees: people, departments, insights: buildInsights(kpis, departments, people, range.label), meta: { service: "peopleDashboardServiceV6", generatedAt: new Date().toISOString(), dateFilterMode: range.mode, selectedWorkingDates: selectedWorkingDays, generalShiftMinutes, capacitySource: "employee_available_minutes_day", counts: { employees: activeEmployees.length, selectedEntries: selectedEntries.length, selectedLines: selectedLines.length, attendance: attendanceRaw.length, plannedAbsences: plannedAbsencesRaw.length } } };
}

module.exports = { getPeopleDashboard };
