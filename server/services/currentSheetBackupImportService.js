// server/services/currentSheetBackupImportService.js
// Restores DB Edition Google Sheet backup Excel files into PocketBase.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { backupDb } = require("./maintenanceService");

function clean(value) { return String(value ?? "").trim(); }
function toNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function slug(value) { return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function hash(value) { return crypto.createHash("sha1").update(clean(value)).digest("hex").slice(0, 12); }
function counter() { return { checked: 0, wouldCreate: 0, wouldUpdate: 0, created: 0, updated: 0, skipped: 0, errors: 0 }; }
function bump(summary, name) { if (!summary[name]) summary[name] = counter(); return summary[name]; }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function excelDateToYmd(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return ymd(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const s = clean(value);
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const parts = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (parts) return `${parts[3]}-${String(parts[2]).padStart(2, "0")}-${String(parts[1]).padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : ymd(d);
}

function excelTimeToText(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const total = Math.round(value * 24 * 60);
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return clean(value);
}

function machineTypeCode(category) {
  const s = clean(category).toLowerCase();
  if (s.includes("air")) return "Booster-AirCool";
  if (s.includes("water")) return "Booster-WaterCooled";
  if (s.includes("online")) return "Online";
  if (s.includes("dispenser")) return "Dispenser";
  return slug(category) || "Unknown";
}

function readWorkbook(filePath) {
  const resolved = path.resolve(clean(filePath));
  if (!resolved || !fs.existsSync(resolved)) {
    const err = new Error("Excel file not found. Select a valid current Google Sheet backup .xlsx file.");
    err.status = 400;
    throw err;
  }
  if (!/\.xlsx?$/i.test(resolved)) {
    const err = new Error("Only .xlsx/.xls files are allowed.");
    err.status = 400;
    throw err;
  }
  return { workbook: XLSX.readFile(resolved, { cellDates: false }), filePath: resolved };
}

function sheetRows(workbook, sheetName) {
  const sh = workbook.Sheets[sheetName];
  if (!sh) return [];
  return XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: true });
}

function records(workbook, sheetName) {
  const rows = sheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const headers = rows[0].map(clean);
  return rows.slice(1).filter(row => row.some(x => clean(x))).map(row => {
    const out = {};
    headers.forEach((h, i) => { if (h) out[h] = row[i]; });
    return out;
  });
}

function findYearSheets(workbook, prefix) {
  const re = new RegExp(`^${prefix}_\\d{4}$`, "i");
  return (workbook.SheetNames || []).filter(name => re.test(name)).sort();
}

function allLogRows(workbook) {
  return findYearSheets(workbook, "LOG").flatMap(sheetName => records(workbook, sheetName).map(row => ({ ...row, __sheetName: sheetName })));
}

function allAttendanceRows(workbook) {
  return findYearSheets(workbook, "ATT").flatMap(sheetName => records(workbook, sheetName).map(row => ({ ...row, __sheetName: sheetName })));
}

async function findOne(collectionName, filter) {
  const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "GET", query: { page: 1, perPage: 1, filter } });
  return Array.isArray(result.items) ? result.items[0] || null : null;
}

async function upsert(collectionName, filter, body, apply, counters) {
  counters.checked += 1;
  const existing = await findOne(collectionName, filter).catch(() => null);
  if (!apply) { existing ? counters.wouldUpdate++ : counters.wouldCreate++; return existing || body; }
  if (existing?.id) { counters.updated += 1; return pocketBaseRequest(`/api/collections/${collectionName}/records/${existing.id}`, { method: "PATCH", body }); }
  counters.created += 1;
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "POST", body });
}

async function createIfMissing(collectionName, filter, body, apply, counters) {
  counters.checked += 1;
  const existing = await findOne(collectionName, filter).catch(() => null);
  if (existing?.id) { counters.skipped += 1; return existing; }
  if (!apply) { counters.wouldCreate += 1; return body; }
  counters.created += 1;
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "POST", body });
}

async function safeCreateIfMissing(collectionName, filter, body, apply, counters) {
  try { return await createIfMissing(collectionName, filter, body, apply, counters); }
  catch (_) { counters.errors += 1; counters.skipped += 1; return null; }
}

function parseJsonArray(value) {
  const s = clean(value);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function sourceEntryNo(row) {
  const existing = clean(row["Source Entry No"]);
  if (existing) return existing;
  const workDate = excelDateToYmd(row["Work Date"]);
  const emp = clean(row["Emp ID"]);
  const shift = slug(row.Shift);
  const ts = hash(row.Timestamp || [workDate, emp, shift, row.Machine].join("|"));
  return `SHEET-${workDate.replace(/-/g, "")}-${emp}-${shift}-${ts}`;
}

function sourceLineNo(row, fallback) {
  const n = Number(row["Source Line No"]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function logLineToBody(row, entryNo, lineNo) {
  const workDate = excelDateToYmd(row["Work Date"]);
  const category = clean(row["Machine Category"]) || "Unknown";
  const dept = clean(row.Department) || "Unmapped Department";
  const sub = clean(row["Sub Work"]) || "Unmapped Sub Work";
  const std = toNumber(row["Standard Time"], 0);
  const actual = toNumber(row["Actual Time"], 0);
  return {
    entry_no: entryNo,
    line_no: lineNo,
    source_hash: hash([entryNo, lineNo, workDate, row.Machine, dept, sub, row.Type, actual].join("|")),
    work_date: workDate,
    work_year: Number(workDate.slice(0, 4)) || new Date().getFullYear(),
    emp_code: clean(row["Emp ID"]),
    emp_name: clean(row["Emp Name"]),
    machine_no: clean(row.Machine),
    machine_type_code: machineTypeCode(category),
    machine_category: category,
    department_code: slug(dept) || "unmapped_department",
    department_name: dept,
    subwork_code: slug(sub) || "unmapped_sub_work",
    subwork_name: sub,
    work_nature: clean(row.Type || "Normal") || "Normal",
    description: clean(row.Description),
    root_area: clean(row["Root Area"]),
    standard_minutes: std,
    actual_minutes: actual,
    overrun_minutes: Math.max(0, actual - std),
    efficiency_reason: clean(row["Efficiency Reason"]),
    booking_points_json: parseJsonArray(row["Work Checkpoints"]),
    quality_points_json: parseJsonArray(row["Quality Checkpoints"])
  };
}

function analyzeWorkbook(workbook, filePath) {
  const logSheets = findYearSheets(workbook, "LOG");
  const attSheets = findYearSheets(workbook, "ATT");
  const logRows = allLogRows(workbook);
  const attRows = allAttendanceRows(workbook);
  const qualityRows = records(workbook, "QUALITY_LOG");
  const bookingRows = records(workbook, "BOOKING_LOG");
  const bookingStatusRows = records(workbook, "BOOKING_STATUS");
  const warnings = [];

  if (!logSheets.length) warnings.push("No LOG_YYYY sheet found.");
  if (!attSheets.length) warnings.push("No ATT_YYYY sheet found.");
  if (!workbook.SheetNames.includes("QUALITY_LOG")) warnings.push("QUALITY_LOG sheet not found. Quality dashboard restore will be skipped.");
  if (!workbook.SheetNames.includes("BOOKING_LOG")) warnings.push("BOOKING_LOG sheet not found. Booking log restore will be skipped.");
  if (!workbook.SheetNames.includes("BOOKING_STATUS")) warnings.push("BOOKING_STATUS sheet not found. Booking status restore will be skipped.");

  const dates = [...logRows.map(r => excelDateToYmd(r["Work Date"])), ...attRows.map(r => excelDateToYmd(r["Work Date"]))].filter(Boolean).sort();
  const sourceEntries = new Set(logRows.map(sourceEntryNo).filter(Boolean));
  const machines = new Set(logRows.map(r => clean(r.Machine)).filter(Boolean));
  const employees = new Map();
  [...logRows, ...attRows].forEach(r => { const code = clean(r["Emp ID"]); if (code && !employees.has(code)) employees.set(code, clean(r["Emp Name"])); });

  return {
    filePath,
    fileName: path.basename(filePath),
    sheets: workbook.SheetNames || [],
    detectedProfile: "current_google_sheet_backup",
    dateRange: { from: dates[0] || "", to: dates[dates.length - 1] || "" },
    counts: {
      logSheets: logSheets.length,
      attendanceSheets: attSheets.length,
      productionEntries: sourceEntries.size,
      productionLines: logRows.length,
      attendance: attRows.length,
      employees: employees.size,
      machines: machines.size,
      qualityLogs: qualityRows.length,
      bookingLogs: bookingRows.length,
      bookingStatus: bookingStatusRows.length
    },
    logSheets,
    attendanceSheets: attSheets,
    warnings
  };
}

async function importMastersFromLogs(logRows, attRows, apply, summary) {
  const empMap = new Map();
  [...logRows, ...attRows].forEach(row => {
    const code = clean(row["Emp ID"]);
    if (code && !empMap.has(code)) empMap.set(code, clean(row["Emp Name"]));
  });
  for (const [empCode, name] of empMap) {
    await upsert("employees", `emp_code="${pbEscape(empCode)}"`, { emp_code: empCode, full_name: name, department: "", designation: "", active: true, available_minutes_day: 0 }, apply, bump(summary, "employees"));
  }

  const typeMap = new Map(), deptMap = new Map(), subMap = new Map(), machineMap = new Map(), shiftMap = new Map();
  logRows.forEach(row => {
    const category = clean(row["Machine Category"]) || "Unknown";
    const typeCode = machineTypeCode(category);
    const dept = clean(row.Department) || "Unmapped Department";
    const sub = clean(row["Sub Work"]) || "Unmapped Sub Work";
    typeMap.set(typeCode, category);
    deptMap.set(slug(dept) || "unmapped_department", dept);
    subMap.set([typeCode, slug(dept), slug(sub)].join("|"), { typeCode, deptCode: slug(dept), subCode: slug(sub), subName: sub, std: toNumber(row["Standard Time"], 0) });
    const machine = clean(row.Machine);
    if (machine) machineMap.set(machine, typeCode);
    const shiftName = clean(row.Shift);
    if (shiftName && !shiftMap.has(shiftName)) shiftMap.set(shiftName, { start: excelTimeToText(row["Shift Start"]), end: excelTimeToText(row["Shift End"]), breakMinutes: toNumber(row["Break Minutes"], 0) });
  });
  attRows.forEach(row => {
    const shiftName = clean(row.Shift);
    if (shiftName && !shiftMap.has(shiftName)) shiftMap.set(shiftName, { start: "", end: "", breakMinutes: 0 });
  });

  for (const [typeCode, typeName] of typeMap) await upsert("machine_types", `type_code="${pbEscape(typeCode)}"`, { type_code: typeCode, type_name: typeName, active: true }, apply, bump(summary, "machine_types"));
  for (const [departmentCode, departmentName] of deptMap) await upsert("departments", `department_code="${pbEscape(departmentCode)}"`, { department_code: departmentCode, department_name: departmentName, active: true }, apply, bump(summary, "departments"));
  for (const item of subMap.values()) await upsert("subworks", `machine_type_code="${pbEscape(item.typeCode)}" && department_code="${pbEscape(item.deptCode)}" && subwork_code="${pbEscape(item.subCode)}"`, { machine_type_code: item.typeCode, department_code: item.deptCode, subwork_code: item.subCode, subwork_name: item.subName, standard_time: item.std, active: true }, apply, bump(summary, "subworks"));
  for (const [machineNo, typeCode] of machineMap) await upsert("machines", `machine_no="${pbEscape(machineNo)}"`, { machine_no: machineNo, machine_type_code: typeCode, status: "Active", active: true }, apply, bump(summary, "machines"));
  for (const [shiftName, s] of shiftMap) {
    const shiftCode = slug(shiftName) || shiftName;
    await upsert("shifts", `shift_code="${pbEscape(shiftCode)}"`, { shift_code: shiftCode, shift_name: shiftName, start_time: s.start, end_time: s.end, break_minutes: s.breakMinutes, flexible: shiftName.toLowerCase().includes("overtime"), active: true }, apply, bump(summary, "shifts"));
  }
}

async function importAttendance(attRows, apply, summary) {
  for (const row of attRows) {
    const workDate = excelDateToYmd(row["Work Date"]);
    const empCode = clean(row["Emp ID"]);
    const shiftName = clean(row.Shift);
    if (!workDate || !empCode || !shiftName) continue;
    const workType = clean(row["Work Type"] || "Normal") || "Normal";
    const shiftCode = slug(shiftName) || shiftName;
    const attKey = [workDate, shiftCode, empCode, slug(workType)].map(x => clean(x).toLowerCase()).join("|");
    await upsert("attendance", `att_key="${pbEscape(attKey)}"`, { att_key: attKey, work_date: workDate, work_year: Number(workDate.slice(0, 4)) || new Date().getFullYear(), shift_code: shiftCode, shift_name: shiftName, emp_code: empCode, emp_name: clean(row["Emp Name"]), work_type: workType, status: clean(row.Status || "Present") || "Present", shift_available: toNumber(row["Shift Available (min)"], 0), utilized_minutes: toNumber(row["Utilized (min)"], 0), source_entry_no: clean(row["Source Entry No"]), remarks: "Restored from current Google Sheet backup" }, apply, bump(summary, "attendance"));
  }
}

function groupLogRows(logRows) {
  const groups = new Map();
  logRows.forEach(row => {
    const entryNo = sourceEntryNo(row);
    if (!groups.has(entryNo)) groups.set(entryNo, []);
    groups.get(entryNo).push(row);
  });
  return groups;
}

async function importProduction(logRows, apply, summary) {
  for (const [entryNo, rows] of groupLogRows(logRows)) {
    const first = rows[0];
    const workDate = excelDateToYmd(first["Work Date"]);
    const empCode = clean(first["Emp ID"]);
    const shiftName = clean(first.Shift);
    if (!workDate || !empCode || !shiftName) continue;
    const shiftCode = slug(shiftName) || shiftName;
    const workType = clean(first["Work Type"] || "Normal") || "Normal";
    const lines = rows.map((row, i) => logLineToBody(row, entryNo, sourceLineNo(row, i + 1)));
    const totalStd = lines.reduce((s, x) => s + toNumber(x.standard_minutes, 0), 0);
    const totalActual = lines.reduce((s, x) => s + toNumber(x.actual_minutes, 0), 0);
    const shiftAvailable = toNumber(first["Shift Available"], 0);
    await upsert("production_entries", `entry_no="${pbEscape(entryNo)}"`, { entry_no: entryNo, work_date: workDate, work_year: Number(workDate.slice(0, 4)) || new Date().getFullYear(), shift_code: shiftCode, shift_name: shiftName, shift_start: excelTimeToText(first["Shift Start"]), shift_end: excelTimeToText(first["Shift End"]), break_minutes: toNumber(first["Break Minutes"], 0), flexible_shift_minutes: toNumber(first["Flexible Shift Minutes"], 0), work_type: workType, emp_code: empCode, emp_name: clean(first["Emp Name"]), gross_shift_available: shiftAvailable, major_loss_reason: clean(first["Major Loss Reason"]), major_loss_minutes: 0, shift_available: shiftAvailable, total_standard_minutes: totalStd, total_actual_minutes: totalActual, remaining_minutes: toNumber(first.Remaining, Math.max(0, shiftAvailable - totalActual)), productivity_percent: toNumber(first["Productivity %"], shiftAvailable > 0 ? Number(((totalStd / shiftAvailable) * 100).toFixed(2)) : 0), source: "current-google-sheet-restore", status: "SUBMITTED", remarks: "Restored from current Google Sheet backup" }, apply, bump(summary, "production_entries"));
    const lineCounter = bump(summary, "production_entry_lines");
    for (const line of lines) await safeCreateIfMissing("production_entry_lines", `entry_no="${pbEscape(line.entry_no)}" && line_no=${line.line_no}`, line, apply, lineCounter);
  }
}

async function importOptionalLogs(workbook, apply, summary) {
  const qualityCounter = bump(summary, "quality_logs");
  for (const row of records(workbook, "QUALITY_LOG")) {
    const body = { timestamp: clean(row.Timestamp), work_date: excelDateToYmd(row["Work Date"]), machine_no: clean(row.Machine), machine_category: clean(row["Machine Category"]), department_name: clean(row.Department), subwork_name: clean(row["Sub Work"]), quality_point: clean(row["Quality Point"]), input_type: clean(row["Input Type"]), reading_value: clean(row["Reading/Status"]), result: clean(row.Result), done_by_id: clean(row["Done By ID"]), done_by_name: clean(row["Done By Name"]), shift_name: clean(row.Shift), status: clean(row.Status), source_entry_no: clean(row["Source Entry No"]) };
    const key = hash([body.work_date, body.machine_no, body.quality_point, body.done_by_id, body.source_entry_no].join("|"));
    await safeCreateIfMissing("quality_logs", `source_hash="${pbEscape(key)}"`, { ...body, source_hash: key }, apply, qualityCounter);
  }

  const bookingCounter = bump(summary, "booking_logs");
  for (const row of records(workbook, "BOOKING_LOG")) {
    const body = { timestamp: clean(row.Timestamp), work_date: excelDateToYmd(row["Work Date"]), machine_no: clean(row.Machine), machine_category: clean(row["Machine Category"]), department_name: clean(row.Department), subwork_name: clean(row["Sub Work"]), booking_point: clean(row["Booking Point"]), booking_std_time: toNumber(row["Booking Std Time"], 0), actual_time: toNumber(row["Actual Time"], 0), emp_code: clean(row["Emp ID"]), emp_name: clean(row["Emp Name"]), shift_name: clean(row.Shift), work_type: clean(row["Work Type"]), status: clean(row.Status), source_entry_no: clean(row["Source Entry No"]) };
    const key = hash([body.work_date, body.machine_no, body.booking_point, body.emp_code, body.source_entry_no].join("|"));
    await safeCreateIfMissing("booking_logs", `source_hash="${pbEscape(key)}"`, { ...body, source_hash: key }, apply, bookingCounter);
  }

  const statusCounter = bump(summary, "booking_status");
  for (const row of records(workbook, "BOOKING_STATUS")) {
    const key = hash([row.Machine, row.Department, row["Sub Work"], row["Booking Point"]].join("|"));
    const body = { source_hash: key, machine_no: clean(row.Machine), machine_category: clean(row["Machine Category"]), department_name: clean(row.Department), subwork_name: clean(row["Sub Work"]), booking_point: clean(row["Booking Point"]), booking_std_time: toNumber(row["Booking Std Time"], 0), consumed_time: toNumber(row["Consumed Time"], 0), remaining_time: toNumber(row["Remaining Time"], 0), completion_percent: toNumber(row["Completion %"], 0), status: clean(row.Status), done_date: excelDateToYmd(row["Done Date"]), done_by_id: clean(row["Done By ID"]), done_by_name: clean(row["Done By Name"]), shift_name: clean(row.Shift), source_entry_no: clean(row["Source Entry No"]) };
    await safeCreateIfMissing("booking_status", `source_hash="${pbEscape(key)}"`, body, apply, statusCounter);
  }
}

async function runCurrentSheetRestore(filePath, { apply = false, createBackup = true } = {}) {
  const { workbook, filePath: resolved } = readWorkbook(filePath);
  const analysis = analyzeWorkbook(workbook, resolved);
  if (!analysis.logSheets.length && !analysis.attendanceSheets.length) {
    const err = new Error("Unsupported Excel structure. Expected current Google backup sheets like LOG_2026 and ATT_2026.");
    err.status = 400;
    throw err;
  }

  const summary = {};
  let backup = null;
  if (apply && createBackup) backup = await backupDb({ includeMaster: true, includeTransactions: true, reason: "Before current Google Sheet backup restore" });

  const logRows = allLogRows(workbook);
  const attRows = allAttendanceRows(workbook);
  await importMastersFromLogs(logRows, attRows, apply, summary);
  await importProduction(logRows, apply, summary);
  await importAttendance(attRows, apply, summary);
  await importOptionalLogs(workbook, apply, summary);

  return { analysis, summary, backup, mode: apply ? "APPLY" : "DRY_RUN" };
}

function analyzeCurrentSheetBackupExcel({ filePath } = {}) {
  const { workbook, filePath: resolved } = readWorkbook(filePath);
  return analyzeWorkbook(workbook, resolved);
}

async function restoreCurrentSheetBackupExcel({ filePath, confirmText, createBackup = true } = {}) {
  if (clean(confirmText) !== "RESTORE_SHEET") {
    const err = new Error("Type RESTORE_SHEET to confirm current Google Sheet backup restore.");
    err.status = 400;
    throw err;
  }
  return runCurrentSheetRestore(filePath, { apply: true, createBackup: createBackup !== false });
}

module.exports = { analyzeCurrentSheetBackupExcel, restoreCurrentSheetBackupExcel, runCurrentSheetRestore };
