// server/services/peopleDashboardServiceV3.js
// Adds absent-date drilldown data on top of People Dashboard V2.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { getPeopleDashboard: getPeopleDashboardV2 } = require("./peopleDashboardServiceV2");

function clean(value) {
  return String(value ?? "").trim();
}

function isActive(value) {
  if (value === false) return false;
  const text = clean(value).toLowerCase();
  return !(text === "false" || text === "0" || text === "inactive" || text === "no");
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
  const key = clean(period || "today");

  if (key === "yesterday") {
    const y = addDays(today, -1);
    return { from: dateKey(y), to: dateKey(y), label: "Yesterday" };
  }

  if (key === "month") {
    return { from: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: dateKey(today), label: "This Month" };
  }

  if (key === "last7") {
    return { from: dateKey(addDays(today, -6)), to: dateKey(today), label: "Last 7 Days" };
  }

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

function buildAttendanceDateSet(attendance, range, shiftFilter) {
  return new Set(
    attendance
      .filter((a) => inRange(a.work_date, range))
      .filter((a) => shiftFilter === "All" || clean(a.shift_name || a.shift_code) === shiftFilter)
      .map((a) => `${clean(a.work_date)}|${empKey(a.emp_code, a.emp_name)}`)
  );
}

function applyEmployeeFilters(list, deptFilter, employeeFilter) {
  return list
    .filter((e) => deptFilter === "All" || clean(e.department) === deptFilter)
    .filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter);
}

async function getPeopleDashboard(params = {}) {
  const data = await getPeopleDashboardV2(params);

  const period = clean(params.period || data.period || "today");
  const shiftFilter = clean(params.shift || "All");
  const deptFilter = clean(params.department || "All");
  const employeeFilter = clean(params.employee || "All");

  const selectedRange = periodRange(period);
  const mtdRange = periodRange("month");
  const selectedDates = workingDates(selectedRange);
  const mtdDates = workingDates(mtdRange);

  const [employeesRaw, attendanceRaw] = await Promise.all([
    listAll("employees", { perPage: 1000 }),
    listAll("attendance", { perPage: 4000, sort: "-work_date" })
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

  const selectedAttendance = buildAttendanceDateSet(attendanceRaw, selectedRange, shiftFilter);
  const mtdAttendance = buildAttendanceDateSet(attendanceRaw, mtdRange, shiftFilter);

  const selectedAbsent = applyEmployeeFilters(activeEmployees, deptFilter, employeeFilter)
    .map((e) => {
      const key = empKey(e.code, e.name);
      const absentDates = selectedDates.filter((d) => !selectedAttendance.has(`${d}|${key}`));
      return {
        code: e.code,
        name: e.name || e.code,
        department: e.department,
        shift: shiftFilter === "All" ? "All Shifts" : shiftFilter,
        days: absentDates.length,
        absentDates
      };
    })
    .filter((x) => x.days > 0)
    .sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));

  const monthAbsent = applyEmployeeFilters(activeEmployees, deptFilter, employeeFilter)
    .map((e) => {
      const key = empKey(e.code, e.name);
      const absentDates = mtdDates.filter((d) => !mtdAttendance.has(`${d}|${key}`));
      return {
        code: e.code,
        name: e.name || e.code,
        department: e.department,
        days: absentDates.length,
        absentDates
      };
    })
    .filter((x) => x.days > 0)
    .sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));

  data.yesterdayAbsent = selectedAbsent;
  data.monthAbsent = monthAbsent;
  data.kpis = {
    ...(data.kpis || {}),
    absentEmployees: selectedAbsent.length
  };
  data.meta = {
    ...(data.meta || {}),
    service: "peopleDashboardServiceV3",
    absentDrilldown: true,
    selectedAbsentDateCount: selectedDates.length,
    monthAbsentDateCount: mtdDates.length
  };

  return data;
}

module.exports = {
  getPeopleDashboard
};
