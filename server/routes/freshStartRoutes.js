const express = require("express");
const service = require("../services/emptyDbMaintenanceService");

const router = express.Router();

function fail(res, err, message) {
  res.status(err.status || 500).json({ ok: false, message: err.message || message, details: err.details || null });
}

router.post("/preview", async (_req, res) => {
  try {
    res.json({ ok: true, data: await service.previewEmptyDatabase() });
  } catch (err) {
    console.error("fresh-start preview failed:", err);
    fail(res, err, "Fresh start preview failed.");
  }
});

router.post("/confirm", async (req, res) => {
  try {
    res.json({ ok: true, data: await service.emptyDatabase(req.body || {}) });
  } catch (err) {
    console.error("fresh-start confirm failed:", err);
    fail(res, err, "Fresh start failed.");
  }
});

module.exports = router;
