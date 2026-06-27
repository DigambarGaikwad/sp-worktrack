// server/services/dashboardDetailLossService.js
// Contract builders for Machine Dashboard detail and loss summary.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(v) { return String(v ?? "").trim(); }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function hours(min) { return Number((num(min, 0) / 60).toFixed(2)); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d, days) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + days); return x; }
function escFilter(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function pct(n, d) { return num(d, 0) > 0 ? Number(((num(n, 0) / num(d, 0)) * 100).toFixed(1)) : 0; }

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

function statusOfMachine(m = {}) {
  const raw = clean(m.status).toLowerCase();
  if (raw === "completed" || raw === "complete") return "Completed";
  if (["inactive", "deleted", "delete", "disabled"].includes(raw)) return "Inactive";
  if (m.active === false) return "Inactive";
  return "Active";
}

function rangeFromParams(params = {}) {
  const today = new Date();
  const range = clean(params.range || "currentMonth");
  if (params.from && params.to) return { from: clean(params.from), to: clean(params.to), label: "Custom Range" };
  const y = today.getFullYear(), m = today.getMonth();
  if (range === "lastMonth") {
    const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
    return { from: ymd(first), to: ymd(last), label: "Last Month" };
  }
  if (range === "last6Months") {
    const first = new Date(y, m - 5, 1);
    return { from: ymd(first), to: ymd(today), label: "Last 6 Months" };
  }
  if (range === "year") return { from: `${y}-01-01`, to: ymd(today), label: "Current Year" };
  return { from: ymd(new Date(y, m, 1)), to: ymd(today), label: "Current Month" };
}

function inRange(date, range) {
  const d = clean(date);
  return d && d >= range.from && d <= range.to;
}

function workKey(line = {}) {
  return [clean(line.department_code || line.department_name), clean(line.subwork_code || line.subwork_name)].join("|");
}

function groupAdd(map, key, initial, update) {
  if (!map.has(key)) map.set(key, { ...initial });
  update(map.get(key));
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!clean(value)) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function qualityPointName(q = {}) {
  return clean(q.point_name || q.quality_point || q.point || q.name || q.pointName || q.qualityPoint);
}

function qualityKey(dept, subwork, point) {
  return [clean(dept).toLowerCase(), clean(subwork).toLowerCase(), clean(point).toLowerCase()].join("|");
}

function qualityStatusLabel(status, value) {
  const s = clean(status).toUpperCase();
  const v = clean(value).toUpperCase();
  if (s) return s;
  if (!v) return "PENDING";
  if (v.includes("NOT OK") || v.includes("NG") || v.includes("FAIL")) return "NOT OK";
  if (v === "OK" || v === "DONE" || v === "PASS") return v;
  return "DONE";
}

function buildQualityStatus({ typeCode, qualityPoints, lines, qualityLogs }) {
  const out = new Map();

  function addPending({ point, department, subwork, inputType, source }) {
    const p = clean(point);
    if (!p) return;
    const key = qualityKey(department, subwork, p);
    if (out.has(key)) return;
    out.set(key, {
      point: p,
      department: clean(department) || "-",
      subwork: clean(subwork) || "-",
      inputType: clean(inputType || "status") || "status",
      status: "PENDING",
      value: "",
      empCode: "",
      empName: "",
      workDate: "",
      source: source || "planned"
    });
  }

  function addDone(q = {}) {
    const point = qualityPointName(q);
    if (!point) return;
    const department = clean(q.department_name || q.department || q.department_code || "-");
    const subwork = clean(q.subwork_name || q.subwork || q.subwork_code || "-");
    const value = clean(q.value || q.result || q.reading || q.reading_value);
    const key = qualityKey(department, subwork, point);
    const existing = out.get(key) || {};

    out.set(key, {
      ...existing,
      point,
      department,
      subwork,
      inputType: clean(q.input_type || q.inputType || existing.inputType || "status"),
      status: qualityStatusLabel(q.status, value),
      value,
      empCode: clean(q.emp_code || q.done_by_id || existing.empCode),
      empName: clean(q.emp_name || q.done_by_name || existing.empName),
      workDate: clean(q.work_date || q.date || existing.workDate),
      source: "quality_log"
    });
  }

  (qualityPoints || [])
    .filter(q => q && q.active !== false)
    .filter(q => !clean(q.machine_type_code || q.type_code || q.machineTypeCode) || clean(q.machine_type_code || q.type_code || q.machineTypeCode) === typeCode)
    .forEach(q => addPending({
      point: qualityPointName(q),
      department: q.department_name || q.department || q.department_code,
      subwork: q.subwork_name || q.subwork || q.subwork_code,
      inputType: q.input_type || q.inputType,
      source: "quality_points_master"
    }));

  (lines || []).forEach(line => {
    const department = clean(line.department_name || line.department_code || "-");
    const subwork = clean(line.subwork_name || line.subwork_code || "-");
    parseArray(line.quality_points_json).forEach(q => {
      const point = qualityPointName(q);
      if (!point) return;
      const value = clean(q.value || q.reading || q.status);
      const status = qualityStatusLabel(q.status, value);
      if (status === "PENDING") {
        addPending({ point, department, subwork, inputType: q.inputType || q.input_type, source: "line_quality_json" });
      } else {
        addDone({ ...q, department_name: department, subwork_name: subwork, emp_code: line.emp_code, emp_name: line.emp_name, work_date: line.work_date, value, status });
      }
    });
  });

  (qualityLogs || [])
    .sort((a, b) => clean(a.work_date || a.created).localeCompare(clean(b.work_date || b.created)))
    .forEach(addDone);

  return Array.from(out.values()).sort((a, b) =>
    clean(a.department).localeCompare(clean(b.department)) ||
    clean(a.subwork).localeCompare(clean(b.subwork)) ||
    clean(a.point).localeCompare(clean(b.point))
  );
}

async function getMachineDetail(params = {}) {
  const machineNo = clean(params.machine || params.machineNo);
  if (!machineNo) { const err = new Error("Machine is required."); err.status = 400; throw err; }

  const machineFilter = `machine_no="${escFilter(machineNo)}"`;
  const [machines, machineTypes, subworks, bookingPoints, qualityPoints, lines, bookingStatus, qualityLogs] = await Promise.all([
    listAll("machines", { perPage: 1000 }),
    listAll("machine_types", { perPage: 1000 }),
    listAll("subworks", { perPage: 2000 }),
    listAll("booking_points", { perPage: 2000 }),
    listAll("quality_points", { perPage: 2000 }),
    listAll("production_entry_lines", { perPage: 5000, filter: machineFilter, sort: "-work_date" }),
    listAll("booking_status", { perPage: 2000, filter: machineFilter }),
    listAll("quality_logs", { perPage: 2000, filter: machineFilter, sort: "-work_date" })
  ]);

  const machine = machines.find(m => clean(m.machine_no || m.name || m.machineNo) === machineNo) || {};
  const typeCode = clean(machine.machine_type_code || lines[0]?.machine_type_code || "");
  const typeName = clean(machineTypes.find(t => clean(t.type_code) === typeCode)?.type_name || lines[0]?.machine_category || typeCode);
  const status = statusOfMachine(machine.id ? machine : { status: lines.length ? "Historical" : "Active" });
  const workDates = lines.map(l => clean(l.work_date)).filter(Boolean).sort();
  const startDate = clean(machine.start_date || machine.startDate || workDates[0] || "");
  const endDate = status === "Completed" ? clean(machine.end_date || machine.completed_date || workDates[workDates.length - 1] || "") : "";

  const masterSubworks = subworks
    .filter(sw => sw.active !== false && clean(sw.machine_type_code) === typeCode)
    .map(sw => ({
      key: [clean(sw.department_code), clean(sw.subwork_code)].join("|"),
      department: clean(sw.department_name || sw.department_code),
      departmentCode: clean(sw.department_code),
      subwork: clean(sw.subwork_name),
      subworkCode: clean(sw.subwork_code),
      plannedMinutes: num(sw.standard_time, 0)
    }));

  const actualByWork = new Map();
  const reworkOtherDetails = [];
  lines.forEach(line => {
    const nature = clean(line.work_nature || "Normal").toLowerCase();
    const actual = num(line.actual_minutes, 0);
    const standard = num(line.standard_minutes, 0);
    const dept = clean(line.department_name || line.department_code || "-");
    const sub = clean(line.subwork_name || line.sub_work || line.subwork_code || "-");
    const key = workKey(line);
    if (nature === "rework" || nature === "other") {
      reworkOtherDetails.push({
        workDate: clean(line.work_date),
        workNature: nature === "rework" ? "Rework" : "Other",
        department: dept,
        subwork: sub,
        rootArea: clean(line.root_area),
        actualMinutes: actual,
        description: clean(line.description || line.remarks || line.efficiency_reason),
        efficiencyReason: clean(line.efficiency_reason),
        empCode: clean(line.emp_code),
        empName: clean(line.emp_name)
      });
      return;
    }
    groupAdd(actualByWork, key, { department: dept, subwork: sub, plannedMinutes: 0, completedStandardMinutes: 0, actualMinutes: 0, overrunMinutes: 0, lastWorkDate: "" }, item => {
      item.completedStandardMinutes += standard;
      item.actualMinutes += actual;
      item.overrunMinutes += num(line.overrun_minutes, Math.max(0, actual - standard));
      if (clean(line.work_date) > item.lastWorkDate) item.lastWorkDate = clean(line.work_date);
    });
  });

  const workMap = new Map();
  masterSubworks.forEach(sw => {
    workMap.set(sw.key, { departmentName: sw.department, subworkName: sw.subwork, plannedMinutes: sw.plannedMinutes, completedStandardMinutes: 0, actualMinutes: 0, overrunMinutes: 0, lastWorkDate: "" });
  });
  actualByWork.forEach((a, key) => {
    if (!workMap.has(key)) workMap.set(key, { departmentName: a.department, subworkName: a.subwork, plannedMinutes: a.completedStandardMinutes, completedStandardMinutes: 0, actualMinutes: 0, overrunMinutes: 0, lastWorkDate: "" });
    const item = workMap.get(key);
    item.completedStandardMinutes += a.completedStandardMinutes;
    item.actualMinutes += a.actualMinutes;
    item.overrunMinutes += a.overrunMinutes;
    item.lastWorkDate = a.lastWorkDate || item.lastWorkDate;
  });

  const allWork = Array.from(workMap.values()).map(w => ({
    ...w,
    remainingMinutes: Math.max(0, num(w.plannedMinutes, 0) - num(w.completedStandardMinutes, 0)),
    completionPct: pct(w.completedStandardMinutes, w.plannedMinutes)
  }));
  const remainingWork = allWork.filter(w => num(w.remainingMinutes, 0) > 0).sort((a, b) => clean(a.departmentName).localeCompare(clean(b.departmentName)) || clean(a.subworkName).localeCompare(clean(b.subworkName)));
  const completedWork = allWork.filter(w => num(w.remainingMinutes, 0) <= 0 && num(w.plannedMinutes, 0) > 0).sort((a, b) => clean(a.departmentName).localeCompare(clean(b.departmentName)) || clean(a.subworkName).localeCompare(clean(b.subworkName)));

  const deptMap = new Map();
  allWork.forEach(w => {
    const dept = clean(w.departmentName || "-");
    groupAdd(deptMap, dept, { department: dept, plannedMinutes: 0, actualMinutes: 0, remainingMinutes: 0, overrunMinutes: 0, completedStandardMinutes: 0 }, d => {
      d.plannedMinutes += num(w.plannedMinutes, 0);
      d.completedStandardMinutes += num(w.completedStandardMinutes, 0);
      d.actualMinutes += num(w.actualMinutes, 0);
      d.remainingMinutes += num(w.remainingMinutes, 0);
      d.overrunMinutes += num(w.overrunMinutes, 0);
    });
  });
  const departments = Array.from(deptMap.values()).map(d => ({ ...d, completionPct: pct(d.completedStandardMinutes, d.plannedMinutes) }));

  const bookingPointsOut = bookingStatus.map(bp => ({
    department: clean(bp.department_name || bp.department || bp.department_code),
    subwork: clean(bp.subwork_name || bp.subwork || bp.subwork_code),
    point: clean(bp.point_name || bp.point || bp.booking_point),
    status: clean(bp.status || "PENDING"),
    standardMinutes: num(bp.standard_minutes || bp.standard_time, 0),
    consumedMinutes: num(bp.consumed_minutes || bp.actual_minutes, 0),
    remainingMinutes: num(bp.remaining_minutes, 0)
  }));

  const qualityStatus = buildQualityStatus({ typeCode, qualityPoints, lines, qualityLogs });

  const latestDate = workDates[workDates.length - 1] ? new Date(workDates[workDates.length - 1]) : new Date();
  const lastSixDays = [];
  let cursor = latestDate;
  while (lastSixDays.length < 6) {
    if (cursor.getDay() !== 0) lastSixDays.push(ymd(cursor));
    cursor = addDays(cursor, -1);
  }
  const lastSixWorkDays = { days: lastSixDays.reverse().map(d => {
    const dayLines = lines.filter(l => clean(l.work_date) === d);
    const std = dayLines.reduce((s, l) => s + (clean(l.work_nature).toLowerCase() === "normal" ? num(l.standard_minutes, 0) : 0), 0);
    const actual = dayLines.reduce((s, l) => s + num(l.actual_minutes, 0), 0);
    const reworkOther = dayLines.reduce((s, l) => s + (["rework", "other"].includes(clean(l.work_nature).toLowerCase()) ? num(l.actual_minutes, 0) : 0), 0);
    return { workDate: d, hasEntry: dayLines.length > 0, entryCount: dayLines.length, progressPct: pct(std, allWork.reduce((x, w) => x + num(w.plannedMinutes, 0), 0)), efficiencyPct: pct(std, actual), standardHours: hours(std), actualHours: hours(actual), overrunHours: hours(dayLines.reduce((s, l) => s + num(l.overrun_minutes, 0), 0)), reworkOtherHours: hours(reworkOther) };
  }) };
  lastSixWorkDays.standardHours = Number(lastSixWorkDays.days.reduce((s, d) => s + num(d.standardHours), 0).toFixed(2));
  lastSixWorkDays.actualHours = Number(lastSixWorkDays.days.reduce((s, d) => s + num(d.actualHours), 0).toFixed(2));
  lastSixWorkDays.overrunHours = Number(lastSixWorkDays.days.reduce((s, d) => s + num(d.overrunHours), 0).toFixed(2));
  lastSixWorkDays.reworkOtherHours = Number(lastSixWorkDays.days.reduce((s, d) => s + num(d.reworkOtherHours), 0).toFixed(2));
  lastSixWorkDays.workDonePct = pct(lastSixWorkDays.days.reduce((s, d) => s + (num(d.standardHours) * 60), 0), allWork.reduce((x, w) => x + num(w.plannedMinutes, 0), 0));

  return {
    machine: { machineNo, machineCategory: typeName, machineTypeCode: typeCode, status, startDate, endDate },
    departments,
    reworkOtherDetails,
    remainingWork,
    completedWork,
    qualityStatus,
    bookingPoints: bookingPointsOut,
    lastSixWorkDays,
    shortageMaterial: [],
    meta: { service: "dashboardDetailLossService", qualityRule: "master+line-json+logs shows pending and done", lines: lines.length, subworks: masterSubworks.length, qualityPoints: qualityStatus.length, reworkOtherDetails: reworkOtherDetails.length }
  };
}

async function getLossSummary(params = {}) {
  const range = rangeFromParams(params);
  const [entries, lines] = await Promise.all([
    listAll("production_entries", { perPage: 5000, sort: "-work_date" }),
    listAll("production_entry_lines", { perPage: 10000, sort: "-work_date" })
  ]);

  const reworkRows = [];
  const otherRows = [];
  const majorRows = [];

  lines.filter(l => inRange(l.work_date, range)).forEach(l => {
    const nature = clean(l.work_nature).toLowerCase();
    if (!["rework", "other"].includes(nature)) return;
    const row = { workDate: clean(l.work_date), type: nature === "rework" ? "Rework" : "Other Work", machineNo: clean(l.machine_no), department: clean(l.department_name || l.department_code), subwork: clean(l.subwork_name || l.subwork_code), rootArea: clean(l.root_area), reason: clean(l.description || l.efficiency_reason || l.remarks), hours: hours(l.actual_minutes), empName: clean(l.emp_name || l.emp_code) };
    if (nature === "rework") reworkRows.push(row); else otherRows.push(row);
  });

  entries.filter(e => inRange(e.work_date, range)).forEach(e => {
    const min = num(e.major_loss_minutes, 0);
    if (min <= 0) return;
    majorRows.push({ workDate: clean(e.work_date), type: "Major Loss", machineNo: "-", department: "-", subwork: "-", rootArea: "-", reason: clean(e.major_loss_reason || e.remarks || "Major Loss"), hours: hours(min), empName: clean(e.emp_name || e.emp_code) });
  });

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

  const reworkHours = reworkRows.reduce((s, r) => s + num(r.hours), 0);
  const otherHours = otherRows.reduce((s, r) => s + num(r.hours), 0);
  const majorLossHours = majorRows.reduce((s, r) => s + num(r.hours), 0);

  return {
    range,
    summary: { reworkHours: Number(reworkHours.toFixed(2)), otherHours: Number(otherHours.toFixed(2)), majorLossHours: Number(majorLossHours.toFixed(2)), totalLossHours: Number((reworkHours + otherHours + majorLossHours).toFixed(2)) },
    rework: { byRootArea: group(reworkRows, r => r.rootArea || "Not Specified") },
    majorLoss: { byReason: group(majorRows, r => r.reason || "Not Specified") },
    details: [...reworkRows, ...otherRows, ...majorRows].sort((a, b) => clean(b.workDate).localeCompare(clean(a.workDate))).slice(0, 500),
    meta: { service: "dashboardDetailLossService", reworkRows: reworkRows.length, otherRows: otherRows.length, majorRows: majorRows.length }
  };
}

module.exports = { getMachineDetail, getLossSummary };
