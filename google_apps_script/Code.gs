// ===== SP WorkTrack Web App (Google Apps Script) =====
// Core:
// 1) LOG_YYYY (work log)
// 2) ATT_YYYY (attendance)
// 3) Admin stored in sheet "ADMIN" cell A2 (JSON)
// 4) Dashboard feed: MACHINE_PLAN_DEPT + LOG_YYYY => DASHBOARD_FEED
// Action: "getDashboardFeed"

const SECRET = "DIGAMBAR"; // MUST MATCH renderer/config.js

// ==================== WEB APP ====================

function doGet(e) {
  return ContentService
    .createTextOutput("SP WorkTrack Web App is running ✅ (GET OK)")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : "";
    const body = raw ? JSON.parse(raw) : {};

    // security check
    if (!body.secret || body.secret !== SECRET) {
      return json_({ ok: false, error: "Unauthorized (bad secret)" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = String(body.action || "submitWork");

    // ✅ DASHBOARD FEED ROUTE
    if (action === "getDashboardFeed") {
      const yyyy = String(body.year || new Date().getFullYear());
      const build = buildDashboardFeedDynamic_(yyyy);
      const feed = ss.getSheetByName("DASHBOARD_FEED");
      const vals = feed ? feed.getDataRange().getValues() : [];
      return json_({ ok: true, source: "live", build, table: vals });
    }

    // ===================== WORK SUBMIT ROUTE =====================
    if (!body.workDate || !body.shiftName || !body.teamMemberId) {
      return json_({ ok: false, error: "Missing required fields: workDate / shiftName / teamMemberId" });
    }

    const yyyy = getYear_(body.workDate);

    // Work sheet: LOG_YYYY
    const workSheetName = "LOG_" + yyyy;
    let workSh = ss.getSheetByName(workSheetName);
    if (!workSh) {
      workSh = ss.insertSheet(workSheetName);
      writeWorkHeader_(workSh);
    } else {
      // If someone edited header manually, keep it consistent
      ensureWorkHeaderUpgraded_(workSh);
    }

    // Attendance sheet: ATT_YYYY
    const attSheetName = "ATT_" + yyyy;
    let attSh = ss.getSheetByName(attSheetName);
    if (!attSh) {
      attSh = ss.insertSheet(attSheetName);
      writeAttendanceHeader_(attSh);
    }

    // DUPLICATE PREVENTION (Emp + Date + Shift)
    if (hasDuplicateInWorkSheet_(workSh, body.workDate, body.teamMemberId, body.shiftName)) {
      return json_({
        ok: false,
        error: `Duplicate blocked: ${body.teamMemberId} already submitted for ${normalizeWorkDate_(body.workDate)} (${body.shiftName}).`
      });
    }

    // ✅ Snapshot machine plan on FIRST entry for that machine
 
    ensureMachinePlanSnapshotOnFirstEntry_(ss, body);

    // ---------- Save Work Rows ----------
    const works = Array.isArray(body.works) ? body.works : [];
    const rows = works.map(w => ([
      new Date(),                                      // Timestamp
      normalizeWorkDate_(body.workDate),               // Work Date
      String(body.shiftName || ""),                    // Shift
      String(body.shiftStart || ""),                   // Shift Start
      String(body.shiftEnd || ""),                     // Shift End
      Number(body.breakMinutes || 0),                  // Break Minutes
      String(body.workType || ""),                     // Work Type (Normal/Overtime)
      String(body.teamMemberId || ""),                 // Emp ID
      String(body.teamMemberName || ""),               // Emp Name
      Number(body.summary?.shiftAvailable || 0),       // Shift Available (min)
      Number(body.summary?.utilized || 0),             // Utilized (min)
      Number(body.summary?.remaining || 0),            // Remaining (min)
      Number(body.summary?.productivity || 0),         // Productivity %
      String(w.machine || ""),                         // Machine
      String(w.machineCategory || ""),                 // Machine Category (display name)
      String(w.department || ""),                      // Department
      String(w.subWork || ""),                         // Sub Work
      String(w.type || "Normal"),                      // Type
      String(w.description || ""),                     // Description
      String(w.rootArea || ""),                        // Root Area
      Number(w.standardTime || 0),                     // Standard Time
      Number(w.actualTime || 0)                        // Actual Time
    ]));

    if (rows.length > 0) {
      workSh.getRange(workSh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    // ---------- Attendance UPSERT ----------
    const utilizedMin = Number(body.summary?.utilized || 0);
    const shiftAvailableMin = Number(body.summary?.shiftAvailable || 0);
    const workTypeTop = String(body.workType || "");

    const isOvertime =
      norm_(body.shiftName).indexOf("overtime") >= 0 ||
      norm_(workTypeTop) === "overtime";

    const overtimeMin = isOvertime ? utilizedMin : 0;

    upsertAttendance_(
      attSh,
      normalizeWorkDate_(body.workDate),
      String(body.teamMemberId || ""),
      String(body.teamMemberName || ""),
      String(body.shiftName || ""),
      workTypeTop,
      utilizedMin,
      overtimeMin,
      shiftAvailableMin,
      Number(body.summary?.productivity || 0)
    );

    // ✅ Rebuild DASHBOARD_FEED after each submit
    buildDashboardFeedDynamic_(String(yyyy));

    return json_({
      ok: true,
      workSheet: workSheetName,
      attendanceSheet: attSheetName,
      savedRows: rows.length
    });

  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ==================== ADMIN STORAGE (Sheet) ====================

function getAdminSheet_(ss) {
  let sh = ss.getSheetByName("ADMIN");
  if (!sh) {
    sh = ss.insertSheet("ADMIN");
    sh.getRange("A1").setValue("adminOverridesJSON");
    sh.getRange("A2").setValue(JSON.stringify({ admin: { pin: "1234" } }, null, 2));
    sh.setFrozenRows(1);
  }
  return sh;
}

function getAdminOverrides_(ss) {
  const sh = getAdminSheet_(ss);
  const raw = String(sh.getRange("A2").getValue() || "{}");
  let obj = {};
  try { obj = JSON.parse(raw); } catch (e) { obj = {}; }
  obj.admin = obj.admin || {};
  obj.admin.pin = String(obj.admin.pin || "1234");
  obj.mainWorks = Array.isArray(obj.mainWorks) ? obj.mainWorks : [];
  obj.subWorks = (obj.subWorks && typeof obj.subWorks === "object") ? obj.subWorks : {};
  obj.machineTypes = Array.isArray(obj.machineTypes) ? obj.machineTypes : [];
  obj.workCatalogByType = (obj.workCatalogByType && typeof obj.workCatalogByType === "object") ? obj.workCatalogByType : {};
  return obj;
}

// ==================== DUPLICATE CHECK ====================

function hasDuplicateInWorkSheet_(sh, workDate, empId, shiftName) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  const data = sh.getRange(2, 1, lastRow - 1, 8).getValues();

  const wd = normalizeWorkDate_(workDate).toLowerCase();
  const eid = norm_(empId);
  const sn = norm_(shiftName);

  for (let i = 0; i < data.length; i++) {
    const rowWorkDate = normalizeWorkDate_(data[i][1]).toLowerCase(); // col 2
    const rowShift = norm_(data[i][2]);                               // col 3
    const rowEmpId = norm_(data[i][7]);                               // col 8
    if (rowWorkDate === wd && rowShift === sn && rowEmpId === eid) return true;
  }
  return false;
}

// ==================== ATTENDANCE UPSERT ====================

function upsertAttendance_(attSh, workDate, empId, empName, shiftName, workType, utilizedMin, overtimeMin, shiftAvailMin, productivity) {
  const lastRow = attSh.getLastRow();

  const keyDate = normalizeWorkDate_(workDate);
  const keyEmp = String(empId || "").trim();
  const keyShift = String(shiftName || "").trim();

  let foundRow = -1;

  if (lastRow >= 2) {
    const data = attSh.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let i = 0; i < data.length; i++) {
      const rowDate = normalizeWorkDate_(data[i][1]);
      const rowEmp = String(data[i][2] || "").trim();
      const rowShift = String(data[i][4] || "").trim();
      if (rowDate === keyDate && rowEmp === keyEmp && rowShift === keyShift) {
        foundRow = i + 2;
        break;
      }
    }
  }

  const status = utilizedMin > 0 ? "Present" : "Absent";
  const totalHours = (utilizedMin / 60).toFixed(2);
  const otHours = (overtimeMin / 60).toFixed(2);

  const rowValues = [[
    new Date(),
    keyDate,
    keyEmp,
    empName || "",
    keyShift,
    workType || "",
    status,
    shiftAvailMin || 0,
    utilizedMin || 0,
    totalHours,
    overtimeMin || 0,
    otHours,
    productivity || 0
  ]];

  if (foundRow > 0) {
    attSh.getRange(foundRow, 1, 1, rowValues[0].length).setValues(rowValues);
  } else {
    attSh.getRange(attSh.getLastRow() + 1, 1, 1, rowValues[0].length).setValues(rowValues);
  }
}

// ==================== HEADERS ====================

function writeWorkHeader_(sh) {
  const headers = [
    "Timestamp","Work Date","Shift","Shift Start","Shift End","Break Minutes","Work Type",
    "Emp ID","Emp Name","Shift Available","Utilized","Remaining","Productivity %",
    "Machine","Machine Category","Department","Sub Work","Type","Description","Root Area",
    "Standard Time","Actual Time"
  ];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
}

function ensureWorkHeaderUpgraded_(sh) {
  // Keep your older sheets compatible: ensure "Machine Category" exists
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || "").trim());

  if (headers.indexOf("Machine Category") >= 0) return;

  const machineIdx = headers.indexOf("Machine");
  if (machineIdx < 0) return;

  sh.insertColumnAfter(machineIdx + 1);
  sh.getRange(1, machineIdx + 2).setValue("Machine Category");
}

function writeAttendanceHeader_(sh) {
  const headers = [
    "Timestamp","Work Date","Emp ID","Emp Name","Shift","Work Type","Status",
    "Shift Available (min)","Utilized (min)","Total Hours","OT Minutes","OT Hours","Productivity %"
  ];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
}

// ==================== UTILITIES ====================

function norm_(v) { return String(v == null ? "" : v).trim().toLowerCase(); }

function normalizeWorkDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return s;
}

function getYear_(dateStr) {
  const wd = normalizeWorkDate_(dateStr);
  const parts = wd.split("-");
  if (parts.length === 3) return parts[0];
  return String(new Date(dateStr).getFullYear());
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================== DASHBOARD V2 =====================
// MACHINE_PLAN_DEPT: MachineName | Type | StartDate | Department | Std_Min
// DASHBOARD_FEED: MachineName | Type | StartDate | Std_Total_Min | Consumed_Total_Min | Remaining_Total_Min | Overrun_Total_Min | DeptJSON

function ensureMachinePlanDept_(ss) {
  let sh = ss.getSheetByName("MACHINE_PLAN_DEPT");
  if (!sh) {
    sh = ss.insertSheet("MACHINE_PLAN_DEPT");
    sh.getRange(1, 1, 1, 5).setValues([["MachineName","Type","StartDate","Department","Std_Min"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureDashboardFeed_(ss) {
  let sh = ss.getSheetByName("DASHBOARD_FEED");
  if (!sh) sh = ss.insertSheet("DASHBOARD_FEED");

  const headers = [
    "MachineName","Type","StartDate",
    "Std_Total_Min","Consumed_Total_Min","Remaining_Total_Min","Overrun_Total_Min",
    "DeptJSON"
  ];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  return sh;
}

// ✅ Snapshot/UPSERT machine plan (Machine + Dept) from ADMIN catalog
// - Creates missing department rows if not present
// - Avoids duplicates even if machine name has minor mismatch (trim/lower)
function ensureMachinePlanSnapshotOnFirstEntry_(ss, body) {
  const works = Array.isArray(body.works) ? body.works : [];
  if (!works.length) return;

  const first = works[0];
  const machineName = String(first.machine || "").trim();
  const typeId = String(first.machineTypeId || "").trim();        // from payload
  const typeName = String(first.machineCategory || "").trim();    // display name
  const startDate = normalizeWorkDate_(body.workDate);

  if (!machineName || !typeId) return;

  const planSh = ensureMachinePlanDept_(ss);
  const admin = getAdminOverrides_(ss);

  const catalog = (admin?.workCatalogByType && admin.workCatalogByType[typeId])
    ? admin.workCatalogByType[typeId]
    : null;

  const deptList =
    Array.isArray(catalog?.mainWorks) ? catalog.mainWorks :
    Array.isArray(admin?.mainWorks) ? admin.mainWorks :
    [];

  if (!deptList.length) return;

  // ---- Read existing plan rows for this machine ----
  const last = planSh.getLastRow();
  const existingDeptSet = {};  // deptNameLower -> true
  const existingRows = [];     // { rowNum, machineNorm, deptNorm }

  if (last >= 2) {
    const data = planSh.getRange(2, 1, last - 1, 5).getValues();
    data.forEach((r, i) => {
      const m = String(r[0] || "").trim();
      const d = String(r[3] || "").trim();
      const mNorm = m.toLowerCase();
      const dNorm = d.toLowerCase();
      existingRows.push({ rowNum: i + 2, mNorm, dNorm });

      if (mNorm === machineName.toLowerCase() && dNorm) {
        existingDeptSet[dNorm] = true;
      }
    });
  }

  // ---- Build missing dept rows only ----
  const outRows = [];
  deptList.forEach(dep => {
    const depName = String(dep || "").trim();
    if (!depName) return;

    const depNorm = depName.toLowerCase();
    if (existingDeptSet[depNorm]) return; // already exists -> skip

    const std =
      sumStdFromSubWorks_(catalog?.subWorks?.[depName]) ||
      sumStdFromSubWorks_(admin?.subWorks?.[depName]) ||
      0;

    outRows.push([machineName, typeName, startDate, depName, std]);
  });

  if (outRows.length) {
    planSh.getRange(planSh.getLastRow() + 1, 1, outRows.length, 5).setValues(outRows);
  }
}

function sumStdFromSubWorks_(arr) {
  if (!Array.isArray(arr)) return 0;
  let sum = 0;
  arr.forEach(it => {
    const v = Number(it?.standardTime ?? it?.stdMin ?? it?.std ?? 0) || 0;
    sum += v;
  });
  return sum;
}

// ✅ Build DASHBOARD_FEED from MACHINE_PLAN_DEPT + LOG_YYYY
function buildDashboardFeedDynamic_(yyyy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const planSh = ensureMachinePlanDept_(ss);
  const feedSh = ensureDashboardFeed_(ss);

  // Read MACHINE_PLAN_DEPT
  const planLast = planSh.getLastRow();
  const planData = planLast >= 2 ? planSh.getRange(2, 1, planLast - 1, 5).getValues() : [];

  // planMap: machine -> {type,startDate,deptStd}
  const planMap = {};
  planData.forEach(r => {
    const machine = String(r[0] || "").trim();
    if (!machine) return;
    const type = String(r[1] || "").trim();
    const startDate = normalizeWorkDate_(r[2]);
    const dept = String(r[3] || "").trim();
    const std = Number(r[4] || 0) || 0;

    planMap[machine] = planMap[machine] || { machine, type, startDate, deptStd: {} };
    if (type) planMap[machine].type = type;
    if (startDate) planMap[machine].startDate = startDate;
    const prev = Number(planMap[machine].deptStd[dept] || 0) || 0;
// If duplicates exist, keep the MAX (prevents doubling)
planMap[machine].deptStd[dept] = Math.max(prev, std);
  });

  const logName = "LOG_" + yyyy;
  const logSh = ss.getSheetByName(logName);

  // If no LOG yet, still show plan-only rows (Consumed=0)
  if (!logSh) {
    const outNoLog = buildFeedFromPlanOnly_(planMap);
    if (outNoLog.length) feedSh.getRange(2, 1, outNoLog.length, outNoLog[0].length).setValues(outNoLog);
    return { ok: true, machines: outNoLog.length, note: "No LOG sheet yet. Showing plan only." };
  }

  const logLast = logSh.getLastRow();
  if (logLast < 2) {
    const outNoRows = buildFeedFromPlanOnly_(planMap);
    if (outNoRows.length) feedSh.getRange(2, 1, outNoRows.length, outNoRows[0].length).setValues(outNoRows);
    return { ok: true, machines: outNoRows.length, note: "No log rows yet. Showing plan only." };
  }

  const logHeaders = logSh.getRange(1, 1, 1, logSh.getLastColumn()).getValues()[0].map(v => String(v || "").trim());
  const idxMachine = logHeaders.indexOf("Machine");
  const idxDept = logHeaders.indexOf("Department");
  const idxActual = logHeaders.indexOf("Actual Time");

  if (idxMachine < 0 || idxDept < 0 || idxActual < 0) {
    throw new Error("LOG header missing: Machine / Department / Actual Time");
  }

  const logData = logSh.getRange(2, 1, logLast - 1, logSh.getLastColumn()).getValues();
  const consumedMap = {}; // machine -> dept -> actual

  logData.forEach(r => {
    const machine = String(r[idxMachine] || "").trim();
    const dept = String(r[idxDept] || "").trim();
    const actual = Number(r[idxActual] || 0) || 0;
    if (!machine || !dept || actual <= 0) return;

    consumedMap[machine] = consumedMap[machine] || {};
    consumedMap[machine][dept] = (consumedMap[machine][dept] || 0) + actual;
  });

  // Build feed rows
  const out = [];
  Object.keys(planMap).forEach(machine => {
    const p = planMap[machine];
    const deptStd = p.deptStd || {};
    const deptConsumed = consumedMap[machine] || {};

    const depts = {};
    Object.keys(deptStd).forEach(d => depts[d] = true);
    Object.keys(deptConsumed).forEach(d => depts[d] = true);

    let stdTotal = 0, consTotal = 0, remTotal = 0, ovTotal = 0;
    const deptJSON = {};

    Object.keys(depts).forEach(d => {
      const s = Number(deptStd[d] || 0) || 0;
      const c = Number(deptConsumed[d] || 0) || 0;

      const rem = Math.max(0, s - c);
      const ov = Math.max(0, c - s);

      deptJSON[d] = { std: s, cons: c, rem: rem, ov: ov };

      stdTotal += s;
      consTotal += c;
      remTotal += rem;
      ovTotal += ov;
    });

    out.push([
      machine,
      p.type || "",
      p.startDate || "",
      stdTotal,
      consTotal,
      remTotal,
      ovTotal,
      JSON.stringify(deptJSON)
    ]);
  });

  if (out.length > 0) {
    feedSh.getRange(2, 1, out.length, out[0].length).setValues(out);
  }

  return { ok: true, machines: out.length };
}

function buildFeedFromPlanOnly_(planMap) {
  const out = [];
  Object.keys(planMap).forEach(machine => {
    const p = planMap[machine];
    const deptStd = p.deptStd || {};

    let stdTotal = 0;
    const deptJSON = {};

    Object.keys(deptStd).forEach(d => {
      const s = Number(deptStd[d] || 0) || 0;
      stdTotal += s;
      deptJSON[d] = { std: s, cons: 0, rem: s, ov: 0 };
    });

    out.push([
      machine,
      p.type || "",
      p.startDate || "",
      stdTotal,
      0,
      stdTotal,
      0,
      JSON.stringify(deptJSON)
    ]);
  });
  return out;
}

// Manual run if needed
function rebuildDashboardNow() {
  const yyyy = String(new Date().getFullYear());
  Logger.log(buildDashboardFeedDynamic_(yyyy));
}