// server/routes/emailRoutes.js
// SP WorkTrack email/notification API routes.

const express = require("express");
const { getEmailStatus, sendTestEmail } = require("../services/emailService");
const {
  getQualityReportRecipients,
  saveQualityReportRecipients,
  sendQualityReport
} = require("../services/qualityReportEmailService");
const { generatePdfFromHtml } = require("../services/pdfReportService");

const router = express.Router();

function clean(value) { return String(value ?? "").trim(); }
function safeFilePart(value) {
  return clean(value || "Report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Report";
}

router.get("/status", async (req, res) => {
  try {
    res.json({ ok: true, data: getEmailStatus() });
  } catch (err) {
    console.error("GET /api/email/status failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read email status.", details: err.details || null });
  }
});

router.post("/test", async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    const result = await sendTestEmail(to);
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("POST /api/email/test failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send test email.", details: err.details || null });
  }
});

router.get("/quality-report/recipients", async (req, res) => {
  try {
    const data = await getQualityReportRecipients();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/email/quality-report/recipients failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load quality report recipients.", details: err.details || null });
  }
});

router.post("/quality-report/recipients", async (req, res) => {
  try {
    const data = await saveQualityReportRecipients(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/email/quality-report/recipients failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save quality report recipients.", details: err.details || null });
  }
});

router.post("/quality-report/send", async (req, res) => {
  try {
    const data = await sendQualityReport(req.body || {});
    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/email/quality-report/send failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send quality report.", details: err.details || null });
  }
});

router.post("/quality-report/pdf", async (req, res) => {
  try {
    const html = clean(req.body?.pdfHtml || req.body?.html || "");
    const machineNo = clean(req.body?.machineNo || "Machine");
    const pdfBuffer = await generatePdfFromHtml(html);
    const fileName = `Quality_Report_${safeFilePart(machineNo)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("POST /api/email/quality-report/pdf failed:", err);
    res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to generate quality report PDF.", details: err.details || null });
  }
});

module.exports = router;
