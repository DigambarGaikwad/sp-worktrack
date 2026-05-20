// server/routes/emailRoutes.js
// SP WorkTrack email/notification API routes.

const express = require("express");
const { getEmailStatus, sendTestEmail } = require("../services/emailService");

const router = express.Router();

router.get("/status", async (req, res) => {
  try {
    res.json({ ok: true, data: getEmailStatus() });
  } catch (err) {
    console.error("GET /api/email/status failed:", err);
    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to read email status.",
      details: err.details || null
    });
  }
});

router.post("/test", async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    const result = await sendTestEmail(to);
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("POST /api/email/test failed:", err);
    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to send test email.",
      details: err.details || null
    });
  }
});

module.exports = router;
