// server/services/sheetsSyncService.js
// SP WorkTrack DB Edition - Google Sheets sync service.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const MODE = "google_apps_script";
const TIMEOUT_MS = Number(process.env.GOOGLE_SHEET_BACKUP_TIMEOUT_MS || 15000);

const LOG_HEADERS = [
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
  "Source Line No",
  "Synced At"
];

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function sameDate(a, b) {
  return clean(a).slice(0, 10) === clean(b).slice(0, 10);
}

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

function isEnabled() {
  return String(process.env.GOOGLE_SHEET_BACKUP_ENABLED || "false").toLowerCase() === "true";
}

function getWebAppUrl() {
  return clean(process.env.GOOGLE_SHEET_WEBAPP_URL || "");
}

function getSecret() {
  return clean(process.env.GOOGLE_SHEET_BACKUP_SECRET || "");
}

function getStatus() {
  const enabled = isEnabled();
  const hasWebAppUrl = !!getWebAppUrl();
  const hasSecret = !!getSecret();

  return {
    enabled,
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

async function pbListAll(collectionName, filter = "", sort = "created") {
  const all = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const query = { page, perPage, sort };
    if (filter) query.filter = filter;

    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query
    });

    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);

    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }

  return all;
}

function summarizePointList(value) {
  const list = Array.isArray(value) ? value : [];
  if (!list.length) return "";

  return list.map((item) => {
    if (item == null) return "";
    if (typeof item === "string") return item;
    const name = clean(item.name || item.point || item.pointName || item.value);
    const minutes = clean(item.bookedTime || item.bookedMinutes || item.standardTime || item.standardMinutes || "");
    const reading = clean(item.reading || item.status || item.result || "");
    return [name, minutes ? `${minutes} min` : "", reading].filter(Boolean).join(" - ");
  }).filter(Boolean).join("; ");
}

function buildLogRows(entries, lines, workDate) {
  const headerByEntryNo = new Map();
  entries.forEach((entry) => headerByEntryNo.set(clean(entry.entry_no), entry));

  const syncedAt = new Date().toISOString();

  return lines.map((line) => {
    const entryNo = clean(line.entry_no);
    const header = headerByEntryNo.get(entryNo) || {};
    const standardMinutes = toNumber(line.standard_minutes, 0);
    const actualMinutes = toNumber(line.actual_minutes, 0);

    return [
      clean(header.created || line.created || syncedAt),
      clean(line.work_date || header.work_date || workDate),
      clean(header.shift_name || header.shift_code),
      clean(header.shift_start),
      clean(header.shift_end),
      toNumber(header.break_minutes, 0),
      clean(header.work_type || "Normal"),
      clean(line.emp_code || header.emp_code),
      clean(line.emp_name || header.emp_name),
      toNumber(header.shift_available, 0),
      toNumber(header.total_actual_minutes, 0),
      toNumber(header.remaining_minutes, 0),
      toNumber(header.productivity_percent, 0),
      clean(line.machine_no),
      clean(line.machine_category),
      clean(line.department_name || line.department_code),
      clean(line.subwork_name || line.subwork_code),
      clean(line.work_nature || "Normal"),
      clean(line.description),
      clean(line.root_area),
      standardMinutes,
      actualMinutes,
      clean(line.efficiency_reason),
      clean(header.major_loss_reason),
      clean(header.remarks),
      toNumber(header.flexible_shift_minutes, 0),
      summarizePointList(line.booking_points_json),
      summarizePointList(line.quality_points_json),
      entryNo,
      toNumber(line.line_no, 0),
      syncedAt
    ];
  });
}

async function testConnection() {
  const appsScriptResponse = await postToWebApp({
    action: "backupTest",
    source: "sp-worktrack-db-edition",
    timestamp: new Date().toISOString()
  });

  return {
    ok: appsScriptResponse?.ok !== false,
    appsScriptResponse
  };
}

async function syncToday(options = {}) {
  const workDate = clean(options.workDate || options.date || localDateISO());
  const year = getYearFromDate(workDate);

  const allEntries = await pbListAll("production_entries", "", "created");
  const allLines = await pbListAll("production_entry_lines", "", "created");

  const entries = allEntries.filter((entry) => sameDate(entry.work_date, workDate) && clean(entry.status).toUpperCase() !== "CANCELLED");
  const validEntryNos = new Set(entries.map((entry) => clean(entry.entry_no)).filter(Boolean));
  const lines = allLines.filter((line) => sameDate(line.work_date, workDate) && (!validEntryNos.size || validEntryNos.has(clean(line.entry_no))));
  const rows = buildLogRows(entries, lines, workDate);

  await postToWebApp({ action: "ensureSheets" });

  const appendResult = await postToWebApp({
    action: "appendRows",
    sheetName: `LOG_${year}`,
    headers: LOG_HEADERS,
    rows,
    uniqueKeyColumns: ["Source Entry No", "Source Line No"]
  });

  return {
    ok: appendResult?.ok !== false,
    implemented: true,
    workDate,
    sheetName: `LOG_${year}`,
    entryCount: entries.length,
    lineCount: lines.length,
    rowCount: rows.length,
    appended: appendResult?.appended ?? 0,
    skippedDuplicates: appendResult?.skippedDuplicates ?? 0,
    appsScriptResponse: appendResult
  };
}

module.exports = {
  getStatus,
  testConnection,
  syncToday
};
