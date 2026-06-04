// server/scripts/importV1SheetToDb.js
// One-time migration from SP WorkTrack V1 Excel export to PocketBase DB.
// Usage:
//   npm install
//   npm run import:v1 -- "C:\\path\\SPWT_V1.xlsx" --dry-run
//   npm run import:v1 -- "C:\\path\\SPWT_V1.xlsx" --apply

require("dotenv").config();

const path = require("path");
const XLSX = require("xlsx");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const TRANSACTION_COLLECTIONS = ["production_entries", "production_entry_lines", "attendance"];

function clean(value) { return String(value ?? "").trim(); }
function toNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function pbEscape(value) { return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function slug(value) { return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
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

async function listAll(collectionName, filter = "") {
  const out = [];
  let page = 1;
  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: { page, perPage: 500, filter }
    });
    const items = Array.isArray(result.items) ? result.items : [];
    out.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return out;
}

async function findOne(collectionName, filter) {
  const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
    method: "GET",
    query: { page: 1, perPage: 1, filter }
  });
  return Array.isArray(result.items) ? result.items[0] || null : null;
}

async function upsert(collectionName, filter, body, apply, counters) {
  counters.checked += 1;
  const existing = await findOne(collectionName, filter).catch(() => null);
  if (!apply) {
    existing ? counters.wouldUpdate++ : counters.wouldCreate++;
    return existing || body;
  }
  if (existing?.id) {
    counters.updated += 1;
    return pocketBaseRequest(`/api/collections/${collectionName}/records/${existing.id}`, { method: "PATCH", body });
  }
  counters.created += 1;
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "POST", body });
}

async function create(collectionName, body, apply, counters) {
  counters.checked += 1;
  if (!apply) { counters.wouldCreate += 1; return body; }
  counters.created += 1;
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, { method: "POST", body });
}

function counter() { return { checked: 0, wouldCreate: 0, wouldUpdate: 0, created: 0, updated: 0, skipped: 0 }; }
function bump(summary, name) { if (!summary[name]) summary[name] = counter(); return summary[name]; }

function parseAdminJson(adminRows) {
  try { return JSON.parse(clean(adminRows?.[1]?.[0] || "{}")); } catch (err) { return {}; }
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
    department_code: slug(dept),
    department_name: dept,
    subwork_code: slug(sub),
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

async function importMasters(wb, apply, summary) {
  const emp = recordsFromRows(rows(wb, "EMPLOYEES"));
  for (const r of emp) {
    const empCode = clean(r["Emp ID"]);
    if (!empCode) continue;
    await upsert("employees", `emp_code=\"${pbEscape(empCode)}\"`, {
      emp_code: empCode,
      full_name: clean(r["Emp Name"]),
      department: "",
      designation: "",
      active: r.Active !== false
    }, apply, bump(summary, "employees"));
  }

  const std = recordsFromRows(rows(wb, "Standard_Time"));
  const typeMap = new Map();
  const deptMap = new Map();
  const subMap = new Map();
  for (const r of std) {
    const category = clean(r["Machine Category"]);
    const dept = clean(r.Department);
    const sub = clean(r["Sub Work"]);
    if (!category || !dept || !sub) continue;
    typeMap.set(machineTypeCode(category), category);
    deptMap.set(slug(dept), dept);
    subMap.set([machineTypeCode(category), slug(dept), slug(sub)].join("|"), { category, dept, sub, std: toNumber(r["Std Time"], 0) });
  }

  for (const [typeCode, typeName] of typeMap) {
    await upsert("machine_types", `type_code=\"${pbEscape(typeCode)}\"`, { type_code: typeCode, type_name: typeName, active: true }, apply, bump(summary, "machine_types"));
  }
  for (const [deptCode, deptName] of deptMap) {
    await upsert("departments", `department_code=\"${pbEscape(deptCode)}\"`, { department_code: deptCode, department_name: deptName, active: true }, apply, bump(summary, "departments"));
  }
  for (const item of subMap.values()) {
    await upsert("subworks", `machine_type_code=\"${pbEscape(machineTypeCode(item.category))}\" && department_code=\"${pbEscape(slug(item.dept))}\" && subwork_code=\"${pbEscape(slug(item.sub))}\"`, {
      machine_type_code: machineTypeCode(item.category),
      department_code: slug(item.dept),
      subwork_code: slug(item.sub),
      subwork_name: item.sub,
      standard_time: item.std,
      active: true
    }, apply, bump(summary, "subworks"));
  }

  const machineRows = recordsFromRows(rows(wb, "Planned_Work"));
  const machineMap = new Map();
  for (const r of machineRows) {
    const machineNo = clean(r["Machine No"]);
    const category = clean(r["Machine Category"]);
    if (machineNo && category) machineMap.set(machineNo, category);
  }
  const logRows = rows(wb, "LOG_2026").slice(1);
  for (const row of logRows) {
    const machineNo = clean(row[13]);
    const category = clean(row[14]) || "Unknown";
    if (machineNo && category && !machineMap.has(machineNo)) machineMap.set(machineNo, category);
  }
  for (const [machineNo, category] of machineMap) {
    await upsert("machines", `machine_no=\"${pbEscape(machineNo)}\"`, {
      machine_no: machineNo,
      machine_type_code: machineTypeCode(category),
      status: "Active",
      active: true
    }, apply, bump(summary, "machines"));
  }

  const shiftMap = new Map();
  for (const row of logRows) {
    const shiftName = clean(row[2]);
    if (!shiftName || shiftMap.has(shiftName)) continue;
    shiftMap.set(shiftName, { start: excelTimeToText(row[3]), end: excelTimeToText(row[4]), breakMinutes: toNumber(row[5], 0) });
  }
  for (const [shiftName, s] of shiftMap) {
    const code = slug(shiftName) || shiftName;
    await upsert("shifts", `shift_code=\"${pbEscape(code)}\"`, {
      shift_code: code,
      shift_name: shiftName,
      start_time: s.start,
      end_time: s.end,
      break_minutes: s.breakMinutes,
      flexible: shiftName.toLowerCase().includes("overtime"),
      active: true
    }, apply, bump(summary, "shifts"));
  }
}

async function importAttendance(wb, apply, summary) {
  const attRows = rows(wb, "ATT_2026").slice(1).filter(r => clean(r[1]) && clean(r[2]));
  for (const row of attRows) {
    const workDate = excelDateToYmd(row[1]);
    const shiftName = clean(row[4]);
    const empCode = clean(row[2]);
    const shiftCode = slug(shiftName) || shiftName;
    const attKey = [workDate, shiftCode, empCode].map(x => clean(x).toLowerCase()).join("|");
    await upsert("attendance", `att_key=\"${pbEscape(attKey)}\"`, {
      att_key: attKey,
      work_date: workDate,
      work_year: Number(workDate.slice(0, 4)) || 2026,
      shift_code: shiftCode,
      shift_name: shiftName,
      emp_code: empCode,
      emp_name: clean(row[3]),
      status: clean(row[6] || "Present"),
      shift_available: toNumber(row[7], 0),
      utilized_minutes: toNumber(row[8], 0),
      source_entry_no: `V1-${workDate.replace(/-/g, "")}-${empCode}-${shiftCode}`,
      remarks: "Imported from V1 ATT_2026"
    }, apply, bump(summary, "attendance"));
  }
}

function groupLogRows(wb) {
  const data = rows(wb, "LOG_2026").slice(1).filter(r => clean(r[1]) && clean(r[7]) && clean(r[2]));
  const groups = new Map();
  for (const row of data) {
    const workDate = excelDateToYmd(row[1]);
    const empCode = clean(row[7]);
    const shiftName = clean(row[2]);
    const key = [workDate, empCode, shiftName].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

async function importProduction(wb, apply, summary) {
  const groups = groupLogRows(wb);
  for (const [key, groupRows] of groups) {
    const first = groupRows[0];
    const workDate = excelDateToYmd(first[1]);
    const empCode = clean(first[7]);
    const empName = clean(first[8]);
    const shiftName = clean(first[2]);
    const shiftCode = slug(shiftName) || shiftName;
    const entryNo = `V1-${workDate.replace(/-/g, "")}-${empCode}-${shiftCode}`;
    const lines = groupRows.map((row, i) => logRowToLine(row, entryNo, i + 1));
    const totalStd = lines.reduce((s, x) => s + toNumber(x.standard_minutes, 0), 0);
    const totalActual = lines.reduce((s, x) => s + toNumber(x.actual_minutes, 0), 0);
    const shiftAvailable = toNumber(first[9], 0);

    const existing = await findOne("production_entries", `entry_no=\"${pbEscape(entryNo)}\"`).catch(() => null);
    const productionCounter = bump(summary, "production_entries");
    if (existing?.id) { productionCounter.skipped += 1; continue; }

    await create("production_entries", {
      entry_no: entryNo,
      work_date: workDate,
      work_year: Number(workDate.slice(0, 4)) || 2026,
      shift_code: shiftCode,
      shift_name: shiftName,
      shift_start: excelTimeToText(first[3]),
      shift_end: excelTimeToText(first[4]),
      break_minutes: toNumber(first[5], 0),
      flexible_shift_minutes: 0,
      work_type: clean(first[6] || "Normal"),
      emp_code: empCode,
      emp_name: empName,
      gross_shift_available: shiftAvailable,
      major_loss_reason: "",
      major_loss_minutes: 0,
      shift_available: shiftAvailable,
      total_standard_minutes: totalStd,
      total_actual_minutes: totalActual,
      remaining_minutes: Math.max(0, shiftAvailable - totalActual),
      productivity_percent: shiftAvailable > 0 ? Number(((totalStd / shiftAvailable) * 100).toFixed(2)) : toNumber(first[12], 0),
      source: "v1-excel-import",
      status: "SUBMITTED",
      remarks: "Imported from V1 LOG_2026"
    }, apply, productionCounter);

    const lineCounter = bump(summary, "production_entry_lines");
    for (const line of lines) {
  try {
    if (!clean(line.subwork_name)) {
      line.subwork_name = "Unmapped Sub Work";
      line.subwork_code = "unmapped_sub_work";
    }
    if (!clean(line.department_name)) {
      line.department_name = "Unmapped Department";
      line.department_code = "unmapped_department";
    }
    if (!clean(line.machine_category)) {
      line.machine_category = "Unknown";
      line.machine_type_code = "Unknown";
    }
    await create("production_entry_lines", line, apply, lineCounter);
  } catch (err) {
    lineCounter.skipped += 1;
    console.warn("Skipped V1 production line:", {
      entry_no: line.entry_no,
      line_no: line.line_no,
      machine_no: line.machine_no,
      department_name: line.department_name,
      subwork_name: line.subwork_name,
      reason: err.message,
      details: err.details || null
    });
  }
}
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(a => !a.startsWith("--"));
  const apply = args.includes("--apply");
  if (!fileArg) {
    console.error('Missing Excel file path. Example: npm run import:v1 -- "C:\\Temp\\spwt-v1.xlsx" --dry-run');
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const summary = {};
  console.log(`V1 import source: ${filePath}`);
  console.log(apply ? "MODE: APPLY - DB will be changed" : "MODE: DRY RUN - DB will not be changed");

  await importMasters(workbook, apply, summary);
  await importAttendance(workbook, apply, summary);
  await importProduction(workbook, apply, summary);

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) console.log("Dry run complete. Re-run with --apply to import into DB.");
}

main().catch((err) => {
  console.error("V1 import failed:", err);
  process.exit(1);
});

