// google_apps_script/SheetBackupReceiver.gs
// SP WorkTrack DB Edition - Google Sheet backup receiver.
// Paste this file into Google Apps Script and deploy as a Web App.
//
// Deployment:
// 1) Open the target Google Sheet.
// 2) Extensions -> Apps Script.
// 3) Paste this code into Code.gs.
// 4) Set BACKUP_SECRET below to match GOOGLE_SHEET_BACKUP_SECRET in the Node .env file.
// 5) Deploy -> New deployment -> Web app.
// 6) Execute as: Me. Access: Anyone with the link.
// 7) Copy Web App URL into GOOGLE_SHEET_WEBAPP_URL in Node .env.

const BACKUP_SECRET = "CHANGE_ME_TO_STRONG_SECRET";

function doGet() {
  return json_({
    ok: true,
    app: "SP WorkTrack Google Sheet Backup Receiver",
    message: "Receiver is running. Use POST for sync actions.",
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const body = JSON.parse(raw || "{}");

    if (!body.secret || body.secret !== BACKUP_SECRET) {
      return json_({ ok: false, error: "Unauthorized: bad or missing secret." });
    }

    const action = String(body.action || "").trim();

    if (action === "backupTest") {
      return json_({
        ok: true,
        message: "Google Sheet backup receiver connected.",
        receivedAt: new Date().toISOString(),
        source: body.source || ""
      });
    }

    if (action === "appendRows") {
      return appendRows_(body);
    }

    if (action === "ensureSheets") {
      ensureBackupSheets_();
      return json_({ ok: true, message: "Backup sheets checked/created." });
    }

    return json_({
      ok: false,
      error: "Unknown action: " + action
    });
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function appendRows_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = String(body.sheetName || "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.headers) ? body.headers : [];

  if (!sheetName) {
    return json_({ ok: false, error: "Missing sheetName." });
  }

  if (!rows.length) {
    return json_({ ok: true, sheetName: sheetName, appended: 0, message: "No rows to append." });
  }

  const sh = getOrCreateSheet_(ss, sheetName, headers);
  ensureHeaders_(sh, headers);

  const width = rows.reduce(function(max, row) {
    return Math.max(max, Array.isArray(row) ? row.length : 0);
  }, headers.length || 1);

  const normalizedRows = rows.map(function(row) {
    row = Array.isArray(row) ? row.slice() : [row];
    while (row.length < width) row.push("");
    return row;
  });

  sh.getRange(sh.getLastRow() + 1, 1, normalizedRows.length, width).setValues(normalizedRows);

  return json_({
    ok: true,
    sheetName: sheetName,
    appended: normalizedRows.length,
    lastRow: sh.getLastRow()
  });
}

function ensureBackupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const year = new Date().getFullYear();

  getOrCreateSheet_(ss, "LOG_" + year, logHeaders_());
  getOrCreateSheet_(ss, "ATT_" + year, attendanceHeaders_());
  getOrCreateSheet_(ss, "QUALITY_LOG", qualityLogHeaders_());
  getOrCreateSheet_(ss, "BOOKING_LOG", bookingLogHeaders_());
  getOrCreateSheet_(ss, "BOOKING_STATUS", bookingStatusHeaders_());
  getOrCreateSheet_(ss, "SYNC_STATUS", syncStatusHeaders_());
}

function getOrCreateSheet_(ss, sheetName, headers) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  }
  ensureHeaders_(sh, headers || []);
  return sh;
}

function ensureHeaders_(sh, headers) {
  if (!headers || !headers.length) return;

  if (sh.getLastRow() === 0 || !String(sh.getRange(1, 1).getValue() || "").trim()) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return;
  }

  const current = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function(v) { return String(v || "").trim(); });

  headers.forEach(function(h) {
    if (current.indexOf(h) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      current.push(h);
    }
  });
}

function logHeaders_() {
  return [
    "Timestamp",
    "Work Date",
    "Shift",
    "Shift Start",
    "Shift End",
    "Break Minutes",
    "Work Type",
    "Emp ID",
    "Emp Name",
    "Shift Available",
    "Utilized",
    "Remaining",
    "Productivity %",
    "Machine",
    "Machine Category",
    "Department",
    "Sub Work",
    "Type",
    "Description",
    "Root Area",
    "Standard Time",
    "Actual Time",
    "Efficiency Reason",
    "Major Loss Reason",
    "Major Loss Remark",
    "Flexible Shift Minutes",
    "Work Checkpoints",
    "Quality Checkpoints",
    "Source Entry No",
    "Synced At"
  ];
}

function attendanceHeaders_() {
  return [
    "Timestamp",
    "Work Date",
    "Emp ID",
    "Emp Name",
    "Shift",
    "Work Type",
    "Status",
    "Shift Available (min)",
    "Utilized (min)",
    "Total Hours",
    "OT Minutes",
    "OT Hours",
    "Productivity %",
    "Major Loss Reason",
    "Major Loss Remark",
    "Flexible Shift Minutes",
    "Source Entry No",
    "Synced At"
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
    "Status",
    "Source Entry No",
    "Synced At"
  ];
}

function bookingLogHeaders_() {
  return [
    "Timestamp",
    "Work Date",
    "Machine",
    "Machine Category",
    "Department",
    "Sub Work",
    "Booking Point",
    "Booking Std Time",
    "Actual Time",
    "Emp ID",
    "Emp Name",
    "Shift",
    "Work Type",
    "Status",
    "Source Entry No",
    "Synced At"
  ];
}

function bookingStatusHeaders_() {
  return [
    "Machine",
    "Machine Category",
    "Department",
    "Sub Work",
    "Booking Point",
    "Booking Std Time",
    "Consumed Time",
    "Remaining Time",
    "Completion %",
    "Status",
    "Done Date",
    "Done By ID",
    "Done By Name",
    "Shift",
    "Source Entry No",
    "Synced At"
  ];
}

function syncStatusHeaders_() {
  return [
    "Timestamp",
    "Action",
    "Sheet Name",
    "Rows",
    "Status",
    "Message"
  ];
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
