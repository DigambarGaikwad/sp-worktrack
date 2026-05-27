// server/services/backupScheduler.js
// Simple daily backup scheduler. Runs only while Node backend is running.

const { syncToday } = require("./sheetsSyncService");
const { getBackupControls, saveBackupResult } = require("./backupControlService");

const CHECK_INTERVAL_MS = Number(process.env.GOOGLE_SHEET_BACKUP_SCHEDULER_INTERVAL_MS || 60000);

let timer = null;
let running = false;

function pad(n) { return String(n).padStart(2, "0"); }

function localParts(date = new Date()) {
  return {
    dateKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    timeKey: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

async function runCheck() {
  if (running) return;
  running = true;

  try {
    const controls = await getBackupControls();
    if (controls.googleSheetBackupEnabled === false || controls.dailyBackupEnabled === false) return;

    const now = localParts();
    const backupTime = controls.dailyBackupTime || "20:00";
    const autoRunKey = `${now.dateKey}|${backupTime}`;

    if (controls.lastAutoRunKey === autoRunKey) return;
    if (now.timeKey < backupTime) return;

    console.log(`[Backup Scheduler] Running daily Google Sheet backup for ${now.dateKey}`);
    const result = await syncToday({ workDate: now.dateKey, runType: "daily-auto" });
    await saveBackupResult(result, { runType: "daily-auto", workDate: now.dateKey, autoRunKey });
    console.log(`[Backup Scheduler] Backup completed for ${now.dateKey}`);
  } catch (err) {
    console.error("[Backup Scheduler] Daily backup failed:", err);
    try {
      const now = localParts();
      await saveBackupResult({ ok: false, message: err.message || "Daily backup failed" }, { runType: "daily-auto", workDate: now.dateKey });
    } catch (saveErr) {
      console.error("[Backup Scheduler] Failed to save backup failure status:", saveErr);
    }
  } finally {
    running = false;
  }
}

function startBackupScheduler() {
  if (timer) return;
  timer = setInterval(runCheck, CHECK_INTERVAL_MS);
  setTimeout(runCheck, 5000);
  console.log(`[Backup Scheduler] Started. Check interval: ${CHECK_INTERVAL_MS} ms`);
}

module.exports = { startBackupScheduler, runCheck };
