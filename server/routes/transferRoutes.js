// server/routes/transferRoutes.js
// Admin-only database transfer package, restore preview, and runtime prep endpoints.

const express = require("express");
const path = require("path");
const {
  getDatabaseTransferStatus,
  createTransferPackage,
  listTransferPackages,
  resolvePackagePath
} = require("../services/databaseTransferService");
const {
  validateTransferPackage,
  restoreTransferPackage
} = require("../services/databaseRestoreService");
const { testExtractTransferPackage } = require("../services/databaseRestoreTestService");
const {
  NODE_TASK,
  POCKETBASE_TASK,
  getRuntimeStatus,
  createOrUpdateTasks,
  createRuntimeShortcuts,
  openRuntimeFolder,
  removeTasks,
  runTask,
  stopPocketBaseProcesses
} = require("../services/runtimeControlService");
const { requirePermission } = require("../services/adminAccessService");

const router = express.Router();

function getAccessToken(req) {
  return req.headers["x-spwt-admin-token"] || req.body?.adminToken || req.query?.adminToken || "";
}

function requireDbTransfer(req) {
  return requirePermission(getAccessToken(req), "dbTransfer");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

router.get("/status", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await getDatabaseTransferStatus();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/transfer/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read database transfer status.", details: err.details || null });
  }
});

router.get("/packages", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await listTransferPackages();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/transfer/packages failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to list transfer packages.", details: err.details || null });
  }
});

router.post("/package", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await createTransferPackage(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/package failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to create transfer package.", details: err.details || null });
  }
});

router.get("/package/download/:fileName", async (req, res) => {
  try {
    requireDbTransfer(req);
    const fullPath = await resolvePackagePath(req.params.fileName);
    res.download(fullPath, path.basename(fullPath));
  } catch (err) {
    console.error("GET /api/transfer/package/download failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to download transfer package.", details: err.details || null });
  }
});

router.get("/restore/preview/:fileName", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await validateTransferPackage(req.params.fileName);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/transfer/restore/preview failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to preview transfer package.", details: err.details || null });
  }
});

router.post("/restore/test-extract/:fileName", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await testExtractTransferPackage(req.params.fileName);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/restore/test-extract failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to test extract transfer package.", details: err.details || null });
  }
});

router.post("/restore/:fileName", async (req, res) => {
  try {
    requireDbTransfer(req);
    if (req.body?.stopPocketBase) {
      await stopPocketBaseProcesses();
      await sleep(1200);
    }
    const data = await restoreTransferPackage(req.params.fileName, req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/restore failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to restore transfer package.", details: err.details || null });
  }
});

router.get("/runtime/status", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await getRuntimeStatus();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/transfer/runtime/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read runtime status.", details: err.details || null });
  }
});

router.post("/runtime/tasks/install", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await createOrUpdateTasks();
    if (!data.ok) return res.status(500).json({ ok: false, message: data.message, data });
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/tasks/install failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to create auto-start tasks.", details: err.details || null });
  }
});

router.post("/runtime/shortcuts/create", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await createRuntimeShortcuts();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/shortcuts/create failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to create runtime shortcuts.", details: err.details || null });
  }
});

router.post("/runtime/folder/open", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await openRuntimeFolder();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/folder/open failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to open runtime folder.", details: err.details || null });
  }
});

router.post("/runtime/tasks/remove", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await removeTasks();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/tasks/remove failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to remove auto-start tasks.", details: err.details || null });
  }
});

router.post("/runtime/pocketbase/start", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await runTask(POCKETBASE_TASK);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/pocketbase/start failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to start PocketBase task.", details: err.details || null });
  }
});

router.post("/runtime/pocketbase/stop", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await stopPocketBaseProcesses();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/pocketbase/stop failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to stop PocketBase.", details: err.details || null });
  }
});

router.post("/runtime/node/start", async (req, res) => {
  try {
    requireDbTransfer(req);
    const data = await runTask(NODE_TASK);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/transfer/runtime/node/start failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to start Node task.", details: err.details || null });
  }
});

router.post("/runtime/node/stop", async (req, res) => {
  try {
    requireDbTransfer(req);
    res.json({ ok: true, data: { message: "Node server will stop now. Browser/app connection will disconnect. Restart from Task Scheduler or server terminal." } });
    setTimeout(() => process.exit(0), 700);
  } catch (err) {
    console.error("POST /api/transfer/runtime/node/stop failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to stop Node server.", details: err.details || null });
  }
});

module.exports = router;
