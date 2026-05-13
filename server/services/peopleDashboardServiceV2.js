// server/services/peopleDashboardServiceV2.js
// SP WorkTrack DB Edition - Optimized People Dashboard service
// Reads PocketBase data and returns the existing renderer/team/team.js payload shape.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, num(value, 0)));
}

function isActive(value) {
  if (value === false) return false;
  const text = clean(value).toLowerCase();
  return !(text === "false" || text === "0" || text === "inactive" || text === "no");
}

function dateKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function inRange(value, range) {
  const d = clean(value);
  return d && d >= range.from && d <= range.to;
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

function personBase(emp) {
  return {
    code: clean(emp.code || emp.emp_code),
    name: clean(emp.name || emp.full_name || emp.emp_name || emp.code || emp.emp_code),
    masterDepartment: clean(emp.department),
    designation: clean(emp.designation),
    available: 0,
    actual: 0,
    standard: 0,
    normalAvailable: 0,
    normalStandard: 0,
    overtimeActual: 0,
    overtimeStandard: 0,
    rework: 0,
    other: 0,
    majorLoss: 0,
    entries: 0,
    presentDates: new Set(),
    deptMinutes: new Map()
  };
}

function preferredDepartment(person) {
  if (person.masterDepartment) return person.masterDepartment;

  let bestDept = "-";
  let bestMinutes = 0;

  person.deptMinutes.forEach((minutes, dept) => {
    if (minutes > bestMinutes) {
      bestMinutes = minutes;
      bestDept = dept;
    }
  });

  return bestDept;
}

function scorePerson({ productivityPct, utilizationPct, efficiencyPct, attendancePct, reworkHours, otherWorkHours, availableHours, absentDays }) {
  if (availableHours <= 0) return 0;

  // Month score should not reward one high-output OT entry while ignoring reliability.
  // Productivity / utilization / efficiency are capped, and MTD absence is a direct penalty.
  const score =
    clamp(productivityPct, 0, 120) * 0.45 +
    clamp(utilizationPct, 0, 100) * 0.20 +
    clamp(efficiencyPct, 0, 120) * 0.15 +
    clamp(attendancePct, 0, 100) * 0.20 -
    clamp(absentDays, 0, 31) * 3.0 -
    clamp(reworkHours, 0, 999) * 1.0 -
    clamp(otherWorkHours, 0, 999) * 0.3;

  return Number(clamp(score, 0, 100).toFixed(1));
}

function makeOutputPerson(person, monthAbsentMap, selectedWorkingDays) {
  const productivityPct = pct(person.standard, person.available);
  const utilizationPct = pct(person.actual, person.available);
  const efficiencyPct = pct(person.standard, person.actual);
  const normalProductivityPct = pct(person.normalStandard, person.normalAvailable);
  const overtimeProductivityPct = pct(person.overtimeStandard, person.overtimeActual);
  const availableHours = hours(person.available);
  const reworkHours = hours(person.rework);
  const otherWorkHours = hours(person.other);
  const attendancePct = selectedWorkingDays.length > 0
    ? pct(person.presentDates.size, selectedWorkingDays.length)
    : 0;

  const absentDays = num(monthAbsentMap.get(person.code || person.name), 0);

  return {
    code: person.code,
    name: person.name || person.code || "Unknown",
    department: preferredDepartment(person),
    score: scorePerson({ productivityPct, utilizationPct, efficiencyPct, attendancePct, reworkHours, otherWorkHours, availableHours, absentDays }),
    yesterdayProductivityPct: productivityPct,
    monthProductivityPct: productivityPct,
    overtimeHours: hours(person.overtimeActual),
    absentDays,
    normalProductivityPct,
    overtimeProductivityPct,
    efficiencyPct,
    reworkHours,
    otherWorkHours,
    presentDays: person.presentDates.size,
    availableHours,
    utilizedHours: hours(person.actual),
    standardOutputHours: hours(person.standard),
    badges: []
  };
}

function addUnique(list, value) {
  const v = clean(value);
  if (v && !list.includes(v)) list.push(v);
}

function buildInsights(kpis, departments, employees, label) {
  const insights = [];

  if (num(kpis.absentEmployees) > 0) {
    insights.push({
      icon: "👥",
      title: "Manpower Gap",
      text: `${kpis.absentEmployees} employee(s) are absent in ${label}. Check daily allocation before planning.`
    });
  }

  const weakDept = departments.find((d) => num(d.productivityPct) < 70 && num(d.people) > 0);
  if (weakDept) {
    insights.push({
      icon: "📉",
      title: "Department Efficiency Watch",
      text: `${weakDept.department} is at ${weakDept.productivityPct}% productivity. Review delay, rework, waiting or support need.`
    });
  }

  if (num(kpis.reworkHours) > 0) {
    insights.push({
      icon: "⚠️",
      title: "Rework Visibility",
      text: `${kpis.reworkHours} rework hour(s) recorded in selected period. Use loss summary for root area analysis.`
    });
  }

  const top = employees.find((e) => num(e.score) > 0);
  if (top) {
    insights.push({
      icon: "🏆",
      title: "Recognition",
      text: `${top.name} is leading the selected period with score ${top.score}.`
    });
  }

  if (!insights.length) {
    insights.push({ icon: "ℹ️", title: "No Major Risk", text: "No major manpower or productivity issue detected for selected period." });
  }

  return insights;
}

async function getPeopleDashboard(params = {}) {
  const period = clean(params.period || "today");
  const shiftFilter = clean(params.shift || "All");
  const deptFilter = clean(params.department || "All");
  const employeeFilter = clean(params.employee || "All");

  const range = periodRange(period);
  const selectedWorkingDays = workingDates(range);
  const mtdRange = periodRange("month");
  const mtdWorkingDays = workingDates(mtdRange);

  const [employeesRaw, entriesRaw, linesRaw, attendanceRaw, shiftsRaw] = await Promise.all([
    listAll("employees", { perPage: 1000 }),
    listAll("production_entries", { perPage: 2000, sort: "-work_date" }),
    listAll("production_entry_lines", { perPage: 4000, sort: "-work_date" }),
    listAll("attendance", { perPage: 4000, sort: "-work_date" }),
    listAll("shifts", { perPage: 500 })
  ]);

  const activeEmployees = employeesRaw
    .filter((e) => isActive(e.active))
    .map((e) => ({
      code: clean(e.emp_code),
      name: clean(e.full_name),
      department: clean(e.department),
      designation: clean(e.designation)
    }))
    .filter((e) => e.code || e.name);

  const peopleMap = new Map();
  activeEmployees.forEach((e) => peopleMap.set(empKey(e.code, e.name), personBase(e)));

  const selectedEntries = entriesRaw.filter((entry) => {
    if (!inRange(entry.work_date, range)) return false;
    if (shiftFilter !== "All" && clean(entry.shift_name || entry.shift_code) !== shiftFilter) return false;
    if (employeeFilter !== "All" && clean(entry.emp_name || entry.emp_code) !== employeeFilter) return false;
    return true;
  });

  const entrySet = new Set(selectedEntries.map((e) => clean(e.entry_no)).filter(Boolean));
  const selectedLines = linesRaw.filter((line) => entrySet.has(clean(line.entry_no)));

  selectedEntries.forEach((entry) => {
    const key = empKey(entry.emp_code, entry.emp_name);
    if (!peopleMap.has(key)) peopleMap.set(key, personBase({ code: entry.emp_code, name: entry.emp_name }));

    const p = peopleMap.get(key);
    const available = num(entry.shift_available, 0);
    const actual = num(entry.total_actual_minutes, 0);
    const standard = num(entry.total_standard_minutes, 0);
    const isOvertime = clean(entry.work_type).toLowerCase() === "overtime" || num(entry.flexible_shift_minutes, 0) > 0;

    p.available += available;
    p.actual += actual;
    p.standard += standard;
    p.majorLoss += num(entry.major_loss_minutes, 0);
    p.entries += 1;
    p.presentDates.add(clean(entry.work_date));

    if (isOvertime) {
      p.overtimeActual += actual;
      p.overtimeStandard += standard;
    } else {
      p.normalAvailable += available;
      p.normalStandard += standard;
    }
  });

  selectedLines.forEach((line) => {
    const key = empKey(line.emp_code, line.emp_name);
    if (!peopleMap.has(key)) peopleMap.set(key, personBase({ code: line.emp_code, name: line.emp_name }));

    const p = peopleMap.get(key);
    const actual = num(line.actual_minutes, 0);
    const dept = clean(line.department_name || line.department_code || "-");
    const nature = clean(line.work_nature || "Normal").toLowerCase();

    p.deptMinutes.set(dept, num(p.deptMinutes.get(dept), 0) + actual);
    if (nature === "rework") p.rework += actual;
    if (nature === "other") p.other += actual;
  });

  const selectedAttendanceKeys = new Set(
    attendanceRaw
      .filter((a) => inRange(a.work_date, range))
      .filter((a) => shiftFilter === "All" || clean(a.shift_name || a.shift_code) === shiftFilter)
      .map((a) => empKey(a.emp_code, a.emp_name))
  );

  const mtdAttendanceKeys = new Set(
    attendanceRaw
      .filter((a) => inRange(a.work_date, mtdRange))
      .filter((a) => shiftFilter === "All" || clean(a.shift_name || a.shift_code) === shiftFilter)
      .map((a) => `${clean(a.work_date)}|${empKey(a.emp_code, a.emp_name)}`)
  );

  const monthAbsentMap = new Map();
  activeEmployees.forEach((e) => {
    const key = empKey(e.code, e.name);
    const absentCount = mtdWorkingDays.reduce((sum, d) => sum + (mtdAttendanceKeys.has(`${d}|${key}`) ? 0 : 1), 0);
    monthAbsentMap.set(e.code || e.name, absentCount);
  });

  let people = Array.from(peopleMap.values()).map((p) => makeOutputPerson(p, monthAbsentMap, selectedWorkingDays));

  if (deptFilter !== "All") people = people.filter((p) => clean(p.department) === deptFilter);
  if (employeeFilter !== "All") people = people.filter((p) => clean(p.name || p.code) === employeeFilter);

  people.sort((a, b) => num(b.score) - num(a.score) || clean(a.name).localeCompare(clean(b.name)));

  const selectedAbsent = activeEmployees
    .filter((e) => !selectedAttendanceKeys.has(empKey(e.code, e.name)))
    .filter((e) => deptFilter === "All" || clean(e.department) === deptFilter)
    .filter((e) => employeeFilter === "All" || clean(e.name || e.code) === employeeFilter)
    .map((e) => ({ name: e.name || e.code, department: e.department || "-", shift: shiftFilter === "All" ? "All Shifts" : shiftFilter }));

  const monthAbsent = activeEmployees
    .map((e) => ({ name: e.name || e.code, department: e.department || "-", days: num(monthAbsentMap.get(e.code || e.name), 0) }))
    .filter((x) => x.days > 0)
    .filter((x) => deptFilter === "All" || clean(x.department) === deptFilter)
    .sort((a, b) => num(b.days) - num(a.days) || clean(a.name).localeCompare(clean(b.name)));

  const deptMap = new Map();
  selectedLines.forEach((line) => {
    const dept = clean(line.department_name || line.department_code || "-");
    if (deptFilter !== "All" && dept !== deptFilter) return;

    if (!deptMap.has(dept)) {
      deptMap.set(dept, {
        department: dept,
        peopleSet: new Set(),
        standard: 0,
        actual: 0,
        rework: 0,
        other: 0
      });
    }

    const d = deptMap.get(dept);
    const actual = num(line.actual_minutes, 0);
    const nature = clean(line.work_nature || "Normal").toLowerCase();

    d.peopleSet.add(empKey(line.emp_code, line.emp_name));
    d.standard += num(line.standard_minutes, 0);
    d.actual += actual;
    if (nature === "rework") d.rework += actual;
    if (nature === "other") d.other += actual;
  });

  const departments = Array.from(deptMap.values()).map((d) => {
    const productivityPct = pct(d.standard, d.actual);
    let status = "Stable";
    if (productivityPct >= 90) status = "Good Control";
    else if (productivityPct < 70) status = "Review Required";
    else if (d.rework > 0) status = "Watch Rework";

    return {
      department: d.department,
      people: d.peopleSet.size,
      productivityPct,
      status,
      standardHours: hours(d.standard),
      actualHours: hours(d.actual),
      reworkHours: hours(d.rework),
      otherWorkHours: hours(d.other)
    };
  }).sort((a, b) => num(b.productivityPct) - num(a.productivityPct));

  const totalAvailable = selectedEntries.reduce((s, x) => s + num(x.shift_available, 0), 0);
  const totalActual = selectedEntries.reduce((s, x) => s + num(x.total_actual_minutes, 0), 0);
  const totalStandard = selectedEntries.reduce((s, x) => s + num(x.total_standard_minutes, 0), 0);

  const kpis = {
    presentEmployees: selectedAttendanceKeys.size,
    absentEmployees: selectedAbsent.length,
    availableHours: hours(totalAvailable),
    utilizedHours: hours(totalActual),
    standardOutputHours: hours(totalStandard),
    productivityPct: pct(totalStandard, totalAvailable),
    utilizationPct: pct(totalActual, totalAvailable),
    reworkHours: hours(selectedLines.filter((x) => clean(x.work_nature).toLowerCase() === "rework").reduce((s, x) => s + num(x.actual_minutes, 0), 0)),
    otherWorkHours: hours(selectedLines.filter((x) => clean(x.work_nature).toLowerCase() === "other").reduce((s, x) => s + num(x.actual_minutes, 0), 0)),
    lossHours: hours(selectedEntries.reduce((s, x) => s + num(x.major_loss_minutes, 0), 0))
  };

  const topPeriod = people.find((p) => num(p.score) > 0) || null;
  const topMonth = people.filter((p) => num(p.score) > 0).slice(0, 3).map((p, idx) => ({ ...p, badges: [`Month Rank ${idx + 1}`] }));

  const shifts = [];
  shiftsRaw.forEach((s) => addUnique(shifts, s.shift_name || s.shift_code));
  entriesRaw.forEach((e) => addUnique(shifts, e.shift_name || e.shift_code));
  shifts.sort((a, b) => a.localeCompare(b));

  const departmentsForFilter = [];
  activeEmployees.forEach((e) => addUnique(departmentsForFilter, e.department));
  linesRaw.forEach((l) => addUnique(departmentsForFilter, l.department_name || l.department_code));
  departmentsForFilter.sort((a, b) => a.localeCompare(b));

  const employeesForFilter = activeEmployees
    .map((e) => e.name || e.code)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    source: "pocketbase",
    period,
    range,
    filterOptions: {
      shifts,
      departments: departmentsForFilter,
      employees: employeesForFilter
    },
    kpis,
    topYesterday: topPeriod ? { ...topPeriod, badges: ["Selected Period Topper"] } : null,
    topMonth,
    yesterdayAbsent: selectedAbsent,
    monthAbsent,
    employees: people,
    departments,
    insights: buildInsights(kpis, departments, people, range.label),
    meta: {
      generatedAt: new Date().toISOString(),
      counts: {
        employees: activeEmployees.length,
        selectedEntries: selectedEntries.length,
        selectedLines: selectedLines.length,
        attendance: attendanceRaw.length
      }
    }
  };
}

module.exports = {
  getPeopleDashboard
};
