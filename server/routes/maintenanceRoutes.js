// server/routes/maintenanceRoutes.js
// Admin Maintenance API routes.

const express = require("express");
const {
  backupDb,
  listBackupFiles,
  restoreBackup,
  previewDeleteByEmployee,
  deleteByEmployee,
  previewClearTransactions,
  clearTransactions,
  previewClearSetupData,
  clearSetupData,
  importOldSheetData
} = require("../services/maintenanceService");
const {
  listMasterDeleteOptions,
  removeSelectedMasterRecord
} = require("../services/masterRecordMaintenanceService");
const {
  previewEmptyDatabase,
  emptyDatabase
} = require("../services/emptyDbMaintenanceService");
const {
  requestMaintenanceOtp,
  verifyMaintenanceOtp,
  requireMaintenanceOtp
} = require("../services/maintenanceOtpService");

const router = express.Router();

function handleError(res, err, fallback) {
  res.status(err.status || 500).json({ ok: false, message: err.message || fallback, details: err.details || null });
}

function assertOtp(body, action) {
  requireMaintenanceOtp({ requestToken: body?.otpRequestToken || body?.requestToken, otp: body?.otp, action });
}

router.post("/otp/request", async (req, res) => {
  try {
    const data = await requestMaintenanceOtp(req.body?.action || "maintenance_action");
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/otp/request failed:", err);
    handleError(res, err, "Failed to send maintenance OTP.");
  }
});

router.post("/otp/verify", async (req, res) => {
  try {
    const data = verifyMaintenanceOtp(req.body?.otpRequestToken || req.body?.requestToken, req.body?.otp, req.body?.action || "maintenance_action");
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/otp/verify failed:", err);
    handleError(res, err, "Failed to verify maintenance OTP.");
  }
});

router.post("/backup-db", async (req, res) => {
  try {
    const data = await backupDb(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/backup-db failed:", err);
    handleError(res, err, "DB backup failed.");
  }
});

router.post("/backups/list", async (req, res) => {
  try {
    const data = listBackupFiles();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/backups/list failed:", err);
    handleError(res, err, "Failed to list backup files.");
  }
});

router.post("/restore-backup", async (req, res) => {
  try {
    assertOtp(req.body || {}, "restore_backup");
    const data = await restoreBackup(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/restore-backup failed:", err);
    handleError(res, err, "Restore backup failed.");
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
    assertOtp(req.body || {}, "employee_delete");
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
    assertOtp(req.body || {}, "clear_transactions");
    const data = await clearTransactions(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/clear-transactions/confirm failed:", err);
    handleError(res, err, "Clear transaction data failed.");
  }
});

router.post("/clear-setup/preview", async (req, res) => {
  try {
    const data = await previewClearSetupData(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/clear-setup/preview failed:", err);
    handleError(res, err, "Clear setup data preview failed.");
  }
});

router.post("/clear-setup/confirm", async (req, res) => {
  try {
    assertOtp(req.body || {}, "clear_setup");
    const data = await clearSetupData(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/clear-setup/confirm failed:", err);
    handleError(res, err, "Clear setup data failed.");
  }
});

router.post("/master-records/options", async (req, res) => {
  try {
    const data = await listMasterDeleteOptions();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/master-records/options failed:", err);
    handleError(res, err, "Failed to load master record list.");
  }
});

router.post("/master-records/delete", async (req, res) => {
  try {
    assertOtp(req.body || {}, "master_record_delete");
    const data = await removeSelectedMasterRecord(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/master-records/delete failed:", err);
    handleError(res, err, "Master record delete failed.");
  }
});

router.post("/empty-db/preview", async (req, res) => {
  try {
    const data = await previewEmptyDatabase();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/empty-db/preview failed:", err);
    handleError(res, err, "Empty database preview failed.");
  }
});

router.post("/empty-db/confirm", async (req, res) => {
  try {
    const data = await emptyDatabase(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/empty-db/confirm failed:", err);
    handleError(res, err, "Empty database failed.");
  }
});

router.post("/import-old-sheet", async (req, res) => {
  try {
    assertOtp(req.body || {}, "import_old_sheet");
    const data = await importOldSheetData(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/maintenance/import-old-sheet failed:", err);
    handleError(res, err, "Old sheet import failed.");
  }
});

module.exports = router;



