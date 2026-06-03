// server/routes/maintenanceRoutes.js
// Admin Maintenance API routes.

const express = require("express");
const {
  backupDb,
  previewDeleteByEmployee,
  deleteByEmployee,
  previewClearTransactions,
  clearTransactions,
  importOldSheetData
} = require("../services/maintenanceService");

const router = express.Router();

function handleError(res, err, fallback) {
  res.status(err.status || 500).json({ ok: false, message: err.message || fallback, details: err.details || null });
}

router.post("/backup-db", async (req, res) => {
  try {
    const data = await backupDb(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/backup-db failed:", err);
    handleError(res, err, "DB backup failed.");
  }
});

router.post("/employee-delete/preview", async (req, res) => {
  try {
    const data = await previewDeleteByEmployee(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/employee-delete/preview failed:", err);
    handleError(res, err, "Employee delete preview failed.");
  }
});

router.post("/employee-delete/confirm", async (req, res) => {
  try {
    const data = await deleteByEmployee(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/employee-delete/confirm failed:", err);
    handleError(res, err, "Employee delete failed.");
  }
});

router.post("/clear-transactions/preview", async (req, res) => {
  try {
    const data = await previewClearTransactions(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/clear-transactions/preview failed:", err);
    handleError(res, err, "Clear transaction preview failed.");
  }
});

router.post("/clear-transactions/confirm", async (req, res) => {
  try {
    const data = await clearTransactions(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/clear-transactions/confirm failed:", err);
    handleError(res, err, "Clear transaction data failed.");
  }
});

router.post("/import-old-sheet", async (req, res) => {
  try {
    const data = await importOldSheetData(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/import-old-sheet failed:", err);
    handleError(res, err, "Old sheet import failed.");
  }
});

module.exports = router;
