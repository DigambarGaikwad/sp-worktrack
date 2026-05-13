// server/services/peopleDashboardServiceV4.js
// People Dashboard V4
// Attendance and manpower capacity are based on General shift only.
// Production values still come from actual production entries for productivity visibility.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { getPeopleDashboard: getPeopleDashboardV2 } = require("./peopleDashboardServiceV2");

const GENERAL_SHIFT_FALLBACK_MINUTES = 465;

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function isActive(value) {
  if (value === false) return false;
  const text = clean(value).toLowerCase();
  return !(text === "false" || text === "0" || text === "inactive" || text === "no");
}

function isGeneralShift(value) {
  const text = clean(value).toLowerCase();
  return text.includes("general") || text === "g" || text === "gen";
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function periodRange(period) {
  const today = new Date();
  const key = clean(period || "yesterday");

  if (key === "today") return { from: dateKey(today), to: dateKey(today), label: "Today" };

  if (key === "yesterday") {
    const y = addDays(today, -1);
    return { from: dateKey(y), to: dateKey(y), label: "Yesterday" };
  }

  if (key === "month") {
    return { from: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: dateKey(today), label: "This Month" };
  }

  if (key === "last7") return { from: dateKey(addDays(today, -6)), to: dateKey(today), label: "Last 7 Days" };

  return { from: dateKey(today), to: dateKey(today), label: "Today" };
}

function workingDates(range) {
  const dates = [];
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  let cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);

  while (cursor <= end) {
    if (cursor.getDay() !== 0) dates.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function inRange(value, range) {
  const d = clean(value);
  return d && d >= range.from && d <= range.to;
}

function empKey(code, name) {
  return clean(code || name).toLowerCase();
}

function hours(minutes) {
  return Number((num(minutes, 0) / 60).toFixed(1));
}

function pct(numerator, denominator) {
  const den = num(denominator, 0);
  if (den <= 0) return 0;
  return Number(((num(numerator, 0) / den) * 100).toFixed(1));
}

async function listAll(collectionName, options = {}) {
  const perPage = options.perPage || 500;
  let page = 1;
  const all = [];

  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: {
        page,
        perPage,
        filter: options.filter || "",
        sort: options.sort || ""
      }
    });

    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);

    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }

  return all;
}

function getGeneralShiftMinutes(shifts) {
  const general = shifts.find((s) => isGeneralShift(s.shift_name || s.shift_code));
  if (!general) return GENERAL_SHIFT_FALLBACK_MINUTES;

  const explicit = num(general.available_minutes, 0) || num(general.shift_available, 0);
  if (explicit > 0) return explicit;

  return GENERAL_SHIFT_FALLBACK_MINUTES;
}

function buildGeneralAttendance(attendance, range) {
  const presentByDate = new Map();

  attendance
    .filter((a) => inRange(a.work_date, range))
    .filter((a) => isGeneralShift(a.shift_name || a.shift_code))
    .forEach((a) => {
      const d = clean(a.work_date);
      const key = empKey(a.emp_code, a.emp_name);
      if (!d || !key) return;
      if (!presentByDate.has(d)) presentByDate.set(d, new Set());
      presentByDate.get(d).add(key);
    });

  return presentByDate;
}

function applyEmployeeFilters(list, deptFilter, employeeFilter) {
  return list
    .filter((e) => deptFilter === "All" || clean(e.department) === deptFilter)
    .filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter);
}

function buildPresenceLists(activeEmployees, presentByDate, dates, deptFilter, employeeFilter) {
  const employees = applyEmployeeFilters(activeEmployees, deptFilter, employeeFilter);
  const presentMap = new Map();
  const absentMap = new Map();

  employees.forEach((e) => {
    presentMap.set(empKey(e.code, e.name), { ...e, presentDates: [] });
    absentMap.set(empKey(e.code, e.name), { ...e, absentDates: [] });
  });

  dates.forEach((d) => {
    const presentSet = presentByDate.get(d) || new Set();

    employees.forEach((e) => {
      const key = empKey(e.code, e.name);
      if (presentSet.has(key)) presentMap.get(key).presentDates.push(d);
      else absentMap.get(key).absentDates.push(d);
    });
  });

  const present = Array.from(presentMap.values())
    .filter((x) => x.presentDates.length > 0)
    .map((x) => ({
      code: x.code,
      name: x.name || x.code,
      department: x.department || "-",
      shift: "General",
      days: x.presentDates.length,
      presentDates: x.presentDates
    }))
    .sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));

  const absent = Array.from(absentMap.values())
    .filter((x) => x.absentDates.length > 0)
    .map((x) => ({
      code: x.code,
      name: x.name || x.code,
      department: x.department || "-",
      shift: "General",
      days: x.absentDates.length,
      absentDates: x.absentDates
    }))
    .sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));

  return { present, absent };
}

async function getPeopleDashboard(params = {}) {
  const baseParams = { ...params, shift: "All" };
  const data = await getPeopleDashboardV2(baseParams);

  const period = clean(params.period || data.period || "yesterday");
  const deptFilter = clean(params.department || "All");
  const employeeFilter = clean(params.employee || "All");

  const selectedRange = periodRange(period);
  const monthRange = periodRange("month");
  const selectedDates = workingDates(selectedRange);
  const monthDates = workingDates(monthRange);

  const [employeesRaw, attendanceRaw, shiftsRaw] = await Promise.all([
    listAll("employees", { perPage: 1000 }),
    listAll("attendance", { perPage: 5000, sort: "-work_date" }),
    listAll("shifts", { perPage: 500 })
  ]);

  const activeEmployees = employeesRaw
    .filter((e) => isActive(e.active))
    .map((e) => ({
      code: clean(e.emp_code),
      name: clean(e.full_name),
      department: clean(e.department) || "-",
      designation: clean(e.designation)
    }))
    .filter((e) => e.code || e.name);

  const selectedAttendance = buildGeneralAttendance(attendanceRaw, selectedRange);
  const monthAttendance = buildGeneralAttendance(attendanceRaw, monthRange);

  const selectedLists = buildPresenceLists(activeEmployees, selectedAttendance, selectedDates, deptFilter, employeeFilter);
  const monthLists = buildPresenceLists(activeEmployees, monthAttendance, monthDates, deptFilter, employeeFilter);

  const generalShiftMinutes = getGeneralShiftMinutes(shiftsRaw);
  const selectedPresentPersonDays = selectedLists.present.reduce((sum, p) => sum + num(p.days, 0), 0);
  const manpowerAvailableMinutes = selectedPresentPersonDays * generalShiftMinutes;

  const totalStandardMinutes = num(data.kpis?.standardOutputHours, 0) * 60;
  const totalActualMinutes = num(data.kpis?.utilizedHours, 0) * 60;

  data.presentList = selectedLists.present;
  data.yesterdayAbsent = selectedLists.absent;
  data.monthAbsent = monthLists.absent;

  data.kpis = {
    ...(data.kpis || {}),
    presentEmployees: selectedLists.present.length,
    absentEmployees: selectedLists.absent.length,
    availableHours: hours(manpowerAvailableMinutes),
    productivityPct: pct(totalStandardMinutes, manpowerAvailableMinutes),
    utilizationPct: pct(totalActualMinutes, manpowerAvailableMinutes)
  };

  data.meta = {
    ...(data.meta || {}),
    service: "peopleDashboardServiceV4",
    attendanceRule: "general-shift-only",
    presentDrilldown: true,
    absentDrilldown: true,
    generalShiftMinutes,
    selectedWorkingDates: selectedDates,
    monthWorkingDates: monthDates
  };

  return data;
}

module.exports = {
  getPeopleDashboard
};
