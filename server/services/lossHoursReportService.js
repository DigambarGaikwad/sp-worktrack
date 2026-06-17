// server/services/lossHoursReportService.js
// Builds detailed Major Loss Hours report from production_entries for People Dashboard.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function hours(minutes) { return Number((num(minutes, 0) / 60).toFixed(1)); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(date, days) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() + days); return d; }
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function safeYear(value) { const y = Number(value); return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear(); }
function safeMonth(value) { const m = Number(value); return Number.isInteger(m) && m >= 1 && m <= 12 ? m : new Date().getMonth() + 1; }
function monthName(month) { return new Date(2000, month - 1, 1).toLocaleString("en-IN", { month: "long" }); }
function inRange(value, range) { const d = clean(value); return d && d >= range.from && d <= range.to; }

function capFutureRange(range) {
  const today = dateKey(new Date());
  if (range.from <= today && range.to > today) return { ...range, to: today };
  return range;
}

function selectedRange(params = {}) {
  const period = clean(params.period || "selectedMonth");
  const today = new Date();
  const year = safeYear(params.year);
  const month = safeMonth(params.month);

  if (period === "today") return { from: dateKey(today), to: dateKey(today), label: "Today", mode: "day", year: today.getFullYear(), month: today.getMonth() + 1 };
  if (period === "yesterday") {
    const y = addDays(today, -1);
    return { from: dateKey(y), to: dateKey(y), label: "Yesterday", mode: "day", year: y.getFullYear(), month: y.getMonth() + 1 };
  }
  if (period === "last7") return { from: dateKey(addDays(today, -6)), to: dateKey(today), label: "Last 7 Days", mode: "last7", year: today.getFullYear(), month: today.getMonth() + 1 };
  if (period === "selectedYear") return capFutureRange({ from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}`, mode: "year", year, month: "All" });
  if (period === "month") return capFutureRange({ from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, to: dateKey(today), label: "This Month", mode: "month", year: today.getFullYear(), month: today.getMonth() + 1 });

  return capFutureRange({ from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`, label: `${monthName(month)} ${year}`, mode: "month", year, month });
}

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

function group(rows, keyFn, labelKey = "name") {
  const map = new Map();
  rows.forEach((r) => {
    const name = clean(keyFn(r) || "Not Specified");
    if (!map.has(name)) map.set(name, { [labelKey]: name, count: 0, minutes: 0 });
    const x = map.get(name);
    x.count += 1;
    x.minutes += num(r.lossMinutes, 0);
  });
  return Array.from(map.values())
    .map((x) => ({ ...x, hours: hours(x.minutes) }))
    .sort((a, b) => num(b.minutes) - num(a.minutes) || clean(a[labelKey]).localeCompare(clean(b[labelKey])));
}

function employeeKey(code, name) { return clean(code || name).toLowerCase(); }

async function getLossHoursReport(params = {}) {
  const range = selectedRange(params);
  const shiftFilter = clean(params.shift || "All");
  const departmentFilter = clean(params.department || "All");
  const employeeFilter = clean(params.employee || "All");

  const [entriesRaw, employeesRaw] = await Promise.all([
    listAll("production_entries", { perPage: 10000, sort: "-work_date" }),
    listAll("employees", { perPage: 1000 }).catch(() => [])
  ]);

  const employeeDept = new Map();
  employeesRaw.forEach((e) => {
    const dept = clean(e.department || e.department_name || "-") || "-";
    const code = clean(e.emp_code || e.code);
    const name = clean(e.full_name || e.name || e.emp_name);
    if (code) employeeDept.set(employeeKey(code, name), dept);
    if (name) employeeDept.set(employeeKey("", name), dept);
  });

  const rows = entriesRaw
    .filter((entry) => inRange(entry.work_date, range))
    .filter((entry) => num(entry.major_loss_minutes, 0) > 0)
    .filter((entry) => shiftFilter === "All" || clean(entry.shift_name || entry.shift_code) === shiftFilter)
    .filter((entry) => employeeFilter === "All" || clean(entry.emp_name || entry.emp_code) === employeeFilter)
    .map((entry) => {
      const empCode = clean(entry.emp_code);
      const empName = clean(entry.emp_name || empCode || "-");
      const dept = clean(entry.department_name || entry.department || employeeDept.get(employeeKey(empCode, empName)) || employeeDept.get(employeeKey("", empName)) || "-");
      return {
        workDate: clean(entry.work_date),
        shift: clean(entry.shift_name || entry.shift_code || "-"),
        empCode,
        empName,
        department: dept,
        machine: clean(entry.machine_no || entry.machine || entry.machine_name || "-"),
        reason: clean(entry.major_loss_reason || "Not Specified"),
        remark: clean(entry.major_loss_remark || entry.remarks || entry.remark || ""),
        lossMinutes: num(entry.major_loss_minutes, 0),
        lossHours: hours(entry.major_loss_minutes),
        entryNo: clean(entry.entry_no || entry.id)
      };
    })
    .filter((row) => departmentFilter === "All" || clean(row.department) === departmentFilter)
    .sort((a, b) => clean(b.workDate).localeCompare(clean(a.workDate)) || clean(a.empName).localeCompare(clean(b.empName)));

  const totalLossMinutes = rows.reduce((sum, r) => sum + num(r.lossMinutes, 0), 0);
  const byReason = group(rows, (r) => r.reason || "Not Specified");
  const byEmployee = group(rows, (r) => r.empName || r.empCode || "Unknown", "employee");
  const byDate = group(rows, (r) => r.workDate || "No Date", "date");

  return {
    title: "Loss Hours Report",
    range,
    filters: { shift: shiftFilter, department: departmentFilter, employee: employeeFilter },
    kpis: {
      records: rows.length,
      totalLossHours: hours(totalLossMinutes),
      employees: new Set(rows.map((r) => employeeKey(r.empCode, r.empName))).size,
      reasons: new Set(rows.map((r) => clean(r.reason || "Not Specified"))).size,
      averageLossHours: rows.length ? Number((hours(totalLossMinutes) / rows.length).toFixed(1)) : 0
    },
    byReason,
    byEmployee,
    byDate,
    rows,
    meta: { service: "lossHoursReportService", generatedAt: new Date().toISOString(), source: "production_entries.major_loss_minutes" }
  };
}

module.exports = { getLossHoursReport };
