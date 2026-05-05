// ===== SP WorkTrack Web App (Google Apps Script) =====
// Phase 3D Corrected Full Backend
// Keeps old sheet names and first columns stable:
// LOG_YYYY, ATT_YYYY, ADMIN, EMPLOYEES, STANDARD_TIME, MACHINE_LIST,
// PLANNED_WORK, MACHINE_SUMMARY, DASHBOARD_FEED
//
// Added without disturbing old structure:
// - Efficiency / Loss / Flexible Shift columns appended at end
// - Work Checkpoints appended at end
// - Quality data in QUALITY_LOG + QUALITY_MACHINE_STATUS
// - Booking point lock in BOOKING_LOG + BOOKING_STATUS
// - API: getCompletedBookingPoints
// Corrected: booking point status accepts both DONE and completed for frontend gray/disable logic

const SECRET = "DIGAMBAR"; // MUST MATCH renderer/config.js

// ==================== WEB APP ====================

function doGet(e) {
  return ContentService
    .createTextOutput("SP WorkTrack Web App is running ✅ (GET OK)")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
    const body = raw ? JSON.parse(raw) : {};

    if (!body.secret || body.secret !== SECRET) {
      return json_({ ok: false, error: "Unauthorized (bad secret)" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = String(body.action || "submitWork");

    // ===== QUALITY CHECK FETCH =====
if (action === "getCompletedQualityPoints") {
  const machine = String(body.machine || "");
  const category = String(body.machineCategory || "");
  const dept = String(body.department || "");
  const subWork = String(body.subWork || "");

  const done = getCompletedQualityPoints_(ss, machine, category, dept, subWork);
  return json_({ ok: true, completed: done });
}

    // ---------- SAVE ADMIN FROM ELECTRON APP ----------
    if (action === "saveAdminOverrides") {
      if (!body.adminOverrides) {
        return json_({ ok: false, error: "Missing adminOverrides payload" });
      }

      const sh = getAdminSheet_(ss);
      sh.getRange("A2").setValue(JSON.stringify(body.adminOverrides || {}, null, 2));

      const yyyy = String(body.year || new Date().getFullYear());
      setupPhase3SheetsForYear_(ss, yyyy);
      buildDashboardFeedDynamic_(yyyy);

      return json_({ ok: true, message: "Admin overrides saved and masters rebuilt" });
    }

    // ---------- FRONTEND: COMPLETED BOOKING POINTS ----------
    if (action === "getCompletedBookingPoints") {
      const machine = body.machine || "";
      const category = body.machineCategory || body.machineCategoryName || "";
      const dept = body.department || "";
      const subWork = body.subWork || "";
      const done = getCompletedBookingPoints_(ss, machine, category, dept, subWork);
      return json_({ ok: true, completed: done });
    }

    // ---------- DASHBOARD FEED ROUTE ----------
    if (action === "getDashboardFeed") {
      const yyyy = String(body.year || new Date().getFullYear());
      const build = buildDashboardFeedDynamic_(yyyy);
      const feed = ss.getSheetByName("DASHBOARD_FEED");
      const vals = feed ? feed.getDataRange().getValues() : [];
      return json_({ ok: true, source: "live", build: build, table: vals });
    }
    
        // ---------- MACHINE DASHBOARD DETAIL ROUTE ----------
    if (action === "getMachineDashboardDetails") {
      const yyyy = String(body.year || new Date().getFullYear());
      const machine = String(body.machine || "");
      const machineCategory = String(body.machineCategory || body.type || "");

      if (!machine) {
        return json_({ ok: false, error: "Missing machine for dashboard details" });
      }

      const details = getMachineDashboardDetails_(ss, yyyy, machine, machineCategory);
      return json_(details);
    }
    // ---------- OPTIONAL MANUAL REBUILD ROUTES ----------
    if (action === "rebuildDashboard") {
      const yyyy = String(body.year || new Date().getFullYear());
      return json_(buildDashboardFeedDynamic_(yyyy));
    }

    if (action === "rebuildEmployees") {
      return json_(rebuildEmployeesMaster_(ss));
    }

    if (action === "seedAbsenteesForToday") {
      return json_(seedAbsenteesForToday());
    }

    // ===================== WORK SUBMIT ROUTE =====================
    if (!body.workDate || !body.shiftName || !body.teamMemberId) {
      return json_({ ok: false, error: "Missing required fields: workDate / shiftName / teamMemberId" });
    }

    const yyyy = getYear_(body.workDate);
    setupPhase3SheetsForYear_(ss, yyyy);

    const workSheetName = "LOG_" + yyyy;
    let workSh = ss.getSheetByName(workSheetName);
    if (!workSh) {
      workSh = ss.insertSheet(workSheetName);
      writeWorkHeader_(workSh);
    } else {
      ensureWorkHeaderUpgraded_(workSh);
    }

    const attSheetName = "ATT_" + yyyy;
    let attSh = ss.getSheetByName(attSheetName);
    if (!attSh) {
      attSh = ss.insertSheet(attSheetName);
      writeAttendanceHeader_(attSh);
    } else {
      ensureAttendanceHeaderUpgraded_(attSh);
    }

    if (hasDuplicateInWorkSheet_(workSh, body.workDate, body.teamMemberId, body.shiftName)) {
      return json_({
        ok: false,
        error: "Duplicate blocked: " + body.teamMemberId + " already submitted for " + normalizeWorkDate_(body.workDate) + " (" + body.shiftName + ")."
      });
    }

    const works = Array.isArray(body.works) ? body.works : [];

    const remainingCheck = validateNormalWorkAgainstRemaining_(ss, String(yyyy), works);
    if (!remainingCheck.ok) return json_(remainingCheck);

    const efficiencyCheck = validateEfficiencyReason_(works);
    if (!efficiencyCheck.ok) return json_(efficiencyCheck);

    const bookingCheck = validateBookingPointDuplicates_(ss, body, works);
    if (!bookingCheck.ok) return json_(bookingCheck);

    const qualityCheck = validateQualityValues_(works);
    if (!qualityCheck.ok) return json_(qualityCheck);

    const rows = works.map(function(w) {
      return [
        new Date(),
        normalizeWorkDate_(body.workDate),
        String(body.shiftName || ""),
        String(body.shiftStart || ""),
        String(body.shiftEnd || ""),
        Number(body.breakMinutes || 0),
        String(body.workType || ""),
        String(body.teamMemberId || ""),
        String(body.teamMemberName || ""),
        Number(body.summary && body.summary.shiftAvailable || 0),
        Number(body.summary && body.summary.utilized || 0),
        Number(body.summary && body.summary.remaining || 0),
        Number(body.summary && body.summary.productivity || 0),
        String(w.machine || ""),
        String(w.machineCategory || ""),
        String(w.department || ""),
        String(w.subWork || ""),
        String(w.type || "Normal"),
        String(w.description || ""),
        String(w.rootArea || ""),
        Number(w.standardTime || 0),
        Number(w.actualTime || 0),
        String(w.efficiencyReason || w.lessEfficiencyReason || ""),
        String(body.majorLossReason || ""),
        String(body.majorLossRemark || ""),
        Number(body.flexibleShiftMinutes || 0),
        checkpointText_(w.workCheckpoints || w.checkpoints || []),
        qualityText_(w.quality || w.qualityValues || w.qualityCheckpoints || [])
      ];
    });

    if (rows.length > 0) {
      workSh.getRange(workSh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    appendBookingLog_(ss, body, works);
    appendQualityLog_(ss, body, works);

    const utilizedMin = Number(body.summary && body.summary.utilized || 0);
    const shiftAvailableMin = Number(body.summary && body.summary.shiftAvailable || 0);
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
      Number(body.summary && body.summary.productivity || 0),
      String(body.majorLossReason || ""),
      String(body.majorLossRemark || ""),
      Number(body.flexibleShiftMinutes || 0)
    );

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

// ==================== ADMIN STORAGE ====================

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
  obj.subWorks = obj.subWorks && typeof obj.subWorks === "object" ? obj.subWorks : {};
  obj.machineTypes = Array.isArray(obj.machineTypes) ? obj.machineTypes : [];
  obj.machines = Array.isArray(obj.machines) ? obj.machines : [];
  obj.employees = Array.isArray(obj.employees) ? obj.employees : [];
  obj.shifts = Array.isArray(obj.shifts) ? obj.shifts : [];
  obj.lossReasons = Array.isArray(obj.lossReasons) && obj.lossReasons.length ? obj.lossReasons : ["No Power", "No Load", "Short Leave", "Meeting", "5S", "Training", "Material Waiting", "Machine Breakdown", "Others"];
  obj.rootAreas = Array.isArray(obj.rootAreas) && obj.rootAreas.length ? obj.rootAreas : ["Engineering", "Vendor", "Production", "Quality", "Site Team (O&M)", "Customer Change", "Others"];
  obj.workCatalogByType = obj.workCatalogByType && typeof obj.workCatalogByType === "object" ? obj.workCatalogByType : {};

  return obj;
}

// ==================== HEADERS / SETUP ====================

function setupPhase3Sheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const yyyy = String(new Date().getFullYear());
  setupPhase3SheetsForYear_(ss, yyyy);
  buildDashboardFeedDynamic_(yyyy);
  return { ok: true, message: "Phase 3D sheets/columns checked and dashboard rebuilt", year: yyyy };
}

function setupPhase3SheetsForYear_(ss, yyyy) {
  yyyy = String(yyyy || new Date().getFullYear());

  let logSh = ss.getSheetByName("LOG_" + yyyy);
  if (!logSh) {
    logSh = ss.insertSheet("LOG_" + yyyy);
    writeWorkHeader_(logSh);
  } else {
    ensureWorkHeaderUpgraded_(logSh);
  }

  let attSh = ss.getSheetByName("ATT_" + yyyy);
  if (!attSh) {
    attSh = ss.insertSheet("ATT_" + yyyy);
    writeAttendanceHeader_(attSh);
  } else {
    ensureAttendanceHeaderUpgraded_(attSh);
  }

  ensureSheetHeader_(ss, "BOOKING_LOG", bookingLogHeaders_());
  ensureSheetHeader_(ss, "BOOKING_STATUS", bookingStatusHeaders_());
  ensureSheetHeader_(ss, "QUALITY_LOG", qualityLogHeaders_());
  ensureSheetHeader_(ss, "QUALITY_MACHINE_STATUS", qualityMachineStatusHeaders_());

  rebuildStandardTimeMaster_(ss);
  rebuildEmployeesMaster_(ss);
  rebuildMachineList_(ss, yyyy);
  rebuildBookingStatus_(ss);
  rebuildQualityLogPlan_(ss, yyyy);
  rebuildQualityMachineStatus_(ss);
}

function writeWorkHeader_(sh) {
  const headers = [
    "Timestamp","Work Date","Shift","Shift Start","Shift End","Break Minutes","Work Type",
    "Emp ID","Emp Name","Shift Available","Utilized","Remaining","Productivity %",
    "Machine","Machine Category","Department","Sub Work","Type","Description","Root Area",
    "Standard Time","Actual Time",
    "Efficiency Reason","Major Loss Reason","Major Loss Remark","Flexible Shift Minutes","Work Checkpoints","Quality Checkpoints"
  ];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
}

function ensureWorkHeaderUpgraded_(sh) {
  ensureColumnsAtEnd_(sh, [
    "Timestamp","Work Date","Shift","Shift Start","Shift End","Break Minutes","Work Type",
    "Emp ID","Emp Name","Shift Available","Utilized","Remaining","Productivity %",
    "Machine","Machine Category","Department","Sub Work","Type","Description","Root Area",
    "Standard Time","Actual Time"
  ], [
    "Efficiency Reason","Major Loss Reason","Major Loss Remark","Flexible Shift Minutes","Work Checkpoints","Quality Checkpoints"
  ]);
}

function writeAttendanceHeader_(sh) {
  const headers = [
    "Timestamp","Work Date","Emp ID","Emp Name","Shift","Work Type","Status",
    "Shift Available (min)","Utilized (min)","Total Hours","OT Minutes","OT Hours","Productivity %",
    "Major Loss Reason","Major Loss Remark","Flexible Shift Minutes"
  ];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
}

function ensureAttendanceHeaderUpgraded_(sh) {
  ensureColumnsAtEnd_(sh, [
    "Timestamp","Work Date","Emp ID","Emp Name","Shift","Work Type","Status",
    "Shift Available (min)","Utilized (min)","Total Hours","OT Minutes","OT Hours","Productivity %"
  ], [
    "Major Loss Reason","Major Loss Remark","Flexible Shift Minutes"
  ]);
}

function ensureColumnsAtEnd_(sh, baseHeaders, extraHeaders) {
  if (!sh || sh.getLastRow() === 0 || !String(sh.getRange(1, 1).getValue() || "").trim()) {
    const all = baseHeaders.concat(extraHeaders || []);
    sh.getRange(1, 1, 1, all.length).setValues([all]);
    sh.setFrozenRows(1);
    return;
  }

  let current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(v) { return String(v || "").trim(); });

  // Special legacy safety: if Machine Category is missing, append at end instead of inserting in middle.
  if (current.indexOf("Machine Category") < 0) {
    sh.getRange(1, sh.getLastColumn() + 1).setValue("Machine Category");
    current.push("Machine Category");
  }

  (extraHeaders || []).forEach(function(h) {
    current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(v) { return String(v || "").trim(); });
    if (current.indexOf(h) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
}

function bookingLogHeaders_() {
  return [
    "Timestamp","Work Date","Machine","Machine Category","Department","Sub Work",
    "Booking Point","Booking Std Time","Emp ID","Emp Name","Shift","Work Type","Status"
  ];
}

function bookingStatusHeaders_() {
  return [
    "Machine","Machine Category","Department","Sub Work","Booking Point",
    "Status","Done Date","Done By ID","Done By Name","Shift","Booking Std Time"
  ];
}

function qualityLogHeaders_() {
  return [
    "Timestamp",
    "Work Date",
    "Machine",
    "Machine Category",
    "Department",
    "Sub Work",
    "Quality Point",
    "Input Type",
    "Reading/Status",
    "Result",
    "Done By ID",
    "Done By Name",
    "Shift",
    "Status"
  ];
}

function qualityMachineStatusHeaders_() {
  return [
    "Machine","Machine Category","Total Checks","Done Checks","Pending Checks",
    "OK Count","NOT OK Count","Reading Count","Last Check Date","Status"
  ];
}

// ==================== VALIDATION ====================

function hasDuplicateInWorkSheet_(sh, workDate, empId, shiftName) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  const data = sh.getRange(2, 1, lastRow - 1, Math.max(8, sh.getLastColumn())).getValues();

  const wd = normalizeWorkDate_(workDate).toLowerCase();
  const eid = norm_(empId);
  const sn = norm_(shiftName);

  for (let i = 0; i < data.length; i++) {
    const rowWorkDate = normalizeWorkDate_(data[i][1]).toLowerCase();
    const rowShift = norm_(data[i][2]);
    const rowEmpId = norm_(data[i][7]);
    if (rowWorkDate === wd && rowShift === sn && rowEmpId === eid) return true;
  }
  return false;
}

function validateNormalWorkAgainstRemaining_(ss, yyyy, works) {
  if (!Array.isArray(works) || !works.length) return { ok: true };

  const stdRows = rebuildStandardTimeMaster_(ss);
  const machineRows = rebuildMachineList_(ss, yyyy);
  const actualMap = readActualByMachineSubWork_(ss, yyyy);

  const stdByCategory = {};
  stdRows.forEach(function(r) {
    const cat = clean_(r[0]);
    const dept = clean_(r[1]);
    const sub = clean_(r[2]);
    const std = Number(r[3] || 0) || 0;
    const k = makeKey_([cat, dept, sub]);
    if (cat && dept && sub) stdByCategory[k] = std;
  });

  const knownMachineCategory = {};
  machineRows.forEach(function(r) {
    const machine = clean_(r[0]);
    const category = clean_(r[1]);
    if (machine && category) knownMachineCategory[key_(machine)] = category;
  });

  const remainingByKey = {};

  works.forEach(function(w) {
    const workNature = key_(w && w.type);
    if (workNature !== "normal") return;

    const machine = clean_(w.machine);
    const category = clean_(w.machineCategory) || knownMachineCategory[key_(machine)] || "";
    const dept = clean_(w.department);
    const sub = clean_(w.subWork);

    if (!machine || !category || !dept || !sub) return;

    const planKey = makeKey_([machine, category, dept, sub]);
    if (remainingByKey[planKey] == null) {
      const stdKey = makeKey_([category, dept, sub]);
      const std = Number(stdByCategory[stdKey] || w.standardTime || 0) || 0;
      const actualObj = actualMap[planKey] || {};
      const normalActualDone = Number(actualObj.actual || 0) || 0;
      remainingByKey[planKey] = Math.max(0, std - normalActualDone);
    }
  });

  for (let i = 0; i < works.length; i++) {
    const w = works[i] || {};
    const workNature = key_(w.type);
    if (workNature !== "normal") continue;

    const machine = clean_(w.machine);
    const category = clean_(w.machineCategory) || "";
    const dept = clean_(w.department);
    const sub = clean_(w.subWork);
    if (!machine || !dept || !sub) continue;

    const planKey = makeKey_([machine, category, dept, sub]);
    const remaining = Number(remainingByKey[planKey] || 0) || 0;

    if (remaining <= 0) {
      return {
        ok: false,
        error: "Entry blocked: Remaining time is 0 for " + machine + " → " + dept + " → " + sub + ". Select Rework or Other if this is extra work."
      };
    }

    const actual = Number(w.actualTime || 0) || 0;
    remainingByKey[planKey] = Math.max(0, remaining - actual);
  }

  return { ok: true };
}

function validateEfficiencyReason_(works) {
  if (!Array.isArray(works) || !works.length) return { ok: true };

  for (let i = 0; i < works.length; i++) {
    const w = works[i] || {};
    const std = Number(w.standardTime || 0) || 0;
    const actual = Number(w.actualTime || 0) || 0;
    const reason = clean_(w.efficiencyReason || w.lessEfficiencyReason || "");

    if (std > 0 && actual > (std * 1.2) && !reason) {
      return {
        ok: false,
        error: "Reason required: Work " + (i + 1) + " actual time (" + actual + " min) is more than 120% of standard time (" + std + " min) for " + clean_(w.machine) + " → " + clean_(w.department) + " → " + clean_(w.subWork) + "."
      };
    }
  }
  return { ok: true };
}

function validateBookingPointDuplicates_(ss, body, works) {
  if (!Array.isArray(works) || !works.length) return { ok: true };

  const existing = getBookingDoneKeySet_(ss);
  const inThisSubmit = {};

  for (let i = 0; i < works.length; i++) {
    const w = works[i] || {};
    if (key_(w.type || "Normal") !== "normal") continue;

    const points = normalizeBookingPointList_(w.workCheckpoints || w.checkpoints || []);
    if (!points.length) continue;

    const machine = clean_(w.machine);
    const category = clean_(w.machineCategory);
    const dept = clean_(w.department);
    const sub = clean_(w.subWork);

    for (let p = 0; p < points.length; p++) {
      const point = clean_(points[p].name || points[p]);
      if (!point) continue;

      const k = bookingKey_(machine, category, dept, sub, point);

      if (existing[k]) {
        return {
          ok: false,
          error: "Booking blocked: '" + point + "' is already completed for " + machine + " → " + dept + " → " + sub + "."
        };
      }

      if (inThisSubmit[k]) {
        return {
          ok: false,
          error: "Duplicate booking in same submit: '" + point + "' repeated for " + machine + " → " + dept + " → " + sub + "."
        };
      }

      inThisSubmit[k] = true;
    }
  }

  return { ok: true };
}

function validateQualityValues_(works) {
  if (!Array.isArray(works) || !works.length) return { ok: true };

  for (let i = 0; i < works.length; i++) {
    const w = works[i] || {};
    const qList = Array.isArray(w.quality) ? w.quality : [];
    for (let q = 0; q < qList.length; q++) {
      const item = qList[q] || {};
      if (item.mandatory === true && !clean_(item.value)) {
        return {
          ok: false,
          error: "Quality required: Work " + (i + 1) + " → " + clean_(item.point) + " is mandatory."
        };
      }
    }
  }
  return { ok: true };
}

// ==================== BOOKING LOCK ====================

function appendBookingLog_(ss, body, works) {
  const sh = ensureSheetHeader_(ss, "BOOKING_LOG", bookingLogHeaders_());
  const rows = [];

  (works || []).forEach(function(w) {
    if (key_(w.type || "Normal") !== "normal") return;

    const points = normalizeBookingPointList_(w.workCheckpoints || w.checkpoints || []);
    points.forEach(function(cp) {
      const point = clean_(cp.name || cp);
      if (!point) return;

      rows.push([
        new Date(),
        normalizeWorkDate_(body.workDate),
        clean_(w.machine),
        clean_(w.machineCategory),
        clean_(w.department),
        clean_(w.subWork),
        point,
        Number(cp.standardTime || 0) || "",
        clean_(body.teamMemberId),
        clean_(body.teamMemberName),
        clean_(body.shiftName),
        clean_(w.type || "Normal"),
        "DONE"
      ]);
    });
  });

  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  rebuildBookingStatus_(ss);
}

function rebuildBookingStatus_(ss) {
  const sh = ensureSheetHeader_(ss, "BOOKING_STATUS", bookingStatusHeaders_());
  const logSh = ensureSheetHeader_(ss, "BOOKING_LOG", bookingLogHeaders_());

  const outMap = {};
  if (logSh.getLastRow() >= 2) {
    const vals = logSh.getDataRange().getValues();
    const h = headerMap_(vals[0]);

    vals.slice(1).forEach(function(r) {
      const machine = clean_(r[h["machine"]]);
      const category = clean_(r[h["machine category"]]);
      const dept = clean_(r[h["department"]]);
      const sub = clean_(r[h["sub work"]]);
      const point = clean_(r[h["booking point"]]);
      if (!machine || !dept || !sub || !point) return;

      const k = bookingKey_(machine, category, dept, sub, point);
      outMap[k] = [
        machine,
        category,
        dept,
        sub,
        point,
        "DONE",
        normalizeWorkDate_(r[h["work date"]]),
        clean_(r[h["emp id"]]),
        clean_(r[h["emp name"]]),
        clean_(r[h["shift"]]),
        Number(r[h["booking std time"]] || 0) || ""
      ];
    });
  }

  const out = Object.values(outMap);

  sh.clearContents();
  sh.getRange(1, 1, 1, bookingStatusHeaders_().length).setValues([bookingStatusHeaders_()]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, bookingStatusHeaders_().length).setValues(out);

  return out;
}

function getBookingDoneKeySet_(ss) {
  const set = {};
  const sh = ss.getSheetByName("BOOKING_LOG");
  if (!sh || sh.getLastRow() < 2) return set;

  const vals = sh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  vals.slice(1).forEach(function(r) {
    const machine = clean_(r[h["machine"]]);
    const category = clean_(r[h["machine category"]]);
    const dept = clean_(r[h["department"]]);
    const sub = clean_(r[h["sub work"]]);
    const point = clean_(r[h["booking point"]]);
    const status = clean_(r[h["status"]] || "DONE");
    if (machine && dept && sub && point && (key_(status) === "done" || key_(status) === "completed")) {
      set[bookingKey_(machine, category, dept, sub, point)] = true;
    }
  });

  return set;
}

function getCompletedBookingPoints_(ss, machine, category, dept, subWork) {
  const out = [];
  const sh = ss.getSheetByName("BOOKING_LOG");
  if (!sh || sh.getLastRow() < 2) return out;

  const vals = sh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  const mKey = key_(machine);
  const cKey = key_(category);
  const dKey = key_(dept);
  const sKey = key_(subWork);

  vals.slice(1).forEach(function(r) {
    const machineR = clean_(r[h["machine"]]);
    const categoryR = clean_(r[h["machine category"]]);
    const deptR = clean_(r[h["department"]]);
    const subR = clean_(r[h["sub work"]]);
    const point = clean_(r[h["booking point"]]);
    const status = clean_(r[h["status"]] || "DONE");

    const catOk = !cKey || key_(categoryR) === cKey;
    if (key_(machineR) === mKey && catOk && key_(deptR) === dKey && key_(subR) === sKey && point && (key_(status) === "done" || key_(status) === "completed")) {
      if (out.indexOf(point) < 0) out.push(point);
    }
  });

  return out;
}

function normalizeBookingPointList_(arr) {
  if (!arr) return [];
  if (!Array.isArray(arr)) return [String(arr)];
  return arr.map(function(x) {
    if (typeof x === "string") return { name: x, standardTime: 0 };
    return {
      name: clean_(x && (x.name || x.point || x.label || x.value)),
      standardTime: Number(x && x.standardTime || 0) || 0
    };
  }).filter(function(x) { return clean_(x.name); });
}

function bookingKey_(machine, category, dept, sub, point) {
  return makeKey_([machine, category, dept, sub, point]);
}

// ==================== QUALITY LOGGING ====================
function appendQualityLog_(ss, body, works) {
  const yyyy = getYear_(body.workDate);

  // First build pending quality plan rows
  rebuildQualityLogPlan_(ss, yyyy);

  const sh = ensureSheetHeader_(ss, "QUALITY_LOG", qualityLogHeaders_());

  (works || []).forEach(function(w) {
    const qList = Array.isArray(w.quality) ? w.quality : [];

    qList.forEach(function(q) {
      const point = clean_(q.point || q.name || q.label);
      const value = clean_(q.value);
      if (!point || !value) return;

      const inputType = clean_(q.inputType || "status");
      const result = resultFromQualityValue_(value, inputType);

      upsertQualityLogRow_(sh, [
        new Date(),
        normalizeWorkDate_(body.workDate),
        clean_(w.machine),
        clean_(w.machineCategory),
        clean_(w.department),
        clean_(w.subWork),
        point,
        inputType,
        value,
        result,
        clean_(body.teamMemberId),
        clean_(body.teamMemberName),
        clean_(body.shiftName),
        "DONE"
      ]);
    });
  });

  rebuildQualityMachineStatus_(ss);
}

function rebuildQualityMachineStatus_(ss) {
  const sh = ensureSheetHeader_(ss, "QUALITY_MACHINE_STATUS", qualityMachineStatusHeaders_());
  const logSh = ensureSheetHeader_(ss, "QUALITY_LOG", qualityLogHeaders_());

  const map = {};

  if (logSh.getLastRow() >= 2) {
    const vals = logSh.getDataRange().getValues();
    const h = headerMap_(vals[0]);

    vals.slice(1).forEach(function(r) {
      const machine = clean_(r[h["machine"]]);
      const category = clean_(r[h["machine category"]]);
      if (!machine) return;

      const k = makeKey_([machine, category]);
      if (!map[k]) {
        map[k] = {
          machine: machine,
          category: category,
          total: 0,
          done: 0,
          pending: 0,
          ok: 0,
          notOk: 0,
          reading: 0,
          lastDate: "",
          status: "OK"
        };
      }

      const m = map[k];
      const inputType = key_(r[h["input type"]]);
      const result = key_(r[h["result"]]);
      const status = key_(r[h["status"]]);
      const d = normalizeWorkDate_(r[h["work date"]]);

      m.total += 1;
      if (status === "done") m.done += 1;
      else m.pending += 1;

      if (result === "ok") m.ok += 1;
      else if (result === "not ok") {
        m.notOk += 1;
        m.status = "QUALITY ISSUE";
      } else if (inputType === "reading") m.reading += 1;

      if (d && (!m.lastDate || d > m.lastDate)) m.lastDate = d;
    });
  }

  const out = Object.values(map).map(function(m) {
    if (m.pending > 0 && m.status === "OK") m.status = "PENDING CHECK";
    return [m.machine, m.category, m.total, m.done, m.pending, m.ok, m.notOk, m.reading, m.lastDate, m.status];
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, qualityMachineStatusHeaders_().length).setValues([qualityMachineStatusHeaders_()]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, qualityMachineStatusHeaders_().length).setValues(out);

  return out;
}

function resultFromQualityValue_(value, inputType) {
  const v = clean_(value);
  if (!v) return "PENDING";
  if (key_(inputType) === "status") {
    if (key_(v) === "ok") return "OK";
    if (key_(v) === "not ok" || key_(v) === "nok") return "NOT OK";
  }
  return "READING";
}

function qualityText_(arr) {
  if (!arr) return "";
  if (Array.isArray(arr)) {
    return arr.map(function(q) {
      if (typeof q === "string") return q;
      const p = clean_(q.point || q.name || q.label);
      const v = clean_(q.value);
      if (!p && !v) return "";
      return p + (v ? ": " + v : ": PENDING");
    }).filter(Boolean).join("; ");
  }
  return String(arr || "");
}


function rebuildQualityLogPlan_(ss, yyyy) {
  yyyy = String(yyyy || new Date().getFullYear());

  const sh = ensureSheetHeader_(ss, "QUALITY_LOG", qualityLogHeaders_());

  const existingMap = {};
  if (sh.getLastRow() >= 2) {
    const vals = sh.getDataRange().getValues();
    const h = headerMap_(vals[0]);

    vals.slice(1).forEach(function(r) {
      const k = makeKey_([
        r[h["machine"]],
        r[h["machine category"]],
        r[h["department"]],
        r[h["sub work"]],
        r[h["quality point"]]
      ]);

      existingMap[k] = r;
    });
  }

  const admin = getAdminOverrides_(ss);
  const machineRows = rebuildMachineList_(ss, yyyy);

  const typeNameById = {};
  (admin.machineTypes || []).forEach(function(t) {
    typeNameById[clean_(t.id)] = clean_(t.name);
  });

  const categoryToCatalog = {};

  Object.keys(admin.workCatalogByType || {}).forEach(function(typeId) {
    const categoryName = typeNameById[typeId] || typeId;
    categoryToCatalog[key_(categoryName)] = admin.workCatalogByType[typeId];
  });

  const out = [];

  machineRows.forEach(function(mr) {
    const machine = clean_(mr[0]);
    const category = clean_(mr[1]);
    const catalog = categoryToCatalog[key_(category)];
    if (!machine || !category || !catalog) return;

    const mainWorks = Array.isArray(catalog.mainWorks) ? catalog.mainWorks : [];
    const subWorks = catalog.subWorks || {};

    mainWorks.forEach(function(dept) {
      const deptName = clean_(dept);
      const items = Array.isArray(subWorks[deptName]) ? subWorks[deptName] : [];

      items.forEach(function(sw) {
        const subWork = clean_(sw.name);
        const qList = Array.isArray(sw.qualityCheckpoints) ? sw.qualityCheckpoints : [];

        qList.forEach(function(q) {
          const point = clean_(q.name || q.point || q.label);
          if (!point) return;

          const inputType = q.inputType === "reading" ? "reading" : "status";

          const k = makeKey_([machine, category, deptName, subWork, point]);
          const old = existingMap[k];

          if (old) {
            out.push(old);
          } else {
            out.push([
              "",
              "",
              machine,
              category,
              deptName,
              subWork,
              point,
              inputType,
              "",
              "PENDING",
              "",
              "",
              "",
              "PENDING"
            ]);
          }
        });
      });
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, qualityLogHeaders_().length).setValues([qualityLogHeaders_()]);
  sh.setFrozenRows(1);

  if (out.length) {
    sh.getRange(2, 1, out.length, qualityLogHeaders_().length).setValues(out);
  }

  return out;
}


// ==================== ATTENDANCE UPSERT ====================

function upsertAttendance_(attSh, workDate, empId, empName, shiftName, workType, utilizedMin, overtimeMin, shiftAvailMin, productivity, majorLossReason, majorLossRemark, flexibleShiftMinutes) {
  ensureAttendanceHeaderUpgraded_(attSh);

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

  const status = Number(utilizedMin || 0) > 0 ? "Present" : "Absent";
  const totalHours = (Number(utilizedMin || 0) / 60).toFixed(2);
  const otHours = (Number(overtimeMin || 0) / 60).toFixed(2);

  const rowValues = [[
    new Date(),
    keyDate,
    keyEmp,
    empName || "",
    keyShift,
    workType || "",
    status,
    Number(shiftAvailMin || 0),
    Number(utilizedMin || 0),
    totalHours,
    Number(overtimeMin || 0),
    otHours,
    Number(productivity || 0),
    String(majorLossReason || ""),
    String(majorLossRemark || ""),
    Number(flexibleShiftMinutes || 0)
  ]];

  if (foundRow > 0) {
    attSh.getRange(foundRow, 1, 1, rowValues[0].length).setValues(rowValues);
  } else {
    attSh.getRange(attSh.getLastRow() + 1, 1, 1, rowValues[0].length).setValues(rowValues);
  }
}

function getMachineDashboardDetails_(ss, yyyy, machine, machineCategory) {
  yyyy = String(yyyy || new Date().getFullYear());
  machine = clean_(machine);
  machineCategory = clean_(machineCategory);

  const plannedRows = getPlannedWorkDetailsForMachine_(ss, machine, machineCategory);
  const qualityChecklist = getQualityChecklistForMachine_(ss, machine, machineCategory);
  const lastSixWorkDays = getLastSixWorkDaysForMachine_(ss, yyyy, machine, machineCategory);
  const shortageMaterial = []; // Phase 4 placeholder. Later: MATERIAL_SHORTAGE_LOG

  return {
    ok: true,
    machine: machine,
    machineCategory: machineCategory,
    remainingWork: plannedRows.remainingWork,
    completedWork: plannedRows.completedWork,
    qualityChecklist: qualityChecklist,
    lastSixWorkDays: lastSixWorkDays,
    shortageMaterial: shortageMaterial
  };
}
function getPlannedWorkDetailsForMachine_(ss, machine, machineCategory) {
  const out = {
    remainingWork: [],
    completedWork: []
  };

  const sh = ss.getSheetByName("PLANNED_WORK");
  if (!sh || sh.getLastRow() < 2) return out;

  const vals = sh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  vals.slice(1).forEach(function(r) {
    const machineNo = clean_(r[h["machine no"]]);
    const category = clean_(r[h["machine category"]]);

    const sameMachine =
      key_(machineNo) === key_(machine) &&
      (!machineCategory || key_(category) === key_(machineCategory));

    if (!sameMachine) return;

    const item = {
      machine: machineNo,
      machineCategory: category,
      department: clean_(r[h["department"]]),
      subWork: clean_(r[h["sub work"]]),
      stdTime: Number(r[h["std time"]] || 0) || 0,
      actualTime: Number(r[h["actual time"]] || 0) || 0,
      remainingTime: Number(r[h["remaining time"]] || 0) || 0,
      overrunTime: Number(r[h["overrun time"]] || 0) || 0,
      reworkTime: Number(r[h["rework time"]] || 0) || 0,
      otherTime: Number(r[h["other time"]] || 0) || 0,
      doneBy: clean_(r[h["done by"]]),
      doneDate: clean_(r[h["done date"]]),
      startDate: clean_(r[h["start date"]])
    };

    if (item.remainingTime > 0) {
      out.remainingWork.push(item);
    } else {
      out.completedWork.push(item);
    }
  });

  return out;
}

function getQualityChecklistForMachine_(ss, machine, machineCategory) {
  const out = [];

  const sh = ss.getSheetByName("QUALITY_LOG");
  if (!sh || sh.getLastRow() < 2) return out;

  const vals = sh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  vals.slice(1).forEach(function(r) {
    const machineNo = clean_(r[h["machine"]]);
    const category = clean_(r[h["machine category"]]);

    const sameMachine =
      key_(machineNo) === key_(machine) &&
      (!machineCategory || key_(category) === key_(machineCategory));

    if (!sameMachine) return;

    out.push({
      machine: machineNo,
      machineCategory: category,
      department: clean_(r[h["department"]]),
      subWork: clean_(r[h["sub work"]]),
      qualityPoint: clean_(r[h["quality point"]]),
      inputType: clean_(r[h["input type"]]),
      readingStatus: clean_(r[h["reading/status"]]),
      result: clean_(r[h["result"]]),
      doneById: clean_(r[h["done by id"]]),
      doneByName: clean_(r[h["done by name"]]),
      shift: clean_(r[h["shift"]]),
      status: clean_(r[h["status"]]),
      doneDate: normalizeWorkDate_(r[h["work date"]]),
      timestamp: r[h["timestamp"]] instanceof Date
        ? Utilities.formatDate(r[h["timestamp"]], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm")
        : clean_(r[h["timestamp"]])
    });
  });

  return out;
}

function getLastSixWorkDaysForMachine_(ss, yyyy, machine, machineCategory) {
  const out = {
    dates: [],
    actualMin: 0,
    actualHours: 0,
    stdTotalMin: 0,
    workDonePct: 0
  };

  const logSh = ss.getSheetByName("LOG_" + yyyy);
  if (!logSh || logSh.getLastRow() < 2) return out;

  const vals = logSh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  const iMachine = h["machine"];
  const iCat = h["machine category"];
  const iWorkDate = h["work date"];
  const iActual = h["actual time"];

  if (iMachine == null || iWorkDate == null || iActual == null) return out;

  const dateMap = {};

  vals.slice(1).forEach(function(r) {
    const machineNo = clean_(r[iMachine]);
    const category = iCat != null ? clean_(r[iCat]) : "";

    const sameMachine =
      key_(machineNo) === key_(machine) &&
      (!machineCategory || key_(category) === key_(machineCategory));

    if (!sameMachine) return;

    const actual = Number(r[iActual] || 0) || 0;
    if (actual <= 0) return;

    const d = normalizeWorkDate_(r[iWorkDate]);
    if (!d) return;

    if (!dateMap[d]) dateMap[d] = 0;
    dateMap[d] += actual;
  });

  const sortedDates = Object.keys(dateMap).sort(function(a, b) {
    return dateToSortable_(b) - dateToSortable_(a);
  });

  const lastSixDates = sortedDates.slice(0, 6);
  const actualMin = lastSixDates.reduce(function(sum, d) {
    return sum + Number(dateMap[d] || 0);
  }, 0);

  const stdTotalMin = getStdTotalFromDashboardFeed_(ss, machine, machineCategory);
  const pct = stdTotalMin > 0 ? (actualMin / stdTotalMin) * 100 : 0;

  out.dates = lastSixDates;
  out.actualMin = actualMin;
  out.actualHours = Number((actualMin / 60).toFixed(2));
  out.stdTotalMin = stdTotalMin;
  out.workDonePct = Number(pct.toFixed(1));

  return out;
}

function dateToSortable_(dateText) {
  const s = String(dateText || "").trim();

  // DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split("/").map(Number);
    const d = parts[0];
    const m = parts[1];
    const y = parts[2];
    return new Date(y, m - 1, d).getTime();
  }

  // fallback for date-like text
  const d2 = new Date(s);
  return isNaN(d2.getTime()) ? 0 : d2.getTime();
}

function getStdTotalFromDashboardFeed_(ss, machine, machineCategory) {
  const sh = ss.getSheetByName("DASHBOARD_FEED");
  if (!sh || sh.getLastRow() < 2) return 0;

  const vals = sh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  vals.slice(1).forEach(function(r) {
    const machineName = clean_(r[h["machinename"]]);
    const category = clean_(r[h["type"]]);

    const sameMachine =
      key_(machineName) === key_(machine) &&
      (!machineCategory || key_(category) === key_(machineCategory));

    if (sameMachine) {
      return Number(r[h["std_total_min"]] || 0) || 0;
    }
  });

  // Apps Script forEach return does not return from parent function,
  // so use normal loop below.
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const machineName = clean_(r[h["machinename"]]);
    const category = clean_(r[h["type"]]);

    const sameMachine =
      key_(machineName) === key_(machine) &&
      (!machineCategory || key_(category) === key_(machineCategory));

    if (sameMachine) {
      return Number(r[h["std_total_min"]] || 0) || 0;
    }
  }

  return 0;
}

// ===================== DASHBOARD / MASTER DATA =====================

function rebuildStandardTimeMaster_(ss) {
  const headers = ["Machine Category", "Department", "Sub Work", "Std Time", "Booking Points", "Quality Points"];
  const sh = ensureSheetHeader_(ss, "STANDARD_TIME", headers);

  const admin = getAdminOverrides_(ss);
  const rows = [];

  const typeNameById = {};
  (admin.machineTypes || []).forEach(function(t) {
    typeNameById[clean_(t.id)] = clean_(t.name);
  });

  const catalogByType = admin.workCatalogByType || {};

  Object.keys(catalogByType).forEach(function(typeId) {
    const catalog = catalogByType[typeId] || {};
    const categoryName = typeNameById[typeId] || typeId;
    const mainWorks = Array.isArray(catalog.mainWorks) ? catalog.mainWorks : [];
    const subWorks = catalog.subWorks || {};

    mainWorks.forEach(function(dept) {
      const depName = clean_(dept);
      const items = Array.isArray(subWorks[depName]) ? subWorks[depName] : [];

      items.forEach(function(it) {
        const sub = clean_(it.name);
        const std = Number(it.standardTime || 0) || 0;
        if (!categoryName || !depName || !sub) return;

        rows.push([
          categoryName,
          depName,
          sub,
          std,
          bookingPointTextFromAdmin_(it.checkpoints || it.bookingPoints || []),
          qualityPointTextFromAdmin_(it.qualityCheckpoints || it.qualityFields || [])
        ]);
      });
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return rows;
}

function rebuildMachineList_(ss, yyyy) {
  yyyy = String(yyyy || new Date().getFullYear());

  const sh = ensureSheetHeader_(ss, "MACHINE_LIST", ["Machine No", "Machine Category", "Status"]);

  const machineMap = {};
  const statusByMachine = {};
  const admin = getAdminOverrides_(ss);

  const typeNameById = {};
  (admin.machineTypes || []).forEach(function(t) {
    typeNameById[clean_(t.id)] = clean_(t.name);
  });

  (admin.machines || []).forEach(function(m) {
    const machine = clean_(m.name);
    const category = typeNameById[clean_(m.type)] || clean_(m.type);
    const status = m.active === false ? "Completed" : "Active";

    if (machine && category) {
      statusByMachine[key_(machine)] = status;
      machineMap[makeKey_([machine, category])] = [machine, category, status];
    }
  });

  const logSh = ss.getSheetByName("LOG_" + yyyy);
  if (logSh && logSh.getLastRow() >= 2) {
    const vals = logSh.getDataRange().getValues();
    const headers = vals[0].map(String);
    const h = headerMap_(headers);
    const iMachine = h["machine"];
    const iCat = h["machine category"];

    if (iMachine != null && iCat != null) {
      vals.slice(1).forEach(function(r) {
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

  const rows = Object.values(machineMap).map(function(r) {
    return [r[0] || "", r[1] || "", r[2] || "Active"];
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, 3).setValues([["Machine No", "Machine Category", "Status"]]);
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);

  return rows;
}

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
  const iEffReason = h["efficiency reason"];
  const iWorkCp = h["work checkpoints"];
  const iQualCp = h["quality checkpoints"];

  if (iMachine == null || iDept == null || iSub == null || iActual == null) {
    throw new Error("LOG missing required columns: Machine / Department / Sub Work / Actual Time");
  }

  vals.slice(1).forEach(function(r) {
    const machine = clean_(r[iMachine]);
    const cat = iCat != null ? clean_(r[iCat]) : "";
    const dept = clean_(r[iDept]);
    const sub = clean_(r[iSub]);
    const actual = Number(r[iActual] || 0) || 0;
    const emp = iEmp != null ? clean_(r[iEmp]) : "";
    const workDate = iDate != null ? normalizeWorkDate_(r[iDate]) : "";
    const workType = iType != null ? clean_(r[iType]) : "Normal";
    const desc = iDesc != null ? clean_(r[iDesc]) : "";
    const root = iRoot != null ? clean_(r[iRoot]) : "";
    const effReason = iEffReason != null ? clean_(r[iEffReason]) : "";
    const workCp = iWorkCp != null ? clean_(r[iWorkCp]) : "";
    const qualCp = iQualCp != null ? clean_(r[iQualCp]) : "";

    if (!machine || !dept || !sub || actual <= 0) return;

    const k = makeKey_([machine, cat, dept, sub]);
    if (!out[k]) {
      out[k] = {
        actual: 0,
        rework: 0,
        other: 0,
        employees: {},
        latestDate: "",
        firstDate: "",
        lossDetails: [],
        efficiencyReasons: {},
        workCheckpoints: {},
        qualityCheckpoints: {}
      };
    }

    const t = key_(workType);
    if (t === "normal") {
      out[k].actual += actual;
    } else if (t === "rework") {
      out[k].rework += actual;
      out[k].lossDetails.push({ type: "Rework", actual: actual, emp: emp, workDate: workDate, desc: desc, root: root });
    } else {
      out[k].other += actual;
      out[k].lossDetails.push({ type: "Other", actual: actual, emp: emp, workDate: workDate, desc: desc, root: root });
    }

    if (effReason) out[k].efficiencyReasons[effReason] = true;
    splitSemi_(workCp).forEach(function(x) { out[k].workCheckpoints[x] = true; });
    splitSemi_(qualCp).forEach(function(x) { out[k].qualityCheckpoints[x] = true; });

    if (emp) out[k].employees[emp] = true;
    if (workDate && (!out[k].latestDate || workDate > out[k].latestDate)) out[k].latestDate = workDate;
    if (workDate && (!out[k].firstDate || workDate < out[k].firstDate)) out[k].firstDate = workDate;
  });

  return out;
}

function rebuildPlannedWork_(ss, yyyy) {
  const stdRows = rebuildStandardTimeMaster_(ss);
  const machineRows = rebuildMachineList_(ss, yyyy);
  const actualMap = readActualByMachineSubWork_(ss, yyyy);

  const headers = [
    "Machine No", "Machine Category", "Department", "Sub Work",
    "Std Time", "Actual Time", "Remaining Time", "Overrun Time",
    "Rework Time", "Other Time", "Done By", "Done Date",
    "Start Date", "Efficiency Reasons", "Work Checkpoints", "Quality Checkpoints"
  ];

  const sh = ensureSheetHeader_(ss, "PLANNED_WORK", headers);

  const stdByCategory = {};
  stdRows.forEach(function(r) {
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

  machineRows.forEach(function(mr) {
    const machine = clean_(mr[0]);
    const category = clean_(mr[1]);
    const stdList = stdByCategory[key_(category)] || [];

    stdList.forEach(function(s) {
      const k = makeKey_([machine, category, s.dept, s.sub]);
      const actualObj = actualMap[k] || {};
      const actual = Number(actualObj.actual || 0) || 0;
      const rework = Number(actualObj.rework || 0) || 0;
      const other = Number(actualObj.other || 0) || 0;
      const remaining = Math.max(0, s.std - actual);
      const overrun = Math.max(0, actual - s.std);
      const doneByList = actualObj.employees ? Object.keys(actualObj.employees) : [];
      const doneBy = doneByList.length ? doneByList.join(", ") : "Pending";
      const doneDate = actualObj.latestDate || "Pending";
      const startDate = actualObj.firstDate || "";
      const efficiencyReasons = actualObj.efficiencyReasons ? Object.keys(actualObj.efficiencyReasons).join("; ") : "";
      const workCheckpoints = actualObj.workCheckpoints ? Object.keys(actualObj.workCheckpoints).join("; ") : "";
      const qualityCheckpoints = actualObj.qualityCheckpoints ? Object.keys(actualObj.qualityCheckpoints).join("; ") : "";

      out.push([
        machine, category, s.dept, s.sub, s.std, actual, remaining, overrun,
        rework, other, doneBy, doneDate, startDate, efficiencyReasons, workCheckpoints, qualityCheckpoints
      ]);
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, headers.length).setValues(out);
  return out;
}

function buildDashboardFeedDynamic_(yyyy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  yyyy = String(yyyy || new Date().getFullYear());

  const plannedRows = rebuildPlannedWork_(ss, yyyy);
  const summaryRows = rebuildMachineSummary_(ss, plannedRows);
  const qualityStatus = 
  rebuildQualityMachineStatus_(ss);
  const bookingStatus = rebuildBookingStatus_(ss);

  const headers = [
    "MachineName","Type","Status",
    "Std_Total_Min","Consumed_Total_Min","Remaining_Total_Min","Overrun_Total_Min",
    "Progress_Pct","Remaining_Pct","Overrun_Pct",
    "Rework_Total_Min","Other_Total_Min","DeptJSON",
    "Efficiency_Reasons","Work_Checkpoints","Quality_Checkpoints",
    "Quality_Status","Quality_NOT_OK_Count","Booking_Done_Count"
  ];

  const feedSh = ensureSheetHeader_(ss, "DASHBOARD_FEED", headers);

  const machineStatusMap = {};
  const mlSh = ss.getSheetByName("MACHINE_LIST");
  if (mlSh && mlSh.getLastRow() >= 2) {
    const vals = mlSh.getDataRange().getValues();
    vals.slice(1).forEach(function(r) {
      const machine = clean_(r[0]);
      const category = clean_(r[1]);
      const status = clean_(r[2]) || "Active";
      machineStatusMap[makeKey_([machine, category])] = status;
    });
  }

  const qMap = {};
  qualityStatus.forEach(function(r) {
    qMap[makeKey_([r[0], r[1]])] = { status: r[9], notOk: Number(r[6] || 0) || 0 };
  });

  const bCount = {};
  bookingStatus.forEach(function(r) {
    const k = makeKey_([r[0], r[1]]);
    bCount[k] = (bCount[k] || 0) + 1;
  });

  const machineMap = {};

  summaryRows.forEach(function(r) {
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
    const efficiencyReasons = clean_(r[13]);
    const workCps = clean_(r[14]);
    const qualityCps = clean_(r[15]);
    const k = makeKey_([machine, category]);

    if (!machineMap[k]) {
      machineMap[k] = {
        machine: machine,
        category: category,
        std: 0, actual: 0, remaining: 0, overrun: 0,
        progressPct: 0, remainingPct: 0, overrunPct: 0,
        rework: 0, other: 0,
        efficiencyReasons: {}, workCheckpoints: {}, qualityCheckpoints: {},
        dept: {}
      };
    }

    if (section === "MACHINE_TOTAL") {
      machineMap[k].std = std;
      machineMap[k].actual = actual;
      machineMap[k].remaining = remaining;
      machineMap[k].overrun = overrun;
      machineMap[k].progressPct = progressPct;
      machineMap[k].remainingPct = remainingPct;
      machineMap[k].overrunPct = overrunPct;
      machineMap[k].rework = rework;
      machineMap[k].other = other;
      splitSemi_(efficiencyReasons).forEach(function(x) { machineMap[k].efficiencyReasons[x] = true; });
      splitSemi_(workCps).forEach(function(x) { machineMap[k].workCheckpoints[x] = true; });
      splitSemi_(qualityCps).forEach(function(x) { machineMap[k].qualityCheckpoints[x] = true; });
    }

    if (section === "DEPARTMENT") {
      machineMap[k].dept[dept] = {
        std: std, cons: actual, rem: remaining, ov: overrun,
        progressPct: progressPct, remainingPct: remainingPct, overrunPct: overrunPct,
        rework: rework, other: other
      };
    }
  });

  const out = Object.values(machineMap).map(function(m) {
    const k = makeKey_([m.machine, m.category]);
    const q = qMap[k] || { status: "", notOk: 0 };
    return [
      m.machine,
      m.category,
      machineStatusMap[k] || "Active",
      m.std,
      m.actual,
      m.remaining,
      m.overrun,
      m.progressPct,
      m.remainingPct,
      m.overrunPct,
      m.rework,
      m.other,
      JSON.stringify(m.dept),
      Object.keys(m.efficiencyReasons || {}).join("; "),
      Object.keys(m.workCheckpoints || {}).join("; "),
      Object.keys(m.qualityCheckpoints || {}).join("; "),
      q.status || "",
      q.notOk || 0,
      bCount[k] || 0
    ];
  });

  feedSh.clearContents();
  feedSh.getRange(1, 1, 1, headers.length).setValues([headers]);
  feedSh.setFrozenRows(1);
  if (out.length) feedSh.getRange(2, 1, out.length, headers.length).setValues(out);

  return { ok: true, machines: out.length, plannedRows: plannedRows.length, summaryRows: summaryRows.length };
}

function rebuildMachineSummary_(ss, plannedRows) {
  const headers = [
    "Section","Machine No","Machine Category","Department",
    "Std Total","Actual Total","Progress %","Remaining Total","Remaining %",
    "Overrun Total","Overrun %","Rework Time","Other Time",
    "Efficiency Reasons","Work Checkpoints","Quality Checkpoints"
  ];

  const sh = ensureSheetHeader_(ss, "MACHINE_SUMMARY", headers);
  const machineMap = {};

  plannedRows.forEach(function(r) {
    const machine = clean_(r[0]);
    const category = clean_(r[1]);
    const dept = clean_(r[2]);
    const std = Number(r[4] || 0);
    const actual = Number(r[5] || 0);
    const remaining = Number(r[6] || 0);
    const overrun = Number(r[7] || 0);
    const rework = Number(r[8] || 0);
    const other = Number(r[9] || 0);
    const efficiencyReason = clean_(r[13]);
    const workCp = clean_(r[14]);
    const qualCp = clean_(r[15]);
    const k = makeKey_([machine, category]);

    if (!machineMap[k]) {
      machineMap[k] = {
        machine: machine, category: category,
        std: 0, actual: 0, remaining: 0, overrun: 0, rework: 0, other: 0,
        reasons: {}, workCps: {}, qualCps: {}, dept: {}
      };
    }

    const m = machineMap[k];
    m.std += std;
    m.actual += actual;
    m.remaining += remaining;
    m.overrun += overrun;
    m.rework += rework;
    m.other += other;
    splitSemi_(efficiencyReason).forEach(function(x) { m.reasons[x] = true; });
    splitSemi_(workCp).forEach(function(x) { m.workCps[x] = true; });
    splitSemi_(qualCp).forEach(function(x) { m.qualCps[x] = true; });

    if (!m.dept[dept]) {
      m.dept[dept] = { std: 0, actual: 0, remaining: 0, overrun: 0, rework: 0, other: 0, reasons: {}, workCps: {}, qualCps: {} };
    }

    const d = m.dept[dept];
    d.std += std;
    d.actual += actual;
    d.remaining += remaining;
    d.overrun += overrun;
    d.rework += rework;
    d.other += other;
    splitSemi_(efficiencyReason).forEach(function(x) { d.reasons[x] = true; });
    splitSemi_(workCp).forEach(function(x) { d.workCps[x] = true; });
    splitSemi_(qualCp).forEach(function(x) { d.qualCps[x] = true; });
  });

  const out = [];

  Object.values(machineMap).forEach(function(m) {
    const completedStd = Math.max(0, m.std - m.remaining);
    const progressPct = m.std > 0 ? (completedStd / m.std) * 100 : 0;
    const remainingPct = m.std > 0 ? (m.remaining / m.std) * 100 : 0;
    const overrunPct = m.std > 0 ? (m.overrun / m.std) * 100 : 0;

    out.push([
      "MACHINE_TOTAL", m.machine, m.category, "ALL",
      m.std, m.actual, Number(progressPct.toFixed(1)), m.remaining, Number(remainingPct.toFixed(1)),
      m.overrun, Number(overrunPct.toFixed(1)), m.rework, m.other,
      Object.keys(m.reasons || {}).join("; "),
      Object.keys(m.workCps || {}).join("; "),
      Object.keys(m.qualCps || {}).join("; ")
    ]);

    Object.entries(m.dept).forEach(function(entry) {
      const dept = entry[0];
      const d = entry[1];
      const depCompletedStd = Math.max(0, d.std - d.remaining);
      const depProgressPct = d.std > 0 ? (depCompletedStd / d.std) * 100 : 0;
      const depRemainingPct = d.std > 0 ? (d.remaining / d.std) * 100 : 0;
      const depOverrunPct = d.std > 0 ? (d.overrun / d.std) * 100 : 0;

      out.push([
        "DEPARTMENT", m.machine, m.category, dept,
        d.std, d.actual, Number(depProgressPct.toFixed(1)), d.remaining, Number(depRemainingPct.toFixed(1)),
        d.overrun, Number(depOverrunPct.toFixed(1)), d.rework, d.other,
        Object.keys(d.reasons || {}).join("; "),
        Object.keys(d.workCps || {}).join("; "),
        Object.keys(d.qualCps || {}).join("; ")
      ]);
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, headers.length).setValues(out);
  return out;
}

function rebuildDashboardNow() {
  const yyyy = String(new Date().getFullYear());
  Logger.log(buildDashboardFeedDynamic_(yyyy));
}

// ===================== EMPLOYEE MASTER =====================

function rebuildEmployeesMaster_(ss) {
  const sh = ensureSheetHeader_(ss, "EMPLOYEES", ["Emp ID", "Emp Name", "Active"]);
  const admin = getAdminOverrides_(ss);
  const employees = Array.isArray(admin.employees) ? admin.employees : [];

  const rows = employees
    .filter(function(e) { return String(e.empId || "").trim(); })
    .map(function(e) {
      return [
        String(e.empId || "").trim(),
        String(e.name || "").trim(),
        e.active === false ? "FALSE" : "TRUE"
      ];
    });

  sh.clearContents();
  sh.getRange(1, 1, 1, 3).setValues([["Emp ID", "Emp Name", "Active"]]);
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);

  return { ok: true, employees: rows.length };
}

function rebuildEmployeesNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = rebuildEmployeesMaster_(ss);
  Logger.log(r);
}

// ===================== SEED ABSENTEES =====================

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
  } else {
    ensureAttendanceHeaderUpgraded_(attSh);
  }

  const shiftsToSeed = ["General"];

  const lastRow = employeesSh.getLastRow();
  if (lastRow < 2) {
    return { ok: true, date: today, added: 0, message: "No active employees found" };
  }

  const empData = employeesSh
    .getRange(2, 1, lastRow - 1, 3)
    .getValues()
    .filter(function(r) {
      return String(r[0] || "").trim() && String(r[2] || "").toLowerCase() !== "false";
    });

  const existing = getAttendanceKeysForDate_(attSh, today);
  const rowsToAdd = [];

  shiftsToSeed.forEach(function(shiftName) {
    empData.forEach(function(r) {
      const empId = String(r[0] || "").trim();
      const empName = String(r[1] || "").trim();
      const k = today + "|" + empId + "|" + shiftName;

      if (!existing.has(k)) {
        rowsToAdd.push([
          new Date(), today, empId, empName, shiftName, "", "Absent",
          0, 0, "0.00", 0, "0.00", 0, "", "", 0
        ]);
        existing.add(k);
      }
    });
  });

  if (rowsToAdd.length > 0) {
    attSh.getRange(attSh.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
  }

  Logger.log("General absent rows added: " + rowsToAdd.length);
  return { ok: true, date: today, added: rowsToAdd.length };
}

function getAttendanceKeysForDate_(attSh, workDate) {
  const set = new Set();
  const lastRow = attSh.getLastRow();
  if (lastRow < 2) return set;

  const data = attSh.getRange(2, 1, lastRow - 1, 5).getValues();
  const dateKey = normalizeWorkDate_(workDate);

  for (let i = 0; i < data.length; i++) {
    const d = normalizeWorkDate_(data[i][1]);
    if (d !== dateKey) continue;

    const empId = String(data[i][2] || "").trim();
    const shift = String(data[i][4] || "").trim();
    if (empId && shift) set.add(dateKey + "|" + empId + "|" + shift);
  }

  return set;
}

// ==================== UTILITIES ====================

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
  headers.forEach(function(h, i) {
    map[String(h || "").trim().toLowerCase()] = i;
  });
  return map;
}

function norm_(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
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
function upsertQualityLogRow_(sh, row) {
  const lastRow = sh.getLastRow();

  const machine = key_(row[2]);
  const category = key_(row[3]);
  const dept = key_(row[4]);
  const subWork = key_(row[5]);
  const point = key_(row[6]);

  if (lastRow >= 2) {
    const vals = sh.getDataRange().getValues();
    const h = headerMap_(vals[0]);

    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];

      const same =
        key_(r[h["machine"]]) === machine &&
        key_(r[h["machine category"]]) === category &&
        key_(r[h["department"]]) === dept &&
        key_(r[h["sub work"]]) === subWork &&
        key_(r[h["quality point"]]) === point;

      if (same) {
        sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }

  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function getCompletedQualityPoints_(ss, machine, category, dept, subWork) {
  const out = [];
  const sh = ss.getSheetByName("QUALITY_LOG");
  if (!sh || sh.getLastRow() < 2) return out;

  const vals = sh.getDataRange().getValues();
  const h = headerMap_(vals[0]);

  vals.slice(1).forEach(function(r) {
    const same =
      key_(r[h["machine"]]) === key_(machine) &&
      (!category || key_(r[h["machine category"]]) === key_(category)) &&
      key_(r[h["department"]]) === key_(dept) &&
      key_(r[h["sub work"]]) === key_(subWork) &&
      key_(r[h["status"]]) === "done";

    if (same) {
      out.push({
        point: clean_(r[h["quality point"]]),
        value: clean_(r[h["reading/status"]]),
        result: clean_(r[h["result"]]),
        date: normalizeWorkDate_(r[h["work date"]])
      });
    }
  });

  return out;
}

function normalizeWorkDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  const s = String(v == null ? "" : v).trim();

  // If already DD/MM/YYYY → keep
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

  // Convert from YYYY-MM-DD or other formats
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  return s;
}
// this function is for fixing date formate, shuld be run once only
function fixAllDateFormats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();

  sheets.forEach(sh => {
    const range = sh.getDataRange();
    const values = range.getValues();

    for (let i = 1; i < values.length; i++) {
      for (let j = 0; j < values[i].length; j++) {
        const val = values[i][j];

        if (val instanceof Date) {
          values[i][j] = Utilities.formatDate(val, Session.getScriptTimeZone(), "dd/MM/yyyy");

        }
      }
    }

    range.setValues(values);
  });

  Logger.log("All dates converted to DD/MM/YYYY");
}

function applyDateFormatToAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ss.getSheets().forEach(sh => {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;

    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => String(h || "").trim().toLowerCase());

    headers.forEach((h, idx) => {
      if (
        h === "timestamp" ||
        h === "work date" ||
        h === "done date" ||
        h === "start date" ||
        h === "last check date"
      ) {
        const col = idx + 1;
        const range = sh.getRange(2, col, lastRow - 1, 1);

        const values = range.getValues().map(r => {
          const v = r[0];

          if (v instanceof Date) return [v];

          const s = String(v || "").trim();

          // yyyy-mm-dd
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [y, m, d] = s.split("-").map(Number);
            return [new Date(y, m - 1, d)];
          }

          // dd/mm/yyyy or d/m/yyyy
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
            const [d, m, y] = s.split("/").map(Number);
            return [new Date(y, m - 1, d)];
          }

          return [v];
        });

        range.setValues(values);
        range.setNumberFormat("dd/MM/yyyy");
      }
    });
  });

  SpreadsheetApp.flush();
}
function getYear_(dateStr) {
  const s = String(dateStr || "");

  // For DD/MM/YYYY
  if (s.includes("/")) {
    const parts = s.split("/");
    return parts[2] || new Date().getFullYear();
  }

  // Fallback
  return String(new Date(dateStr).getFullYear());
}
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkpointText_(arr) {
  if (!arr) return "";
  if (Array.isArray(arr)) {
    return arr.map(function(x) {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") return String(x.name || x.point || x.label || "");
      return String(x || "");
    }).filter(Boolean).join("; ");
  }
  return String(arr || "");
}

function splitSemi_(text) {
  return String(text || "")
    .split(";")
    .map(function(x) { return clean_(x); })
    .filter(Boolean);
}

function bookingPointTextFromAdmin_(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map(function(x) {
    if (typeof x === "string") return x;
    const name = clean_(x.name || x.point || x.label);
    const t = Number(x.standardTime || 0) || 0;
    return name ? (t ? name + "=" + t : name) : "";
  }).filter(Boolean).join("; ");
}

function qualityPointTextFromAdmin_(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map(function(x) {
    if (typeof x === "string") return x;
    const name = clean_(x.name || x.point || x.label);
    const type = clean_(x.inputType || "status");
    const mandatory = x.mandatory === true ? "Mandatory" : "Optional";
    return name ? name + " [" + type + ", " + mandatory + "]" : "";
  }).filter(Boolean).join("; ");
}
