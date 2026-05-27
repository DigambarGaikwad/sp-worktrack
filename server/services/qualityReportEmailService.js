// server/services/qualityReportEmailService.js
// Stores quality report email recipients and sends report emails.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { sendEmail } = require("./emailService");
const { generatePdfFromHtml } = require("./pdfReportService");

const COLLECTION = "admin_settings";
const KEY = "quality_report_recipients_json";

function clean(value) { return String(value ?? "").trim(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)); }

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

async function findSettingRecord() {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1, filter: `setting_key="${KEY}"` }
    });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) {
    if (isMissingCollectionError(err)) return null;
    throw err;
  }
}

function normalizeRecipient(r = {}, index = 0) {
  return {
    id: clean(r.id || `R${index + 1}`),
    name: clean(r.name || r.recipientName),
    email: clean(r.email || r.emailId),
    role: clean(r.role || r.department || r.designation),
    active: r.active !== false
  };
}

function normalizeRecipients(value) {
  const list = Array.isArray(value?.recipients) ? value.recipients : Array.isArray(value) ? value : [];
  return list.map(normalizeRecipient).filter((r) => r.email);
}

function safeFilePart(value) {
  return clean(value || "Report")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Report";
}

async function getQualityReportRecipients() {
  const rec = await findSettingRecord();
  const parsed = safeJsonParse(rec?.setting_value, { recipients: [] });
  return { recipients: normalizeRecipients(parsed) };
}

async function saveQualityReportRecipients(raw = {}) {
  const data = { recipients: normalizeRecipients(raw) };
  const rec = await findSettingRecord();
  const body = { setting_key: KEY, setting_value: JSON.stringify(data) };

  if (rec?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, { method: "PATCH", body });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  }

  return data;
}

function getTargetEmails({ to = "", recipients = [] } = {}) {
  const manualTo = clean(to);
  const rawTargets = manualTo
    ? manualTo.split(/[;,]/).map(clean).filter(Boolean)
    : recipients.filter((r) => r.active && r.email).map((r) => clean(r.email));

  const valid = [];
  const invalid = [];
  rawTargets.forEach((email) => {
    if (isValidEmail(email)) valid.push(email);
    else invalid.push(email);
  });

  return {
    valid: Array.from(new Set(valid)),
    invalid: Array.from(new Set(invalid))
  };
}

async function sendQualityReport({ machineNo = "", machineCategory = "", period = "", html = "", text = "", to = "", pdfHtml = "" } = {}) {
  const recipientsData = await getQualityReportRecipients();
  const targets = getTargetEmails({ to, recipients: recipientsData.recipients });

  if (!targets.valid.length) {
    const err = new Error(targets.invalid.length
      ? `No valid quality report recipient found. Invalid: ${targets.invalid.join(", ")}`
      : "No active quality report recipients found. Add recipients in Admin screen.");
    err.status = 400;
    throw err;
  }

  const subject = `SP WorkTrack Quality Report - ${clean(machineNo) || "Machine"}${period ? " - " + period : ""}`;
  const results = [];
  const attachments = [];

  if (clean(pdfHtml || html)) {
    const pdfBuffer = await generatePdfFromHtml(pdfHtml || html);
    attachments.push({
      filename: `Quality_Report_${safeFilePart(machineNo)}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf"
    });
  }

  const bodyText = text || `SP WorkTrack Quality Report\nMachine: ${machineNo}\nCategory: ${machineCategory}\nPeriod: ${period}\n\nPDF report is attached.`;
  const bodyHtml = html || `
    <div style="font-family:Arial,sans-serif;line-height:1.5;">
      <h2>SP WorkTrack Quality Report</h2>
      <p><b>Machine:</b> ${clean(machineNo)}</p>
      <p><b>Category:</b> ${clean(machineCategory)}</p>
      <p><b>Period:</b> ${clean(period)}</p>
      <p>Please find attached PDF report.</p>
    </div>
  `;

  for (const email of targets.valid) {
    const result = await sendEmail({
      to: email,
      subject,
      text: bodyText,
      html: bodyHtml,
      attachments
    });
    results.push({ email, ...result });
  }

  return { sent: results.length, attachmentCount: attachments.length, skippedInvalidRecipients: targets.invalid, results };
}

module.exports = {
  getQualityReportRecipients,
  saveQualityReportRecipients,
  sendQualityReport
};
