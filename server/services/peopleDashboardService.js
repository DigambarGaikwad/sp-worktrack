// server/services/peopleDashboardService.js
// SP WorkTrack DB Edition - People dashboard service
// Builds the same payload shape used by renderer/team/team.js, but from PocketBase.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function isActive(value) {
  if (value === false) return false;
  const text = String(value ?? "").trim().toLowerCase();
  return !(text === "false" || text === "0" || text === "inactive" || text === "no");
}

function toDateKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function getPeriodRange(period) {
  const today = new Date();
  const key = clean(period || "today");

  if (key === "yesterday") {
    const y = addDays(today, -1);
    return { from: toDateKey(y), to: toDateKey(y), label: "Yesterday" };
  }

  if (key === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toDateKey(start), to: toDateKey(today), label: "This Month" };
  }

  if (key === "last7") {
    return { from: toDateKey(addDays(today, -6)), to: toDateKey(today), label: "Last 7 Days" };
  }

  return { from: toDateKey(today), to: toDateKey(today), label: "Today" };
}

function isDateInRange(value, range) {
  const d = clean(value);
  return d && d >= range.from && d <= range.to;
}

function monthRangeToToday() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: toDateKey(start), to: toDateKey(today), label: "Month To Date" };
}

function workDatesInRange(range) {
  const dates = [];
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  let cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);

  while (cursor <= end) {
    // Sunday excluded for manpower attendance expectation.
    if (cursor.getDay() !== 0) dates.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

async function listAll(collectionName, options = {}) {
  const perPage = options.perPage || 500;
  let page = 1;
  let all = [];

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
    all = all.concat(items);

    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }

  return all;
}

function employeeKey(code, name) {
  return clean(code || name).toLowerCase();
}

function employeeDisplay(emp) {
  const code = clean(emp.emp_code || emp.empId || emp.emp_code);
  const name = clean(emp.full_name || emp.name || emp.emp_name);
  return name || code || "Unknown";
}

function makePersonBase(emp) {
  return {
    code: clean(emp.emp_code || emp.empId),
    name: employeeDisplay(emp),
    department: clean(emp.department) || "-",
    designation: clean(emp.designation),
    availableMinutes: 0,
    utilizedMinutes: 0,
    standardMinutes: 0,
    normalAvailableMinutes: 0,
    normalStandardMinutes: 0,
    overtimeMinutes: 0,
    overtimeStandardMinutes: 0,
    reworkMinutes: 0,
    otherWorkMinutes: 0,
    majorLossMinutes: 0,
    presentDates: new Set(),
    departmentsTouched: new Map(),
    entries: 0
  };
}

function minutesToHours(min) {
  return Number((toNumber(min, 0) / 60).toFixed(1));
}

function pct(numerator, denominator) {
  const den = toNumber(denominator, 0);
  if (den <= 0) return 0;
  return Number(((toNumber(numerator, 0) / den) * 100).toFixed(1));
}

function preferredDepartment(person) {
  if (person.department && person.department !== "-") return person.department;

  let best = "-";
  let max = 0;
  person.departmentsTouched.forEach((minutes, dept) => {
    if (minutes > max) {
      max = minutes;
      best = dept;
    }
  });

  return best;
}

function buildPersonOutput(person, selectedRange, monthAbsenceMap) {
  const productivityPct = pct(person.standardMinutes, person.availableMinutes);
  const utilizationPct = pct(person.utilizedMinutes, person.availableMinutes);
  const efficiencyPct = pct(person.standardMinutes, person.utilizedMinutes);
  const normalProductivityPct = pct(person.normalStandardMinutes, person.normalAvailableMinutes);
  const overtimeProductivityPct = pct(person.overtimeStandardMinutes, person.overtimeMinutes);
  const absentDays = toNumber(monthAbsenceMap.get(person.code || person.name), 0);

  const score = Math.max(
    0,
    Math.min(150, productivityPct * 0.45 + utilizationPct * 0.25 + efficiencyPct * 0.20 - absentDays * 3)
  );

  return {
    code: person.code,
    name: person.name,
    department: preferredDepartment(person),
    score: Number(score.toFixed(1)),
    yesterdayProductivityPct: productivityPct,
    monthProductivityPct: productivityPct,
    overtimeHours: minutesToHours(person.overtimeMinutes),
    absentDays,
    normalProductivityPct,
    overtimeProductivityPct,
    efficiencyPct,
    reworkHours: minutesToHours(person.reworkMinutes),
    otherWorkHours: minutesToHours(person.otherWorkMinutes),
    presentDays: person.presentDates.size,
    availableHours: minutesToHours(person.availableMinutes),
    utilizedHours: minutesToHours(person.utilizedMinutes),
    standardOutputHours: minutesToHours(person.standardMinutes),
    badges: []
  };
}

function buildInsights({ kpis, departments, employees, rangeLabel }) {
  const insights = [];

  if (toNumber(kpis.absentEmployees, 0) > 0) {
    insights.push({
      icon: "👥",
      title: "Manpower Gap",
      text: `${kpis.absentEmployees} employee(s) are absent in ${rangeLabel}. Review allocation before assigning work.`
    });
  }

  const weakDept = departments.find((d) => toNumber(d.productivityPct, 0) < 70 && toNumber(d.people, 0) > 0);
  if (weakDept) {
    insights.push({
      icon: "📉",
      title: "Department Efficiency Watch",
      text: `${weakDept.department} is at ${weakDept.productivityPct}% productivity. Check rework, waiting time or support requirement.`
    });
  }

  if (toNumber(kpis.reworkHours, 0) > 0) {
    insights.push({
      icon: "⚠️",
      title: "Rework Visibility",
      text: `${kpis.reworkHours} rework hour(s) recorded in the selected period. Review root area trend with loss summary.`
    });
  }

  const top = employees[0];
  if (top && toNumber(top.score, 0) > 0) {
    insights.push({
      icon: "🏆",
      title: "Recognition",
      text: `${top.name} is leading the selected period with score ${top.score}.`
    });
  }

  if (!insights.length) {
    insights.push({
      icon: "ℹ️",
      title: "Stable Period",
      text: "No major manpower or productivity risk detected for the selected period."
    });
  }

  return insights;
}

async function getPeopleDashboard(params = {}) {
  const period = clean(params.period || "today");
  const selectedShift = clean(params.shift || "All");
  const selectedDepartment = clean(params.department || "All");
  const selectedEmployee = clean(params.employee || "All");

  const range = getPeriodRange(period);
  const mtdRange = monthRangeToToday();
  const mtdDates = workDatesInRange(mtdRange);

  const [employeesRaw, entriesRaw, linesRaw, attendanceRaw, shiftsRaw] = await Promise.all([
    listAll("employees", { perPage: 1000 }),
    listAll("production_entries", { perPage: 1000, sort: "-work_date" }),
    listAll("production_entry_lines", { perPage: 2000, sort: "-work_date" }),
    listAll("attendance", { perPage: 2000, sort: "-work_date" }),
    listAll("shifts", { perPage: 500 })
  ]);

  const activeEmployees = employeesRaw
    .filter((e) => isActive(e.active))
    .map((e) => ({
      code: clean(e.emp_code),
      name: clean(e.full_name),
      department: clean(e.department),
      designation: clean(e.designation),
      raw: e
    }))
    .filter((e) => e.code || e.name);

  const peopleMap = new Map();
  activeEmployees.forEach((e) => {
    const key = employeeKey(e.code, e.name);
    peopleMap.set(key, makePersonBase({
      emp_code: e.code,
      full_name: e.name,
      department: e.department,
      designation: e.designation
    }));
  });

  const selectedEntries = entriesRaw.filter((entry) => {
    if (!isDateInRange(entry.work_date, range)) return false;
    if (selectedShift !== "All" && clean(entry.shift_name || entry.shift_code) !== selectedShift) return false;
    if (selectedEmployee !== "All" && clean(entry.emp_name || entry.emp_code) !== selectedEmployee) return false;
    return true;
  });

  const entryNoSet = new Set(selectedEntries.map((e) => clean(e.entry_no)).filter(Boolean));
  const selectedLines = linesRaw.filter((line) => entryNoSet.has(clean(line.entry_no)));

  selectedEntries.forEach((entry) => {
    const key = employeeKey(entry.emp_code, entry.emp_name);
    if (!peopleMap.has(key)) {
      peopleMap.set(key, makePersonBase({ emp_code: entry.emp_code, full_name: entry.emp_name }));
    }

    const p = peopleMap.get(key);
    p.availableMinutes += toNumber(entry.shift_available, 0);
    p.utilizedMinutes += toNumber(entry.total_actual_minutes, 0);
    p.standardMinutes += toNumber(entry.total_standard_minutes, 0);
    p.majorLossMinutes += toNumber(entry.major_loss_minutes, 0);
    p.presentDates.add(clean(entry.work_date));
    p.entries += 1;

    const isOvertime = clean(entry.work_type).toLowerCase() === "overtime" || toNumber(entry.flexible_shift_minutes, 0) > 0;
    if (isOvertime) {
      p.overtimeMinutes += toNumber(entry.total_actual_minutes, 0);
      p.overtimeStandardMinutes += toNumber(entry.total_standard_minutes, 0);
    } else {
      p.normalAvailableMinutes += toNumber(entry.shift_available, 0);
      p.normalStandardMinutes += toNumber(entry.total_standard_minutes, 0);
    }
  });

  selectedLines.forEach((line) => {
    const key = employeeKey(line.emp_code, line.emp_name);
    if (!peopleMap.has(key)) {
      peopleMap.set(key, makePersonBase({ emp_code: line.emp_code, full_name: line.emp_name }));
    }

    const p = peopleMap.get(key);
    const actual = toNumber(line.actual_minutes, 0);
    const nature = clean(line.work_nature || "Normal").toLowerCase();
    const dept = clean(line.department_name || line.department_code || "-");

    p.departmentsTouched.set(dept, toNumber(p.departmentsTouched.get(dept), 0) + actual);

    if (nature === "rework") p.reworkMinutes += actual;
    if (nature === "other") p.otherWorkMinutes += actual;
  });

  // Month absence: active employee is absent on a working date when no Present attendance exists.
  const mtdAttendanceKeys = new Set(
    attendanceRaw
      .filter((a) => isDateInRange(a.work_date, mtdRange))
      .filter((a) => selectedShift === "All" || clean(a.shift_name || a.shift_code) === selectedShift)
      .map((a) => `${clean(a.work_date)}|${employeeKey(a.emp_code, a.emp_name)}`)
  );

  const monthAbsenceMap = new Map();
  activeEmployees.forEach((e) => {
    const key = employeeKey(e.code, e.name);
    const count = mtdDates.reduce((sum, d) => sum + (mtdAttendanceKeys.has(`${d}|${key}`) ? 0 : 1), 0);
    monthAbsenceMap.set(e.code || e.name, count);
  });

  const selectedAttendanceKeys = new Set(
    attendanceRaw
      .filter((a) => isDateInRange(a.work_date, range))
      .filter((a) => selectedShift === "All" || clean(a.shift_name || a.shift_code) === selectedShift)
      .map((a) => employeeKey(a.emp_code, a.emp_name))
  );

  let people = Array.from(peopleMap.values()).map((p) => buildPersonOutput(p, range, monthAbsenceMap));

  if (selectedDepartment !== "All") {
    people = people.filter((p) => clean(p.department) === selectedDepartment);
  }

  if (selectedEmployee !== "All") {
    people = people.filter((p) => clean(p.name || p.code) === selectedEmployee);
  }

  people.sort((a, b) => toNumber(b.score) - toNumber(a.score) || clean(a.name).localeCompare(clean(b.name)));

  const selectedAbsent = activeEmployees
    .filter((e) => !selectedAttendanceKeys.has(employeeKey(e.code, e.name)))
    .filter((e) => selectedDepartment === "All" || clean(e.department) === selectedDepartment)
    .filter((e) => selectedEmployee === "All" || clean(e.name || e.code) === selectedEmployee)
    .map((e) => ({ name: e.name || e.code, department: e.department || "-", shift: selectedShift === "All" ? "All Shifts" : selectedShift }));

  const monthAbsent = activeEmployees
    .map((e) => ({
      name: e.name || e.code,
      department: e.department || "-",
      days: toNumber(monthAbsenceMap.get(e.code || e.name), 0)
    }))
    .filter((x) => x.days > 0)
    .filter((x) => selectedDepartment === "All" || clean(x.department) === selectedDepartment)
    .sort((a, b) => b.days - a.days || clean(a.name).localeCompare(clean(b.name)));

  const deptMap = new Map();
  selectedLines.forEach((line) => {
    const dept = clean(line.department_name || line.department_code || "-");
    if (selectedDepartment !== "All" && dept !== selectedDepartment) return;

    if (!deptMap.has(dept)) {
      deptMap.set(dept, {
        department: dept,
        peopleSet: new Set(),
        standardMinutes: 0,
        actualMinutes: 0,
        reworkMinutes: 0,
        otherMinutes: 0
      });
    }

    const d = deptMap.get(dept);
    d.peopleSet.add(employeeKey(line.emp_code, line.emp_name));
    d.standardMinutes += toNumber(line.standard_minutes, 0);
    d.actualMinutes += toNumber(line.actual_minutes, 0);

    const nature = clean(line.work_nature || "Normal").toLowerCase();
    if (nature === "rework") d.reworkMinutes += toNumber(line.actual_minutes, 0);
    if (nature === "other") d.otherMinutes += toNumber(line.actual_minutes, 0);
  });

  const departments = Array.from(deptMap.values()).map((d) => {
    const productivityPct = pct(d.standardMinutes, d.actualMinutes);
    let status = "Stable";
    if (productivityPct >= 90) status = "Good Control";
    else if (productivityPct < 70) status = "Review Required";
    else if (d.reworkMinutes > 0) status = "Watch Rework";

    return {
      department: d.department,
      people: d.peopleSet.size,
      productivityPct,
      status,
      standardHours: minutesToHours(d.standardMinutes),
      actualHours: minutesToHours(d.actualMinutes),
      reworkHours: minutesToHours(d.reworkMinutes),
      otherWorkHours: minutesToHours(d.otherMinutes)
    };
  }).sort((a, b) => toNumber(b.productivityPct) - toNumber(a.productivityPct));

  const kpis = {
    presentEmployees: selectedAttendanceKeys.size,
    absentEmployees: selectedAbsent.length,
    availableHours: minutesToHours(selectedEntries.reduce((s, x) => s + toNumber(x.shift_available, 0), 0)),
    utilizedHours: minutesToHours(selectedEntries.reduce((s, x) => s + toNumber(x.total_actual_minutes, 0), 0)),
    standardOutputHours: minutesToHours(selectedEntries.reduce((s, x) => s + toNumber(x.total_standard_minutes, 0), 0)),
    productivityPct: pct(
      selectedEntries.reduce((s, x) => s + toNumber(x.total_standard_minutes, 0), 0),
      selectedEntries.reduce((s, x) => s + toNumber(x.shift_available, 0), 0)
    ),
    utilizationPct: pct(
      selectedEntries.reduce((s, x) => s + toNumber(x.total_actual_minutes, 0), 0),
      selectedEntries.reduce((s, x) => s + toNumber(x.shift_available, 0), 0)
    ),
    reworkHours: minutesToHours(selectedLines.filter((x) => clean(x.work_nature).toLowerCase() === "rework").reduce((s, x) => s + toNumber(x.actual_minutes, 0), 0)),
    otherWorkHours: minutesToHours(selectedLines.filter((x) => clean(x.work_nature).toLowerCase() === "other").reduce((s, x) => s + toNumber(x.actual_minutes, 0), 0)),
    lossHours: minutesToHours(selectedEntries.reduce((s, x) => s + toNumber(x.major_loss_minutes, 0), 0))
  };

  const topPeriod = people.find((p) => toNumber(p.score, 0) > 0) || null;
  const topMonth = people.filter((p) => toNumber(p.score, 0) > 0).slice(0, 3).map((p, idx) => ({
    ...p,
    badges: [`Month Rank ${idx + 1}`]
  }));

  const shifts = Array.from(new Set([
    ...shiftsRaw.map((s) => clean(s.shift_name || s.shift_code)).filter(Boolean),
    ...entriesRaw.map((e) => clean(e.shift_name || e.shift_code)).filter(Boolean)
  ])).sort((a, b) => a.localeCompare(b));

  const departmentsForFilter = Array.from(new Set([
    ...activeEmployees.map((e) => clean(e.department)).filter(Boolean),
    ...linesRaw.map((l) => clean(l.department_name || l.department_code)).filter(Boolean)
  ])).sort((a, b) => a.localeCompare(b));

  const employeesForFilter = activeEmployees.map((e) => e.name || e.code).filter(Boolean).sort((a, b) => a.localeCompare(b));

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
    insights: buildInsights({ kpis, departments, employees: people, rangeLabel: range.label }),
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
