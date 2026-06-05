// server/services/v1ExcelImportService.js
// V1 Google Sheet Excel importer for PocketBase DB Edition.
// Safe flow: analyze first, then import with confirmText IMPORT_V1.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { backupDb } = require("./maintenanceService");

function clean(value) { return String(value ?? "").trim(); }
function toNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function slug(value) { return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function counter() { return { checked: 0, wouldCreate: 0, wouldUpdate: 0, created: 0, updated: 0, skipped: 0, errors: 0 }; }
function bump(summary, name) { if (!summary[name]) summary[name] = counter(); return summary[name]; }

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
    const err = new Error("Excel file not found. Select a valid .xlsx file from Maintenance screen.");
    err.status = 400;
    throw err;
  }
  if (!/\.xlsx?$/i.test(resolved)) {
    const err = new Error("Only .xlsx/.xls V1 Excel backup files are allowed.");
    err.status = 400;
    throw err;
  }
  return { workbook: XLSX.readFile(resolved, { cellDates: false }), filePath: resolved };
}

function rows(workbook, sheetName) {
  const sh = workbook.Sheets[sheetName];
  if (!sh) return [];
  return XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: true });
}

function recordsFromRows(allRows) {
  if (!allRows.length) return [];
  const headers = allRows[0].map(clean);
  return allRows.slice(1).filter(r => r.some(x => clean(x))).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h || `COL_${i + 1}`] = row[i]; });
    return obj;
  });
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

function getStandardMinutesForLogRow(row) {
  const type = clean(row[17] || "Normal").toLowerCase();
  const submittedStd = toNumber(row[20], 0);
  const calculatedStd = toNumber(row[22], 0);
  if (type === "normal") return calculatedStd > 0 ? calculatedStd : submittedStd;
  return submittedStd > 0 && submittedStd < toNumber(row[21], 0) ? submittedStd : 0;
}

function logRowToLine(row, entryNo, lineNo) {
  const workDate = excelDateToYmd(row[1]);
  const category = clean(row[14]) || "Unknown";
  const dept = clean(row[15]) || "Unmapped Department";
  const sub = clean(row[16]) || "Unmapped Sub Work";
  const nature = clean(row[17] || "Normal") || "Normal";
  const std = getStandardMinutesForLogRow(row);
  const actual = toNumber(row[21], 0);
  return {
    entry_no: entryNo,
    line_no: lineNo,
    work_date: workDate,
    work_year: Number(workDate.slice(0, 4)) || new Date().getFullYear(),
    emp_code: clean(row[7]),
    emp_name: clean(row[8]),
    machine_no: clean(row[13]),
    machine_type_code: machineTypeCode(category),
    machine_category: category,
    department_code: slug(dept) || "unmapped_department",
    department_name: dept,
    subwork_code: slug(sub) || "unmapped_sub_work",
    subwork_name: sub,
    work_nature: nature,
    description: clean(row[18]),
    root_area: clean(row[19]),
    standard_minutes: std,
    actual_minutes: actual,
    overrun_minutes: Math.max(0, actual - std),
    efficiency_reason: clean(row[24]) ? `V1 extra time: ${clean(row[24])} min` : "",
    booking_points_json: [],
    quality_points_json: []
  };
}

function machineRowsFromSheet(workbook) {
  const raw = rows(workbook, "Machine_List").filter(r => clean(r[0]) && clean(r[1]));
  return raw.map(r => ({ machineNo: clean(r[0]), category: clean(r[1]) }));
}

function analyzeWorkbook(workbook, filePath) {
  const sheetNames = workbook.SheetNames || [];
  const employeeRows = recordsFromRows(rows(workbook, "EMPLOYEES"));
  const attRows = rows(workbook, "ATT_2026").slice(1).filter(r => clean(r[1]) && clean(r[2]));
  const logRows = rows(workbook, "LOG_2026").slice(1).filter(r => clean(r[1]) && clean(r[7]) && clean(r[2]));
  const stdRows = recordsFromRows(rows(workbook, "Standard_Time"));
  const plannedRows = recordsFromRows(rows(workbook, "Planned_Work"));
  const machines = machineRowsFromSheet(workbook);
  const warnings = [];
  ["EMPLOYEES", "ATT_2026", "LOG_2026", "Standard_Time", "Machine_List"].forEach(s => { if (!sheetNames.includes(s)) warnings.push(`Missing sheet: ${s}`); });
  if (sheetNames.includes("ADMIN")) warnings.push("ADMIN sheet detected and will be ignored by default to protect current DB settings.");
  if (plannedRows.length) warnings.push("Planned_Work will be used for validation/snapshot only, not as live remaining-work source.");

  const dates = [...attRows.map(r => excelDateToYmd(r[1])), ...logRows.map(r => excelDateToYmd(r[1]))].filter(Boolean).sort();
  const typeCount = {};
  logRows.forEach(r => { const t = clean(r[17] || "Normal") || "Normal"; typeCount[t] = (typeCount[t] || 0) + 1; });
  const statusCount = {};
  attRows.forEach(r => { const s = clean(r[6] || "Present") || "Present"; statusCount[s] = (statusCount[s] || 0) + 1; });

  return {
    filePath,
    fileName: path.basename(filePath),
    sheets: sheetNames,
    counts: {
      adminRows: rows(workbook, "ADMIN").length,
      employees: employeeRows.length,
      attendance: attRows.length,
      logRows: logRows.length,
      standardTime: stdRows.length,
      plannedWork: plannedRows.length,
      machineListRows: machines.length,
      uniqueMachines: new Set(machines.map(x => x.machineNo)).size
    },
    dateRange: { from: dates[0] || "", to: dates[dates.length - 1] || "" },
    logTypeCount: typeCount,
    attendanceStatusCount: statusCount,
    machineCategories: Array.from(new Set(machines.map(x => x.category).filter(Boolean))).sort(),
    warnings
  };
}

async function importMasters(workbook, apply, summary) {
  for (const r of recordsFromRows(rows(workbook, "EMPLOYEES"))) {
    const empCode = clean(r["Emp ID"]);
    if (!empCode) continue;
    await upsert("employees", `emp_code="${pbEscape(empCode)}"`, { emp_code: empCode, full_name: clean(r["Emp Name"]), department: "", designation: "", active: r.Active !== false }, apply, bump(summary, "employees"));
  }

  const std = recordsFromRows(rows(workbook, "Standard_Time"));
  const typeMap = new Map(), deptMap = new Map(), subMap = new Map();
  for (const r of std) {
    const category = clean(r["Machine Category"]), dept = clean(r.Department), sub = clean(r["Sub Work"]);
    if (!category || !dept || !sub) continue;
    typeMap.set(machineTypeCode(category), category);
    deptMap.set(slug(dept), dept);
    subMap.set([machineTypeCode(category), slug(dept), slug(sub)].join("|"), { category, dept, sub, std: toNumber(r["Std Time"], 0) });
  }
  for (const m of machineRowsFromSheet(workbook)) typeMap.set(machineTypeCode(m.category), m.category);

  for (const [typeCode, typeName] of typeMap) await upsert("machine_types", `type_code="${pbEscape(typeCode)}"`, { type_code: typeCode, type_name: typeName, active: true }, apply, bump(summary, "machine_types"));
  for (const [deptCode, deptName] of deptMap) await upsert("departments", `department_code="${pbEscape(deptCode)}"`, { department_code: deptCode, department_name: deptName, active: true }, apply, bump(summary, "departments"));
  for (const item of subMap.values()) await upsert("subworks", `machine_type_code="${pbEscape(machineTypeCode(item.category))}" && department_code="${pbEscape(slug(item.dept))}" && subwork_code="${pbEscape(slug(item.sub))}"`, { machine_type_code: machineTypeCode(item.category), department_code: slug(item.dept), subwork_code: slug(item.sub), subwork_name: item.sub, standard_time: item.std, active: true }, apply, bump(summary, "subworks"));

  const machineMap = new Map();
  machineRowsFromSheet(workbook).forEach(m => machineMap.set(m.machineNo, m.category));
  rows(workbook, "LOG_2026").slice(1).forEach(row => { const machineNo = clean(row[13]); const category = clean(row[14]) || "Unknown"; if (machineNo && category && !machineMap.has(machineNo)) machineMap.set(machineNo, category); });
  for (const [machineNo, category] of machineMap) await upsert("machines", `machine_no="${pbEscape(machineNo)}"`, { machine_no: machineNo, machine_type_code: machineTypeCode(category), status: "Active", active: true }, apply, bump(summary, "machines"));

  const shiftMap = new Map();
  rows(workbook, "LOG_2026").slice(1).forEach(row => { const shiftName = clean(row[2]); if (shiftName && !shiftMap.has(shiftName)) shiftMap.set(shiftName, { start: excelTimeToText(row[3]), end: excelTimeToText(row[4]), breakMinutes: toNumber(row[5], 0) }); });
  rows(workbook, "ATT_2026").slice(1).forEach(row => { const shiftName = clean(row[4]); if (shiftName && !shiftMap.has(shiftName)) shiftMap.set(shiftName, { start: "", end: "", breakMinutes: 0 }); });
  for (const [shiftName, s] of shiftMap) {
    const code = slug(shiftName) || shiftName;
    await upsert("shifts", `shift_code="${pbEscape(code)}"`, { shift_code: code, shift_name: shiftName, start_time: s.start, end_time: s.end, break_minutes: s.breakMinutes, flexible: shiftName.toLowerCase().includes("overtime"), active: true }, apply, bump(summary, "shifts"));
  }
}

async function importAttendance(workbook, apply, summary) {
  for (const row of rows(workbook, "ATT_2026").slice(1).filter(r => clean(r[1]) && clean(r[2]))) {
    const workDate = excelDateToYmd(row[1]), shiftName = clean(row[4]), empCode = clean(row[2]), workType = clean(row[5] || "Normal"), shiftCode = slug(shiftName) || shiftName;
    const attKey = [workDate, shiftCode, empCode, slug(workType)].map(x => clean(x).toLowerCase()).join("|");
    await upsert("attendance", `att_key="${pbEscape(attKey)}"`, { att_key: attKey, work_date: workDate, work_year: Number(workDate.slice(0, 4)) || 2026, shift_code: shiftCode, shift_name: shiftName, emp_code: empCode, emp_name: clean(row[3]), work_type: workType, status: clean(row[6] || "Present"), shift_available: toNumber(row[7], 0), utilized_minutes: toNumber(row[8], 0), source_entry_no: `V1-${workDate.replace(/-/g, "")}-${empCode}-${shiftCode}-${slug(workType)}`, remarks: "Imported from V1 ATT_2026" }, apply, bump(summary, "attendance"));
  }
}

function groupLogRows(workbook) {
  const groups = new Map();
  for (const row of rows(workbook, "LOG_2026").slice(1).filter(r => clean(r[1]) && clean(r[7]) && clean(r[2]))) {
    const workDate = excelDateToYmd(row[1]), empCode = clean(row[7]), shiftName = clean(row[2]), workType = clean(row[6] || "Normal");
    const key = [workDate, empCode, shiftName, workType].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

async function importProduction(workbook, apply, summary) {
  for (const [key, groupRows] of groupLogRows(workbook)) {
    const first = groupRows[0];
    const workDate = excelDateToYmd(first[1]), empCode = clean(first[7]), empName = clean(first[8]), shiftName = clean(first[2]), workType = clean(first[6] || "Normal"), shiftCode = slug(shiftName) || shiftName;
    const entryNo = `V1-${workDate.replace(/-/g, "")}-${empCode}-${shiftCode}-${slug(workType)}`;
    const productionCounter = bump(summary, "production_entries");
    const existing = await findOne("production_entries", `entry_no="${pbEscape(entryNo)}"`).catch(() => null);
    if (existing?.id) { productionCounter.skipped += 1; continue; }
    const lines = groupRows.map((row, i) => logRowToLine(row, entryNo, i + 1));
    const totalStd = lines.reduce((s, x) => s + toNumber(x.standard_minutes, 0), 0), totalActual = lines.reduce((s, x) => s + toNumber(x.actual_minutes, 0), 0), shiftAvailable = toNumber(first[9], 0);
    await createIfMissing("production_entries", `entry_no="${pbEscape(entryNo)}"`, { entry_no: entryNo, work_date: workDate, work_year: Number(workDate.slice(0, 4)) || 2026, shift_code: shiftCode, shift_name: shiftName, shift_start: excelTimeToText(first[3]), shift_end: excelTimeToText(first[4]), break_minutes: toNumber(first[5], 0), flexible_shift_minutes: 0, work_type: workType, emp_code: empCode, emp_name: empName, gross_shift_available: shiftAvailable, major_loss_reason: "", major_loss_minutes: 0, shift_available: shiftAvailable, total_standard_minutes: totalStd, total_actual_minutes: totalActual, remaining_minutes: Math.max(0, shiftAvailable - totalActual), productivity_percent: shiftAvailable > 0 ? Number(((totalStd / shiftAvailable) * 100).toFixed(2)) : toNumber(first[12], 0), source: "v1-excel-import", status: "SUBMITTED", remarks: "Imported from V1 LOG_2026" }, apply, productionCounter);
    const lineCounter = bump(summary, "production_entry_lines");
    for (const line of lines) {
      try { await createIfMissing("production_entry_lines", `entry_no="${pbEscape(line.entry_no)}" && line_no=${line.line_no}`, line, apply, lineCounter); }
      catch (err) { lineCounter.errors += 1; lineCounter.skipped += 1; }
    }
  }
}

async function runV1Import(filePath, { apply = false, createBackup = false } = {}) {
  const { workbook, filePath: resolved } = readWorkbook(filePath);
  const analysis = analyzeWorkbook(workbook, resolved);
  const summary = {};
  let backup = null;
  if (apply && createBackup) backup = await backupDb({ includeMaster: true, includeTransactions: true, reason: "Before V1 Excel import" });
  await importMasters(workbook, apply, summary);
  await importAttendance(workbook, apply, summary);
  await importProduction(workbook, apply, summary);
  return { analysis, summary, backup, mode: apply ? "APPLY" : "DRY_RUN" };
}

function analyzeV1ExcelFile({ filePath } = {}) {
  const { workbook, filePath: resolved } = readWorkbook(filePath);
  return analyzeWorkbook(workbook, resolved);
}

async function importV1ExcelFile({ filePath, confirmText, createBackup = true } = {}) {
  if (clean(confirmText) !== "IMPORT_V1") {
    const err = new Error("Type IMPORT_V1 to confirm V1 Excel import.");
    err.status = 400;
    throw err;
  }
  return runV1Import(filePath, { apply: true, createBackup: createBackup !== false });
}

module.exports = { analyzeV1ExcelFile, importV1ExcelFile, runV1Import };
