// server/services/overtimeReportEmailService.js
// Recipients and send service for Overtime reports.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { sendEmail } = require("./emailService");
const { getOvertimeReport } = require("./overtimeReportService");
const { generatePdfFromHtml } = require("./pdfReportService");

const COLLECTION = "admin_settings";
const RECIPIENTS_KEY = "overtime_report_recipients_json";

function clean(value) { return String(value ?? "").trim(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)); }
function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function safeFilePart(value) {
  return clean(value || "Report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Report";
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

async function findSettingRecord(settingKey) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1, filter: `setting_key="${settingKey}"` }
    });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) {
    if (isMissingCollectionError(err)) return null;
    throw err;
  }
}

async function saveSettingJson(settingKey, data) {
  const rec = await findSettingRecord(settingKey);
  const body = { setting_key: settingKey, setting_value: JSON.stringify(data || {}) };
  if (rec?.id) await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, { method: "PATCH", body });
  else await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  return data;
}

function normalizeRecipient(r = {}, index = 0) {
  const type = clean(r.type || r.recipientType || "to").toLowerCase() === "cc" ? "cc" : "to";
  return {
    id: clean(r.id || `OT${index + 1}`),
    name: clean(r.name || r.recipientName),
    email: clean(r.email || r.emailId),
    role: clean(r.role || r.department || r.designation),
    type,
    active: r.active !== false
  };
}

function normalizeRecipients(value) {
  const list = Array.isArray(value?.recipients) ? value.recipients : Array.isArray(value) ? value : [];
  return list.map(normalizeRecipient).filter((r) => r.email);
}

async function getOvertimeReportRecipients() {
  const rec = await findSettingRecord(RECIPIENTS_KEY);
  const parsed = safeJsonParse(rec?.setting_value, { recipients: [] });
  return { recipients: normalizeRecipients(parsed) };
}

async function saveOvertimeReportRecipients(raw = {}) {
  const data = { recipients: normalizeRecipients(raw) };
  return await saveSettingJson(RECIPIENTS_KEY, data);
}

function splitManualEmails(value = "") {
  return clean(value).split(/[;,]/).map(clean).filter(Boolean);
}

function buildTargets({ to = "", cc = "", recipients = [] } = {}) {
  const active = recipients.filter((r) => r.active && r.email);
  const rawTo = clean(to) ? splitManualEmails(to) : active.filter((r) => r.type !== "cc").map((r) => clean(r.email));
  const rawCc = clean(cc) ? splitManualEmails(cc) : active.filter((r) => r.type === "cc").map((r) => clean(r.email));

  const invalid = [], validTo = [], validCc = [];
  rawTo.forEach((email) => isValidEmail(email) ? validTo.push(email) : invalid.push(email));
  rawCc.forEach((email) => isValidEmail(email) ? validCc.push(email) : invalid.push(email));

  const toSet = new Set(validTo.map((e) => e.toLowerCase()));
  const ccFiltered = validCc.filter((email) => !toSet.has(email.toLowerCase()));

  return {
    to: Array.from(new Set(validTo)),
    cc: Array.from(new Set(ccFiltered)),
    invalid: Array.from(new Set(invalid))
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[ch]));
}

function buildMailBody(report) {
  const s = report.summary || {};
  const plain = [
    "Dear Team,",
    "",
    `Please find attached the Overtime Report for ${clean(report.period || "the selected period")}.`,
    "",
    "The PDF contains employee-wise overtime summary, machine-wise work details, department/sub-work details, standard vs actual hours, and productivity visibility for review and action.",
    "",
    `Summary: Employees ${s.employees || 0}, Entries ${s.entries || 0}, Line Records ${s.lines || 0}, Actual OT Hours ${s.totalActualHours || 0}, Standard Hours ${s.totalStandardHours || 0}, OT Productivity ${s.productivityPct || 0}%.`,
    "",
    "Regards,",
    "SP WorkTrack"
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5">
      <p>Dear Team,</p>
      <p>Please find attached the <b>Overtime Report</b> for <b>${esc(report.period || "the selected period")}</b>.</p>
      <p>The attached PDF contains:</p>
      <ul>
        <li>Employee-wise overtime summary</li>
        <li>Machine-wise work details</li>
        <li>Department and Sub Work details</li>
        <li>Standard hours vs actual overtime hours</li>
        <li>Productivity visibility for review and action</li>
      </ul>
      <p>
        <b>Summary:</b>
        Employees: ${esc(s.employees || 0)} |
        Entries: ${esc(s.entries || 0)} |
        Line Records: ${esc(s.lines || 0)} |
        Actual OT Hours: ${esc(s.totalActualHours || 0)} |
        Standard Hours: ${esc(s.totalStandardHours || 0)} |
        OT Productivity: ${esc(s.productivityPct || 0)}%
      </p>
      <p>Regards,<br><b>SP WorkTrack</b></p>
    </div>`;

  return { plain, html };
}

async function sendOvertimeReport(params = {}) {
  const recipientsData = await getOvertimeReportRecipients();
  const targets = buildTargets({ to: params.to, cc: params.cc, recipients: recipientsData.recipients });

  if (!targets.to.length) {
    const err = new Error(targets.invalid.length ? `No valid main recipient. Invalid: ${targets.invalid.join(", ")}` : "No valid main recipient configured for Overtime Report.");
    err.status = 400;
    throw err;
  }

  const report = await getOvertimeReport(params);
  const body = buildMailBody(report);

    const pdfSourceHtml = clean(params.pdfHtml) || body.html;
  const pdfBuffer = await generatePdfFromHtml(pdfSourceHtml);

  const result = await sendEmail({
    to: targets.to,
    cc: targets.cc,
    subject: `SP WorkTrack - Overtime Report - ${report.period}`,
    text: body.plain,
    html: body.html,
    attachments: [{
      filename: `${safeFilePart(`Overtime_Report_${report.period}_${report.fromDate}_to_${report.toDate}`)}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf"
    }]
  });

  return {
    sent: result.accepted?.length || targets.to.length,
    mainRecipients: targets.to,
    ccRecipients: targets.cc,
    report
  };
}

module.exports = {
  getOvertimeReportRecipients,
  saveOvertimeReportRecipients,
  sendOvertimeReport
};



