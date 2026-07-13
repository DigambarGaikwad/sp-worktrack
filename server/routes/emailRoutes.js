// server/routes/emailRoutes.js
// SP WorkTrack email/notification API routes.

const express = require("express");
const { getEmailStatus, sendTestEmail } = require("../services/emailService");
const {
  getQualityReportRecipients,
  saveQualityReportRecipients,
  getQualityReportObservation,
  saveQualityReportObservation,
  sendQualityReport
} = require("../services/qualityReportEmailService");
const {
  getReworkOtherReportRecipients,
  saveReworkOtherReportRecipients,
  sendReworkOtherReport
} = require("../services/reworkOtherReportEmailService");
const {
  getOvertimeReportRecipients,
  saveOvertimeReportRecipients,
  sendOvertimeReport
} = require("../services/overtimeReportEmailService");
const {
  getCapacityPlanRecipients,
  saveCapacityPlanRecipients,
  sendCapacityPlan
} = require("../services/capacityPlanEmailService");
const { generatePdfFromHtml } = require("../services/pdfReportService");

const router = express.Router();

function clean(value) { return String(value ?? "").trim(); }
function safeFilePart(value) {
  return clean(value || "Report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Report";
}

router.get("/status", async (req, res) => {
  try { res.json({ ok: true, data: getEmailStatus() }); }
  catch (err) { console.error("GET /api/email/status failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to read email status.", details: err.details || null }); }
});

router.post("/test", async (req, res) => {
  try { const result = await sendTestEmail(String(req.body?.to || "").trim()); res.json({ ok: true, data: result }); }
  catch (err) { console.error("POST /api/email/test failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send test email.", details: err.details || null }); }
});

router.get("/quality-report/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await getQualityReportRecipients() }); }
  catch (err) { console.error("GET /api/email/quality-report/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load quality report recipients.", details: err.details || null }); }
});

router.post("/quality-report/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await saveQualityReportRecipients(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/quality-report/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save quality report recipients.", details: err.details || null }); }
});

router.get("/quality-report/observation", async (req, res) => {
  try { res.json({ ok: true, data: await getQualityReportObservation(req.query?.machineNo || "") }); }
  catch (err) { console.error("GET /api/email/quality-report/observation failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load quality report observation.", details: err.details || null }); }
});

router.post("/quality-report/observation", async (req, res) => {
  try { res.json({ ok: true, data: await saveQualityReportObservation(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/quality-report/observation failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save quality report observation.", details: err.details || null }); }
});

router.post("/quality-report/send", async (req, res) => {
  try { res.json({ ok: true, data: await sendQualityReport(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/quality-report/send failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send quality report.", details: err.details || null }); }
});

router.post("/quality-report/pdf", async (req, res) => {
  try {
    const html = clean(req.body?.pdfHtml || req.body?.html || "");
    const machineNo = clean(req.body?.machineNo || "Machine");
    const pdfBuffer = await generatePdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Quality_Report_${safeFilePart(machineNo)}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) { console.error("POST /api/email/quality-report/pdf failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to generate quality report PDF.", details: err.details || null }); }
});

router.get("/rework-other-report/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await getReworkOtherReportRecipients() }); }
  catch (err) { console.error("GET /api/email/rework-other-report/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load rework/other report recipients.", details: err.details || null }); }
});

router.post("/rework-other-report/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await saveReworkOtherReportRecipients(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/rework-other-report/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save rework/other report recipients.", details: err.details || null }); }
});

router.post("/rework-other-report/send", async (req, res) => {
  try { res.json({ ok: true, data: await sendReworkOtherReport(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/rework-other-report/send failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send rework/other report.", details: err.details || null }); }
});

router.get("/overtime-report/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await getOvertimeReportRecipients() }); }
  catch (err) { console.error("GET /api/email/overtime-report/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load overtime report recipients" }); }
});

router.post("/overtime-report/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await saveOvertimeReportRecipients(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/overtime-report/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save overtime report recipients" }); }
});

router.post("/overtime-report/send", async (req, res) => {
  try { res.json({ ok: true, data: await sendOvertimeReport(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/overtime-report/send failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send overtime report" }); }
});

router.get("/capacity-plan/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await getCapacityPlanRecipients() }); }
  catch (err) { console.error("GET /api/email/capacity-plan/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to load production plan recipients.", details: err.details || null }); }
});

router.post("/capacity-plan/recipients", async (req, res) => {
  try { res.json({ ok: true, data: await saveCapacityPlanRecipients(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/capacity-plan/recipients failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to save production plan recipients.", details: err.details || null }); }
});

router.post("/capacity-plan/send", async (req, res) => {
  try { res.json({ ok: true, data: await sendCapacityPlan(req.body || {}) }); }
  catch (err) { console.error("POST /api/email/capacity-plan/send failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to send production plan.", details: err.details || null }); }
});

router.post("/capacity-plan/pdf", async (req, res) => {
  try {
    const html = clean(req.body?.pdfHtml || req.body?.html || "");
    const period = clean(req.body?.period || "Selected_Period");
    const pdfBuffer = await generatePdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Production_Plan_${safeFilePart(period)}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) { console.error("POST /api/email/capacity-plan/pdf failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to generate production plan PDF.", details: err.details || null }); }
});

router.post("/rework-other-report/pdf", async (req, res) => {
  try {
    const html = clean(req.body?.pdfHtml || req.body?.html || "");
    const reportType = clean(req.body?.reportType || "Rework");
    const period = clean(req.body?.period || "Selected_Period");
    const pdfBuffer = await generatePdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `filename="${safeFilePart(reportType)}_Report_${safeFilePart(period)}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) { console.error("POST /api/email/rework-other-report/pdf failed:", err); res.status(err.status || 500).json({ ok: false, message: err.message || "Failed to generate rework/other report PDF.", details: err.details || null }); }
});

module.exports = router;
