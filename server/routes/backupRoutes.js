// server/routes/backupRoutes.js
// SP WorkTrack DB Edition - Backup and Google Sheets sync routes.

const express = require("express");
const { getStatus, testConnection, syncToday } = require("../services/sheetsSyncService");

const router = express.Router();

router.get("/sheets/status", (req, res) => {
  res.json({
    ok: true,
    data: getStatus()
  });
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
    const data = await syncToday(req.body || {});
    res.status(data.implemented === false ? 501 : 200).json({
      ok: data.ok !== false,
      data
    });
  } catch (err) {
    console.error("POST /api/backup/sheets/sync-today failed:", err);
    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Google Sheets sync failed.",
      details: err.details || null
    });
  }
});

module.exports = router;
