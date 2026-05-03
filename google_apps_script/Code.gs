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

// ✅ SAVE ADMIN FROM APP TO GOOGLE SHEET ADMIN A2
if (action === "saveAdminOverrides") {
  if (!body.adminOverrides) {
    return json_({ ok: false, error: "Missing adminOverrides payload" });
  }

  const sh = getAdminSheet_(ss);
  sh.getRange("A2").setValue(JSON.stringify(body.adminOverrides || {}, null, 2));

  rebuildStandardTimeMaster_(ss);

  return json_({ ok: true, message: "Admin overrides saved to Google Sheet" });
}

// ✅ DASHBOARD FEED ROUTE
    // ✅ SAVE ADMIN FROM APP TO GOOGLE SHEET ADMIN A2
if (action === "saveAdminOverrides") {
  if (!body.adminOverrides) {
    return json_({ ok: false, error: "Missing adminOverrides payload" });
  }

  const sh = getAdminSheet_(ss);
  sh.getRange("A2").setValue(JSON.stringify(body.adminOverrides || {}, null, 2));

  rebuildStandardTimeMaster_(ss);

  rebuildEmployeesMaster_(ss);

  return json_({ ok: true, message: "Admin overrides saved to Google Sheet" });
}

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

// ===================== DASHBOARD V3 =====================
// STANDARD_TIME: Machine Category | Department | Sub Work | Std Time
// MACHINE_LIST: Machine No | Machine Category
// PLANNED_WORK: Machine No | Machine Category | Department | Sub Work | Std Time | Actual Time | Remaining Time
// DASHBOARD_FEED: machine-wise summary for Electron dashboard

function ensureSheetHeader_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  const first = String(sh.getRange(1, 1).getValue() || "").trim();
  if (!first) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    map[String(h || "").trim().toLowerCase()] = i;
  });
  return map;
}

function clean_(v) {
  return String(v == null ? "" : v).trim();
}

function key_(v) {
  return clean_(v).toLowerCase();
}

function makeKey_(arr) {
  return arr.map(key_).join("||");
}

// Keep old doPost call safe
function ensureMachinePlanSnapshotOnFirstEntry_(ss, body) {
  // V3 uses STANDARD_TIME + MACHINE_LIST + PLANNED_WORK.
  // Nothing needed here.
}

// ---------- 1) STANDARD_TIME from ADMIN ----------
function rebuildStandardTimeMaster_(ss) {
  const sh = ensureSheetHeader_(ss, "STANDARD_TIME", [
    "Machine Category", "Department", "Sub Work", "Std Time"
  ]);

  const admin = getAdminOverrides_(ss);
  const rows = [];

  const types = Array.isArray(admin.machineTypes) ? admin.machineTypes : [];
  const typeNameById = {};
  types.forEach(t => {
    typeNameById[clean_(t.id)] = clean_(t.name);
  });

  const catalogByType = admin.workCatalogByType || {};

  Object.keys(catalogByType).forEach(typeId => {
    const catalog = catalogByType[typeId] || {};
    const categoryName = typeNameById[typeId] || typeId;

    const mainWorks = Array.isArray(catalog.mainWorks) ? catalog.mainWorks : [];
    const subWorks = catalog.subWorks || {};

    mainWorks.forEach(dept => {
      const depName = clean_(dept);
      const items = Array.isArray(subWorks[depName]) ? subWorks[depName] : [];

      items.forEach(it => {
        const sub = clean_(it.name);
        const std = Number(it.standardTime || 0) || 0;
        if (!categoryName || !depName || !sub) return;
        rows.push([categoryName, depName, sub, std]);
      });
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, 4).setValues([[
    "Machine Category", "Department", "Sub Work", "Std Time"
  ]]);
  sh.setFrozenRows(1);

  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  return rows;
}

// ---------- 2) MACHINE_LIST from ADMIN + LOG ----------
function rebuildMachineList_(ss, yyyy) {
 const sh = ensureSheetHeader_(ss, "MACHINE_LIST", [
  "Machine No", "Machine Category", "Status"
]);

  const machineMap = {};
  const statusByMachine = {};

  // From Admin machines
  const admin = getAdminOverrides_(ss);
  const typeNameById = {};
  (admin.machineTypes || []).forEach(t => {
    typeNameById[clean_(t.id)] = clean_(t.name);
  });

  (admin.machines || []).forEach(m => {
  const machine = clean_(m.name);
  const category = typeNameById[clean_(m.type)] || clean_(m.type);
  const status = m.active === false ? "Completed" : "Active";

  if (machine && category) {
    statusByMachine[key_(machine)] = status;
    machineMap[makeKey_([machine, category])] = [machine, category, status];
  }
});

  // From LOG_YYYY also
  const logSh = ss.getSheetByName("LOG_" + yyyy);
  if (logSh && logSh.getLastRow() >= 2) {
    const vals = logSh.getDataRange().getValues();
    const headers = vals[0].map(String);
    const h = headerMap_(headers);

    const iMachine = h["machine"];
    const iCat = h["machine category"];

    if (iMachine != null && iCat != null) {
      vals.slice(1).forEach(r => {
        const machine = clean_(r[iMachine]);
        const category = clean_(r[iCat]);
        if (machine && category) {
          // ---------- 2) MACHINE_LIST from ADMIN + LOG ----------
// ---------- 2) MACHINE_LIST from ADMIN + LOG ----------
function rebuildMachineList_(ss, yyyy) {
  const sh = ensureSheetHeader_(ss, "MACHINE_LIST", [
    "Machine No", "Machine Category", "Status"
  ]);

  const machineMap = {};
  const statusByMachine = {};

  const admin = getAdminOverrides_(ss);

  const typeNameById = {};
  (admin.machineTypes || []).forEach(t => {
    typeNameById[clean_(t.id)] = clean_(t.name);
  });

  // 1) Admin machines are source of truth for status
  (admin.machines || []).forEach(m => {
    const machine = clean_(m.name);
    const category = typeNameById[clean_(m.type)] || clean_(m.type);
    const status = m.active === false ? "Completed" : "Active";

    if (machine && category) {
      statusByMachine[key_(machine)] = status;
      machineMap[makeKey_([machine, category])] = [machine, category, status];
    }
  });

  // 2) LOG fallback: add only machines missing from Admin
  const logSh = ss.getSheetByName("LOG_" + yyyy);
  if (logSh && logSh.getLastRow() >= 2) {
    const vals = logSh.getDataRange().getValues();
    const headers = vals[0].map(String);
    const h = headerMap_(headers);

    const iMachine = h["machine"];
    const iCat = h["machine category"];

    if (iMachine != null && iCat != null) {
      vals.slice(1).forEach(r => {
        const machine = clean_(r[iMachine]);
        const category = clean_(r[iCat]);

        if (machine && category) {
          const k = makeKey_([machine, category]);

          if (!machineMap[k]) {
            const status = statusByMachine[key_(machine)] || "Active";
            machineMap[k] = [machine, category, status];
          }
        }
      });
    }
  }

  const rows = Object.values(machineMap).map(r => [
    r[0] || "",
    r[1] || "",
    r[2] || "Active"
  ]);

  sh.clearContents();
  sh.getRange(1, 1, 1, 3).setValues([[
    "Machine No", "Machine Category", "Status"
  ]]);
  sh.setFrozenRows(1);

  if (rows.length) {
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  return rows;
}

        }
      });
    }
  }

  const rows = Object.values(machineMap).map(r => [
  r[0] || "",
  r[1] || "",
  r[2] || "Active"
]);

  sh.clearContents();
sh.getRange(1, 1, 1, 3).setValues([["Machine No", "Machine Category", "Status"]]);
sh.setFrozenRows(1);
  if (rows.length) {
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

  return rows;
}

// ---------- 3) Actual time from LOG ----------
function readActualByMachineSubWork_(ss, yyyy) {
  const out = {};
  const logSh = ss.getSheetByName("LOG_" + yyyy);
  if (!logSh || logSh.getLastRow() < 2) return out;

  const vals = logSh.getDataRange().getValues();
  const headers = vals[0].map(String);
  const h = headerMap_(headers);

  const iMachine = h["machine"];
  const iCat = h["machine category"];
  const iDept = h["department"];
  const iSub = h["sub work"];
  const iActual = h["actual time"];
  const iEmp = h["emp name"];
  const iDate = h["work date"];
  const iType = h["type"];
  const iDesc = h["description"];
  const iRoot = h["root area"];

  if (iMachine == null || iCat == null || iDept == null || iSub == null || iActual == null) {
    throw new Error("LOG missing required columns: Machine / Machine Category / Department / Sub Work / Actual Time");
  }

  vals.slice(1).forEach(r => {
    const machine = clean_(r[iMachine]);
    const cat = clean_(r[iCat]);
    const dept = clean_(r[iDept]);
    const sub = clean_(r[iSub]);
    const actual = Number(r[iActual] || 0) || 0;
    const emp = iEmp != null ? clean_(r[iEmp]) : "";
    const workDate = iDate != null ? normalizeWorkDate_(r[iDate]) : "";
    const workType = iType != null ? clean_(r[iType]) : "Normal";
    const desc = iDesc != null ? clean_(r[iDesc]) : "";
    const root = iRoot != null ? clean_(r[iRoot]) : "";

    if (!machine || !cat || !dept || !sub || actual <= 0) return;

    const k = makeKey_([machine, cat, dept, sub]);

    if (!out[k]) {
      out[k] = {
        actual: 0,
        rework: 0,
        other: 0,
        employees: {},
        latestDate: "",
        lossDetails: []
      };
    }

    const t = key_(workType);

    if (t === "normal") {
      out[k].actual += actual;
    } else if (t === "rework") {
      out[k].rework += actual;
      out[k].lossDetails.push({ type: "Rework", actual, emp, workDate, desc, root });
    } else {
      out[k].other += actual;
      out[k].lossDetails.push({ type: "Other", actual, emp, workDate, desc, root });
    }

    if (emp) out[k].employees[emp] = true;

    if (workDate && (!out[k].latestDate || workDate > out[k].latestDate)) {
      out[k].latestDate = workDate;
    }
  });

  return out;
}

// ---------- 4) PLANNED_WORK = machine plan + actual ----------
function rebuildPlannedWork_(ss, yyyy) {
  const stdRows = rebuildStandardTimeMaster_(ss);
  const machineRows = rebuildMachineList_(ss, yyyy);
  const actualMap = readActualByMachineSubWork_(ss, yyyy);

  const sh = ensureSheetHeader_(ss, "PLANNED_WORK", [
    "Machine No", "Machine Category", "Department", "Sub Work",
    "Std Time", "Actual Time", "Remaining Time", "Overrun Time",
    "Rework Time", "Other Time", "Done By", "Done Date"
  ]);

  const stdByCategory = {};
  stdRows.forEach(r => {
    const cat = clean_(r[0]);
    stdByCategory[key_(cat)] = stdByCategory[key_(cat)] || [];
    stdByCategory[key_(cat)].push({
      category: cat,
      dept: clean_(r[1]),
      sub: clean_(r[2]),
      std: Number(r[3] || 0) || 0
    });
  });

  const out = [];

  machineRows.forEach(mr => {
    const machine = clean_(mr[0]);
    const category = clean_(mr[1]);
    const stdList = stdByCategory[key_(category)] || [];

    stdList.forEach(s => {
      const k = makeKey_([machine, category, s.dept, s.sub]);
      const actualObj = actualMap[k] || {};

      const actual = Number(actualObj.actual || 0) || 0; // Normal only
      const rework = Number(actualObj.rework || 0) || 0;
      const other = Number(actualObj.other || 0) || 0;

      const remaining = Math.max(0, s.std - actual);
      const overrun = Math.max(0, actual - s.std);

      const doneByList = actualObj.employees ? Object.keys(actualObj.employees) : [];
      const doneBy = doneByList.length ? doneByList.join(", ") : "Pending";
      const doneDate = actualObj.latestDate || "Pending";

      out.push([
        machine,
        category,
        s.dept,
        s.sub,
        s.std,
        actual,
        remaining,
        overrun,
        rework,
        other,
        doneBy,
        doneDate
      ]);
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, 12).setValues([[
    "Machine No", "Machine Category", "Department", "Sub Work",
    "Std Time", "Actual Time", "Remaining Time", "Overrun Time",
    "Rework Time", "Other Time", "Done By", "Done Date"
  ]]);
  sh.setFrozenRows(1);

  if (out.length) {
    sh.getRange(2, 1, out.length, 12).setValues(out);
  }

  return out;
}

// ---------- 5) DASHBOARD_FEED from PLANNED_WORK ----------
function buildDashboardFeedDynamic_(yyyy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1) Rebuild detailed plan
  const plannedRows = rebuildPlannedWork_(ss, yyyy);

  // 2) Rebuild machine summary
  const summaryRows = rebuildMachineSummary_(ss, plannedRows);

  const feedSh = ensureSheetHeader_(ss, "DASHBOARD_FEED", [
    "MachineName",
    "Type",
    "Std_Total_Min",
    "Consumed_Total_Min",
    "Remaining_Total_Min",
    "Overrun_Total_Min",
    "Progress_Pct",
    "Remaining_Pct",
    "Overrun_Pct",
    "Rework_Total_Min",
    "Other_Total_Min",
    "DeptJSON"
  ]);

  const machineMap = {};
   
   // 🔹 Read MACHINE_LIST for status
const machineStatusMap = {};
const mlSh = ss.getSheetByName("MACHINE_LIST");

if (mlSh && mlSh.getLastRow() >= 2) {
  const vals = mlSh.getDataRange().getValues();
  vals.slice(1).forEach(r => {
    const machine = clean_(r[0]);
    const category = clean_(r[1]);
    const status = clean_(r[2]) || "Active";

    const k = makeKey_([machine, category]);
    machineStatusMap[k] = status;
  });
}


  summaryRows.forEach(r => {
    const section = clean_(r[0]);
    const machine = clean_(r[1]);
    const category = clean_(r[2]);
    const dept = clean_(r[3]);

    const std = Number(r[4] || 0);
    const actual = Number(r[5] || 0);
    const progressPct = Number(r[6] || 0);
    const remaining = Number(r[7] || 0);
    const remainingPct = Number(r[8] || 0);
    const overrun = Number(r[9] || 0);
    const overrunPct = Number(r[10] || 0);
    const rework = Number(r[11] || 0);
    const other = Number(r[12] || 0);

    const k = makeKey_([machine, category]);

    if (section === "MACHINE_TOTAL") {
      machineMap[k] = machineMap[k] || {
        machine,
        category,
        std: 0,
        actual: 0,
        remaining: 0,
        overrun: 0,
        progressPct: 0,
        remainingPct: 0,
        overrunPct: 0,
        rework: 0,
        other: 0,
        dept: {}
      };

      machineMap[k].std = std;
      machineMap[k].actual = actual;
      machineMap[k].remaining = remaining;
      machineMap[k].overrun = overrun;
      machineMap[k].progressPct = progressPct;
      machineMap[k].remainingPct = remainingPct;
      machineMap[k].overrunPct = overrunPct;
      machineMap[k].rework = rework;
      machineMap[k].other = other;
    }

    if (section === "DEPARTMENT") {
      machineMap[k] = machineMap[k] || {
        machine,
        category,
        std: 0,
        actual: 0,
        remaining: 0,
        overrun: 0,
        progressPct: 0,
        remainingPct: 0,
        overrunPct: 0,
        rework: 0,
        other: 0,
        dept: {}
      };

      machineMap[k].dept[dept] = {
        std,
        cons: actual,
        rem: remaining,
        ov: overrun,
        progressPct,
        remainingPct,
        overrunPct,
        rework,
        other
      };
    }
  });

 const out = Object.values(machineMap).map(m => {
  const k = makeKey_([m.machine, m.category]);
  const status = machineStatusMap[k] || "Active";

  return [
    m.machine,
    m.category,
    status,
    m.std,
    m.actual,
    m.remaining,
    m.overrun,
    m.progressPct,
    m.remainingPct,
    m.overrunPct,
    m.rework,
    m.other,
    JSON.stringify(m.dept)
  ];
});

  feedSh.clearContents();
  feedSh.getRange(1, 1, 1, 13).setValues([[
    "MachineName",
    "Type",
    "Status",
    "Std_Total_Min",
    "Consumed_Total_Min",
    "Remaining_Total_Min",
    "Overrun_Total_Min",
    "Progress_Pct",
    "Remaining_Pct",
    "Overrun_Pct",
    "Rework_Total_Min",
    "Other_Total_Min",
    "DeptJSON"
  ]]);
  feedSh.setFrozenRows(1);

  if (out.length) {
    feedSh.getRange(2, 1, out.length, 13).setValues(out);
  }

  return {
    ok: true,
    machines: out.length,
    plannedRows: plannedRows.length,
    summaryRows: summaryRows.length
  };
}

function rebuildDashboardNow() {
  const yyyy = String(new Date().getFullYear());
  Logger.log(buildDashboardFeedDynamic_(yyyy));
}

// ===================== EMPLOYEE MASTER FROM ADMIN =====================
// EMPLOYEES: Emp ID | Emp Name | Active

function rebuildEmployeesMaster_(ss) {
  const sh = ensureSheetHeader_(ss, "EMPLOYEES", [
    "Emp ID", "Emp Name", "Active"
  ]);

  const admin = getAdminOverrides_(ss);
  const employees = Array.isArray(admin.employees) ? admin.employees : [];

  const rows = employees
    .filter(e => String(e.empId || "").trim())
    .map(e => [
      String(e.empId || "").trim(),
      String(e.name || "").trim(),
      e.active === false ? "FALSE" : "TRUE"
    ]);

  sh.clearContents();
  sh.getRange(1, 1, 1, 3).setValues([["Emp ID", "Emp Name", "Active"]]);
  sh.setFrozenRows(1);

  if (rows.length) {
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  return { ok: true, employees: rows.length };
}
function rebuildEmployeesNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = rebuildEmployeesMaster_(ss);
  Logger.log(r);
}

// ===================== MACHINE SUMMARY =====================
// MACHINE_SUMMARY: one row per machine + department progress JSON

function rebuildMachineSummary_(ss, plannedRows) {
  const sh = ensureSheetHeader_(ss, "MACHINE_SUMMARY", [
    "Section",
    "Machine No",
    "Machine Category",
    "Department",
    "Std Total",
    "Actual Total",
    "Progress %",
    "Remaining Total",
    "Remaining %",
    "Overrun Total",
    "Overrun %",
    "Rework Time",
    "Other Time"
  ]);

  const machineMap = {};

  plannedRows.forEach(r => {
    const machine = clean_(r[0]);
    const category = clean_(r[1]);
    const dept = clean_(r[2]);

    const std = Number(r[4] || 0);
    const actual = Number(r[5] || 0);
    const remaining = Number(r[6] || 0);
    const overrun = Number(r[7] || 0);
    const rework = Number(r[8] || 0);
    const other = Number(r[9] || 0);

    const key = makeKey_([machine, category]);

    if (!machineMap[key]) {
      machineMap[key] = {
        machine,
        category,
        std: 0,
        actual: 0,
        remaining: 0,
        overrun: 0,
        rework: 0,
        other: 0,
        dept: {}
      };
    }

    const m = machineMap[key];

    m.std += std;
    m.actual += actual;
    m.remaining += remaining;
    m.overrun += overrun;
    m.rework += rework;
    m.other += other;

    if (!m.dept[dept]) {
      m.dept[dept] = {
        std: 0,
        actual: 0,
        remaining: 0,
        overrun: 0,
        rework: 0,
        other: 0
      };
    }

    const d = m.dept[dept];

    d.std += std;
    d.actual += actual;
    d.remaining += remaining;
    d.overrun += overrun;
    d.rework += rework;
    d.other += other;
  });

  const out = [];

  Object.values(machineMap).forEach(m => {

    const progressPct = m.std > 0 ? Math.min(100, (m.actual / m.std) * 100) : 0;
    const remainingPct = m.std > 0 ? (m.remaining / m.std) * 100 : 0;
    const overrunPct = m.std > 0 ? (m.overrun / m.std) * 100 : 0;

    // 🔷 MACHINE TOTAL ROW
    out.push([
      "MACHINE_TOTAL",
      m.machine,
      m.category,
      "ALL",
      m.std,
      m.actual,
      Number(progressPct.toFixed(1)),
      m.remaining,
      Number(remainingPct.toFixed(1)),
      m.overrun,
      Number(overrunPct.toFixed(1)),
      m.rework,
      m.other
    ]);

    // 🔶 DEPARTMENT ROWS
    Object.entries(m.dept).forEach(([dept, d]) => {

      const depProgressPct = d.std > 0 ? Math.min(100, (d.actual / d.std) * 100) : 0;
      const depRemainingPct = d.std > 0 ? (d.remaining / d.std) * 100 : 0;
      const depOverrunPct = d.std > 0 ? (d.overrun / d.std) * 100 : 0;

      out.push([
        "DEPARTMENT",
        m.machine,
        m.category,
        dept,
        d.std,
        d.actual,
        Number(depProgressPct.toFixed(1)),
        d.remaining,
        Number(depRemainingPct.toFixed(1)),
        d.overrun,
        Number(depOverrunPct.toFixed(1)),
        d.rework,
        d.other
      ]);
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, 13).setValues([[
    "Section",
    "Machine No",
    "Machine Category",
    "Department",
    "Std Total",
    "Actual Total",
    "Progress %",
    "Remaining Total",
    "Remaining %",
    "Overrun Total",
    "Overrun %",
    "Rework Time",
    "Other Time"
  ]]);
  sh.setFrozenRows(1);

  if (out.length) {
    sh.getRange(2, 1, out.length, 13).setValues(out);
  }

  return out;
}// ===================== SEED ABSENTEES =====================
// Creates Absent rows for all active employees for today's active shifts.
// If employee already has row for Date + Shift, it will not duplicate.

function seedAbsenteesForToday() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  rebuildEmployeesMaster_(ss);

  const employeesSh = ss.getSheetByName("EMPLOYEES");
  if (!employeesSh) throw new Error("EMPLOYEES sheet not found.");

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const yyyy = getYear_(today);
  const attName = "ATT_" + yyyy;

  let attSh = ss.getSheetByName(attName);
  if (!attSh) {
    attSh = ss.insertSheet(attName);
    writeAttendanceHeader_(attSh);
  }

  // ✅ Only General shift should be seeded as Absent
  const shiftsToSeed = ["General"];

  const lastRow = employeesSh.getLastRow();
  if (lastRow < 2) return;

  const empData = employeesSh
    .getRange(2, 1, lastRow - 1, 3)
    .getValues()
    .filter(r => String(r[0]).trim() && String(r[2]).toLowerCase() !== "false");

  const existing = getAttendanceKeysForDate_(attSh, today);
  const rowsToAdd = [];

  shiftsToSeed.forEach(shiftName => {
    empData.forEach(r => {
      const empId = String(r[0]).trim();
      const empName = String(r[1] || "").trim();
      const key = `${today}|${empId}|${shiftName}`;

      if (!existing.has(key)) {
        rowsToAdd.push([
          new Date(),
          today,
          empId,
          empName,
          shiftName,
          "",
          "Absent",
          0,
          0,
          "0.00",
          0,
          "0.00",
          0
        ]);
      }
    });
  });

  if (rowsToAdd.length > 0) {
    attSh.getRange(attSh.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
  }

  Logger.log("General absent rows added: " + rowsToAdd.length);
}

function getAttendanceKeysForDate_(attSh, workDate) {
  const set = new Set();
  const lastRow = attSh.getLastRow();
  if (lastRow < 2) return set;

  const data = attSh.getRange(2, 1, lastRow - 1, 5).getValues();

  for (let i = 0; i < data.length; i++) {
    const d = normalizeWorkDate_(data[i][1]);
    if (d !== workDate) continue;

    const empId = String(data[i][2] || "").trim();
    const shift = String(data[i][4] || "").trim();

    if (empId && shift) {
      set.add(`${workDate}|${empId}|${shift}`);
    }
  }

  return set;
}