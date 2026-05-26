// server/services/sheetsSyncService.js
// SP WorkTrack DB Edition - Google Sheets sync service.

const MODE = "google_apps_script";
const TIMEOUT_MS = Number(process.env.GOOGLE_SHEET_BACKUP_TIMEOUT_MS || 15000);

function clean(value) {
  return String(value ?? "").trim();
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

async function syncToday() {
  return {
    ok: false,
    implemented: false,
    message: "Route is ready. Next step: map PocketBase DB records to old Google Sheet columns."
  };
}

module.exports = {
  getStatus,
  testConnection,
  syncToday
};
