// server/routes/backupRoutes.js
// SP WorkTrack DB Edition - Backup and Google Sheets sync routes.

const express = require("express");
const { getStatus, testConnection, syncToday, syncRange } = require("../services/sheetsSyncService");
const {
  getBackupControls,
  saveBackupControls,
  saveBackupResult
} = require("../services/backupControlService");

const router = express.Router();

async function ensureBackupAllowed(res) {
  const controls = await getBackupControls();
  if (controls.googleSheetBackupEnabled === false) {
    res.status(400).json({ ok: false, message: "Google Sheet backup is disabled from Backup Controls." });
    return null;
  }
  return controls;
}

router.get("/sheets/status", async (req, res) => {
  try {
    const controls = await getBackupControls();
    res.json({
      ok: true,
      data: {
        ...getStatus(),
        controls
      }
    });
  } catch (err) {
    console.error("GET /api/backup/sheets/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read backup status.", details: err.details || null });
  }
});

router.get("/sheets/controls", async (req, res) => {
  try {
    const data = await getBackupControls();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/backup/sheets/controls failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load backup controls.", details: err.details || null });
  }
});

router.post("/sheets/controls", async (req, res) => {
  try {
    const data = await saveBackupControls(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/backup/sheets/controls failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save backup controls.", details: err.details || null });
  }
});

router.post("/sheets/test", async (req, res) => {
  try {
    const data = await testConnection();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/backup/sheets/test failed:", err);
    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Google Sheets connection test failed.",
      details: err.details || null
    });
  }
});

router.post("/sheets/sync-today", async (req, res) => {
  try {
    const controls = await ensureBackupAllowed(res);
    if (!controls) return;

    const data = await syncToday(req.body || {});
    await saveBackupResult(data, {
      runType: req.body?.runType || "manual",
      workDate: req.body?.workDate || req.body?.date || data.workDate
    });

    res.status(data.implemented === false ? 501 : 200).json({ ok: data.ok !== false, data });
  } catch (err) {
    console.error("POST /api/backup/sheets/sync-today failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Google Sheets sync failed.", details: err.details || null });
  }
});

router.post("/sheets/sync-range", async (req, res) => {
  try {
    const controls = await ensureBackupAllowed(res);
    if (!controls) return;

    const body = req.body || {};
    const data = await syncRange(body);
    await saveBackupResult(data, {
      runType: body.runType || body.mode || "range",
      workDate: data.workDate
    });

    res.json({ ok: data.ok !== false, data });
  } catch (err) {
    console.error("POST /api/backup/sheets/sync-range failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Google Sheets range sync failed.", details: err.details || null });
  }
});

module.exports = router;
