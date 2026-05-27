// server/services/sheetsSyncService.js
// SP WorkTrack DB Edition - Google Sheets sync service.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const MODE = "google_apps_script";
const TIMEOUT_MS = Number(process.env.GOOGLE_SHEET_BACKUP_TIMEOUT_MS || 15000);
const MAX_RANGE_DAYS = Number(process.env.GOOGLE_SHEET_BACKUP_MAX_RANGE_DAYS || 370);

const LOG_HEADERS = [
  "Timestamp", "Work Date", "Shift", "Shift Start", "Shift End", "Break Minutes", "Work Type",
  "Emp ID", "Emp Name", "Shift Available", "Utilized", "Remaining", "Productivity %",
  "Machine", "Machine Category", "Department", "Sub Work", "Type", "Description", "Root Area",
  "Standard Time", "Actual Time", "Efficiency Reason", "Major Loss Reason", "Major Loss Remark",
  "Flexible Shift Minutes", "Work Checkpoints", "Quality Checkpoints", "Source Entry No", "Source Line No", "Synced At"
];

const ATTENDANCE_HEADERS = [
  "Timestamp", "Work Date", "Emp ID", "Emp Name", "Shift", "Work Type", "Status",
  "Shift Available (min)", "Utilized (min)", "Total Hours", "OT Minutes", "OT Hours",
  "Productivity %", "Major Loss Reason", "Major Loss Remark", "Flexible Shift Minutes", "Source Entry No", "Synced At"
];

const QUALITY_HEADERS = [
  "Timestamp", "Work Date", "Machine", "Machine Category", "Department", "Sub Work", "Quality Point",
  "Input Type", "Reading/Status", "Result", "Done By ID", "Done By Name", "Shift", "Status", "Source Entry No", "Synced At"
];

const BOOKING_LOG_HEADERS = [
  "Timestamp", "Work Date", "Machine", "Machine Category", "Department", "Sub Work", "Booking Point",
  "Booking Std Time", "Actual Time", "Emp ID", "Emp Name", "Shift", "Work Type", "Status", "Source Entry No", "Synced At"
];

const BOOKING_STATUS_HEADERS = [
  "Machine", "Machine Category", "Department", "Sub Work", "Booking Point", "Booking Std Time", "Consumed Time",
  "Remaining Time", "Completion %", "Status", "Done Date", "Done By ID", "Done By Name", "Shift", "Source Entry No", "Synced At"
];

function clean(value) { return String(value ?? "").trim(); }
function toNumber(value, defaultValue = 0) { const n = Number(value); return Number.isFinite(n) ? n : defaultValue; }
function sameDate(a, b) { return clean(a).slice(0, 10) === clean(b).slice(0, 10); }
function round2(value) { return Math.round(toNumber(value, 0) * 100) / 100; }

function localDateISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getYearFromDate(value) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 4);
  const match = text.match(/(\d{4})/);
  return match ? match[1] : String(new Date().getFullYear());
}

function parseISODate(value, fieldName = "date") {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const err = new Error(`Invalid ${fieldName}. Use YYYY-MM-DD format.`);
    err.status = 400;
    throw err;
  }
  const d = new Date(`${text}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`Invalid ${fieldName}.`);
    err.status = 400;
    throw err;
  }
  return d;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function toISODate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function listDateRange(fromDate, toDate) {
  const start = parseISODate(fromDate, "fromDate");
  const end = parseISODate(toDate, "toDate");
  if (start > end) {
    const err = new Error("fromDate cannot be after toDate.");
    err.status = 400;
    throw err;
  }

  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    out.push(toISODate(d));
    if (out.length > MAX_RANGE_DAYS) {
      const err = new Error(`Date range too large. Maximum ${MAX_RANGE_DAYS} days allowed.`);
      err.status = 400;
      throw err;
    }
  }
  return out;
}

function isEnabled() { return String(process.env.GOOGLE_SHEET_BACKUP_ENABLED || "false").toLowerCase() === "true"; }
function getWebAppUrl() { return clean(process.env.GOOGLE_SHEET_WEBAPP_URL || ""); }
function getSecret() { return clean(process.env.GOOGLE_SHEET_BACKUP_SECRET || ""); }

function getStatus() {
  const hasWebAppUrl = !!getWebAppUrl();
  const hasSecret = !!getSecret();
  return {
    enabled: isEnabled(),
    configured: hasWebAppUrl && hasSecret,
    mode: MODE,
    hasWebAppUrl,
    hasSecret,
    timeoutMs: TIMEOUT_MS,
    message: hasWebAppUrl && hasSecret
      ? "Google Sheets sync is configured."
      : "Google Sheets sync route is ready. Add GOOGLE_SHEET_WEBAPP_URL and GOOGLE_SHEET_BACKUP_SECRET in .env."
  };
}

async function postToWebApp(payload = {}) {
  const status = getStatus();
  if (!status.enabled) {
    const err = new Error("Google Sheets sync is disabled. Set GOOGLE_SHEET_BACKUP_ENABLED=true in .env.");
    err.status = 400;
    throw err;
  }
  if (!status.configured) {
    const err = new Error("Google Sheets sync is not configured. Set GOOGLE_SHEET_WEBAPP_URL and GOOGLE_SHEET_BACKUP_SECRET in .env.");
    err.status = 400;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(getWebAppUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: getSecret(), ...payload }),
      signal: controller.signal
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Google Apps Script request failed with HTTP ${res.status}`);
      err.status = 502;
      err.details = body;
      throw err;
    }
    return body || { ok: true, raw: text };
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error("Google Sheets sync request timeout. Check Apps Script Web App URL/network.");
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function pbListAll(collectionName) {
  const all = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    let result;
    try {
      result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
        method: "GET",
        query: { page, perPage }
      });
    } catch (err) {
      err.message = `PocketBase list failed for ${collectionName}: ${err.message}`;
      err.details = { collectionName, page, perPage, originalDetails: err.details || null };
      throw err;
    }
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }
  return all;
}

function summarizePointList(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => {
    if (item == null) return "";
    if (typeof item === "string") return item;
    const name = clean(item.name || item.point || item.pointName || item.value);
    const minutes = clean(item.bookedTime || item.bookedMinutes || item.standardTime || item.standardMinutes || "");
    const reading = clean(item.reading || item.status || item.result || "");
    return [name, minutes ? `${minutes} min` : "", reading].filter(Boolean).join(" - ");
  }).filter(Boolean).join("; ");
}

function buildLogRows(entries, lines, workDate, syncedAt) {
  const headerByEntryNo = new Map(entries.map((entry) => [clean(entry.entry_no), entry]));
  return lines.map((line) => {
    const entryNo = clean(line.entry_no);
    const header = headerByEntryNo.get(entryNo) || {};
    return [
      clean(header.created || line.created || syncedAt), clean(line.work_date || header.work_date || workDate), clean(header.shift_name || header.shift_code),
      clean(header.shift_start), clean(header.shift_end), toNumber(header.break_minutes, 0), clean(header.work_type || "Normal"),
      clean(line.emp_code || header.emp_code), clean(line.emp_name || header.emp_name), toNumber(header.shift_available, 0),
      toNumber(header.total_actual_minutes, 0), toNumber(header.remaining_minutes, 0), toNumber(header.productivity_percent, 0),
      clean(line.machine_no), clean(line.machine_category), clean(line.department_name || line.department_code), clean(line.subwork_name || line.subwork_code),
      clean(line.work_nature || "Normal"), clean(line.description), clean(line.root_area), toNumber(line.standard_minutes, 0), toNumber(line.actual_minutes, 0),
      clean(line.efficiency_reason), clean(header.major_loss_reason), clean(header.remarks), toNumber(header.flexible_shift_minutes, 0),
      summarizePointList(line.booking_points_json), summarizePointList(line.quality_points_json), entryNo, toNumber(line.line_no, 0), syncedAt
    ];
  });
}

function buildAttendanceRows(entries, workDate, syncedAt) {
  return entries.map((entry) => {
    const shiftAvailable = toNumber(entry.shift_available, 0);
    const utilized = toNumber(entry.total_actual_minutes, 0);
    const otMinutes = Math.max(0, utilized - shiftAvailable);
    return [
      clean(entry.created || syncedAt), clean(entry.work_date || workDate), clean(entry.emp_code), clean(entry.emp_name), clean(entry.shift_name || entry.shift_code),
      clean(entry.work_type || "Normal"), clean(entry.status || "SUBMITTED"), shiftAvailable, utilized, round2(utilized / 60), otMinutes, round2(otMinutes / 60),
      toNumber(entry.productivity_percent, 0), clean(entry.major_loss_reason), clean(entry.remarks), toNumber(entry.flexible_shift_minutes, 0), clean(entry.entry_no), syncedAt
    ];
  });
}

function buildQualityRows(qualityLogs, entries, workDate, syncedAt) {
  const headerByEntryNo = new Map(entries.map((entry) => [clean(entry.entry_no), entry]));
  return qualityLogs.map((q) => {
    const entryNo = clean(q.entry_no);
    const header = headerByEntryNo.get(entryNo) || {};
    return [
      clean(q.created || header.created || syncedAt), clean(q.work_date || header.work_date || workDate), clean(q.machine_no), clean(q.machine_category),
      clean(q.department_name || q.department_code), clean(q.subwork_name || q.subwork_code), clean(q.point_name || q.point_code), clean(q.input_type), clean(q.value),
      clean(q.status || "DONE"), clean(q.emp_code || header.emp_code), clean(q.emp_name || header.emp_name), clean(header.shift_name || header.shift_code),
      clean(header.status || "SUBMITTED"), entryNo, syncedAt
    ];
  });
}

function buildBookingLogRows(bookingLogs, entries, workDate, syncedAt) {
  const headerByEntryNo = new Map(entries.map((entry) => [clean(entry.entry_no), entry]));
  return bookingLogs.map((b) => {
    const entryNo = clean(b.entry_no);
    const header = headerByEntryNo.get(entryNo) || {};
    return [
      clean(b.created || header.created || syncedAt), clean(b.work_date || header.work_date || workDate), clean(b.machine_no), clean(b.machine_category),
      clean(b.department_name || b.department_code), clean(b.subwork_name || b.subwork_code), clean(b.point_name || b.point_code),
      toNumber(b.original_minutes, 0), toNumber(b.booked_minutes, 0), clean(b.emp_code || header.emp_code), clean(b.emp_name || header.emp_name),
      clean(header.shift_name || header.shift_code), clean(header.work_type || "Normal"), clean(b.status_after || "BOOKED"), entryNo, syncedAt
    ];
  });
}

function buildBookingStatusRows(bookingStatus, syncedAt) {
  return bookingStatus.map((b) => [
    clean(b.machine_no), clean(b.machine_category), clean(b.department_name || b.department_code), clean(b.subwork_name || b.subwork_code), clean(b.point_name || b.point_code),
    toNumber(b.standard_minutes, 0), toNumber(b.consumed_minutes, 0), toNumber(b.remaining_minutes, 0), toNumber(b.completion_percent, 0), clean(b.status),
    clean(b.last_work_date), clean(b.last_emp_code), clean(b.last_emp_name), "", clean(b.last_entry_no), syncedAt
  ]);
}

async function testConnection() {
  const appsScriptResponse = await postToWebApp({ action: "backupTest", source: "sp-worktrack-db-edition", timestamp: new Date().toISOString() });
  return { ok: appsScriptResponse?.ok !== false, appsScriptResponse };
}

async function syncToday(options = {}) {
  const workDate = clean(options.workDate || options.date || localDateISO());
  const year = getYearFromDate(workDate);
  const syncedAt = new Date().toISOString();

  const allEntries = await pbListAll("production_entries");
  const allLines = await pbListAll("production_entry_lines");
  const allQualityLogs = await pbListAll("quality_logs");
  const allBookingLogs = await pbListAll("booking_logs");
  const allBookingStatus = await pbListAll("booking_status");

  const entries = allEntries.filter((entry) => sameDate(entry.work_date, workDate) && clean(entry.status).toUpperCase() !== "CANCELLED");
  const validEntryNos = new Set(entries.map((entry) => clean(entry.entry_no)).filter(Boolean));
  const lines = allLines.filter((line) => sameDate(line.work_date, workDate) && (!validEntryNos.size || validEntryNos.has(clean(line.entry_no))));
  const qualityLogs = allQualityLogs.filter((q) => sameDate(q.work_date, workDate) && (!validEntryNos.size || validEntryNos.has(clean(q.entry_no))));
  const bookingLogs = allBookingLogs.filter((b) => sameDate(b.work_date, workDate) && (!validEntryNos.size || validEntryNos.has(clean(b.entry_no))));

  const logRows = buildLogRows(entries, lines, workDate, syncedAt);
  const attendanceRows = buildAttendanceRows(entries, workDate, syncedAt);
  const qualityRows = buildQualityRows(qualityLogs, entries, workDate, syncedAt);
  const bookingLogRows = buildBookingLogRows(bookingLogs, entries, workDate, syncedAt);
  const bookingStatusRows = buildBookingStatusRows(allBookingStatus, syncedAt);

  await postToWebApp({ action: "ensureSheets" });

  const logResult = await postToWebApp({ action: "appendRows", sheetName: `LOG_${year}`, headers: LOG_HEADERS, rows: logRows, uniqueKeyColumns: ["Source Entry No", "Source Line No"] });
  const attendanceResult = await postToWebApp({ action: "appendRows", sheetName: `ATT_${year}`, headers: ATTENDANCE_HEADERS, rows: attendanceRows, uniqueKeyColumns: ["Source Entry No"] });
  const qualityResult = await postToWebApp({ action: "appendRows", sheetName: "QUALITY_LOG", headers: QUALITY_HEADERS, rows: qualityRows, uniqueKeyColumns: ["Source Entry No", "Quality Point"] });
  const bookingLogResult = await postToWebApp({ action: "appendRows", sheetName: "BOOKING_LOG", headers: BOOKING_LOG_HEADERS, rows: bookingLogRows, uniqueKeyColumns: ["Source Entry No", "Booking Point"] });
  const bookingStatusResult = await postToWebApp({
    action: "upsertRows",
    sheetName: "BOOKING_STATUS",
    headers: BOOKING_STATUS_HEADERS,
    rows: bookingStatusRows,
    uniqueKeyColumns: ["Machine", "Department", "Sub Work", "Booking Point"]
  });

  return {
    ok: logResult?.ok !== false && attendanceResult?.ok !== false && qualityResult?.ok !== false && bookingLogResult?.ok !== false && bookingStatusResult?.ok !== false,
    implemented: true,
    workDate,
    sheets: {
      log: { sheetName: `LOG_${year}`, rowCount: logRows.length, appended: logResult?.appended ?? 0, skippedDuplicates: logResult?.skippedDuplicates ?? 0 },
      attendance: { sheetName: `ATT_${year}`, rowCount: attendanceRows.length, appended: attendanceResult?.appended ?? 0, skippedDuplicates: attendanceResult?.skippedDuplicates ?? 0 },
      quality: { sheetName: "QUALITY_LOG", rowCount: qualityRows.length, appended: qualityResult?.appended ?? 0, skippedDuplicates: qualityResult?.skippedDuplicates ?? 0 },
      bookingLog: { sheetName: "BOOKING_LOG", rowCount: bookingLogRows.length, appended: bookingLogResult?.appended ?? 0, skippedDuplicates: bookingLogResult?.skippedDuplicates ?? 0 },
      bookingStatus: { sheetName: "BOOKING_STATUS", rowCount: bookingStatusRows.length, inserted: bookingStatusResult?.inserted ?? 0, updated: bookingStatusResult?.updated ?? 0 }
    },
    entryCount: entries.length,
    lineCount: lines.length,
    qualityCount: qualityLogs.length,
    bookingLogCount: bookingLogs.length,
    bookingStatusCount: allBookingStatus.length,
    rowCount: logRows.length,
    appended: logResult?.appended ?? 0,
    skippedDuplicates: logResult?.skippedDuplicates ?? 0,
    appsScriptResponse: { log: logResult, attendance: attendanceResult, quality: qualityResult, bookingLog: bookingLogResult, bookingStatus: bookingStatusResult }
  };
}

function mergeSheetSummary(target, source) {
  Object.keys(source || {}).forEach((key) => {
    const src = source[key] || {};
    const t = target[key] || { sheetName: src.sheetName || key, rowCount: 0, appended: 0, skippedDuplicates: 0, inserted: 0, updated: 0 };
    t.sheetName = src.sheetName || t.sheetName || key;
    t.rowCount += toNumber(src.rowCount, 0);
    t.appended += toNumber(src.appended, 0);
    t.skippedDuplicates += toNumber(src.skippedDuplicates, 0);
    t.inserted += toNumber(src.inserted, 0);
    t.updated += toNumber(src.updated, 0);
    target[key] = t;
  });
}

async function getFirstProductionEntryDate() {
  const entries = await pbListAll("production_entries");
  const dates = entries.map((x) => clean(x.work_date).slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  return dates[0] || localDateISO();
}

async function syncRange(options = {}) {
  const mode = clean(options.mode || "range");
  const toDate = clean(options.toDate || options.endDate || options.workDate || options.date || localDateISO());
  let fromDate = clean(options.fromDate || options.startDate || "");

  if (!fromDate && mode === "till-date") {
    fromDate = await getFirstProductionEntryDate();
  }

  if (!fromDate) {
    const err = new Error("fromDate is required for date range sync.");
    err.status = 400;
    throw err;
  }

  const dates = listDateRange(fromDate, toDate);
  const results = [];
  const sheets = {};
  let ok = true;
  let entryCount = 0;
  let lineCount = 0;
  let qualityCount = 0;
  let bookingLogCount = 0;
  let bookingStatusCount = 0;

  for (const workDate of dates) {
    const result = await syncToday({ workDate, runType: options.runType || mode });
    results.push({ workDate, ok: result.ok !== false, sheets: result.sheets });
    if (result.ok === false) ok = false;
    entryCount += toNumber(result.entryCount, 0);
    lineCount += toNumber(result.lineCount, 0);
    qualityCount += toNumber(result.qualityCount, 0);
    bookingLogCount += toNumber(result.bookingLogCount, 0);
    bookingStatusCount = Math.max(bookingStatusCount, toNumber(result.bookingStatusCount, 0));
    mergeSheetSummary(sheets, result.sheets);
  }

  return {
    ok,
    implemented: true,
    mode,
    fromDate,
    toDate,
    dateCount: dates.length,
    workDate: `${fromDate} to ${toDate}`,
    sheets,
    entryCount,
    lineCount,
    qualityCount,
    bookingLogCount,
    bookingStatusCount,
    results
  };
}

module.exports = { getStatus, testConnection, syncToday, syncRange };
