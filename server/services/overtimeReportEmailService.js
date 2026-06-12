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
  const empRows = Array.isArray(report.byEmployee) ? report.byEmployee : [];
  const detailRows = Array.isArray(report.rows) ? report.rows : [];

  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a">
      <p>Dear Team,</p>
      <p>Please find below the overtime report for <b>${esc(report.period)}</b>.</p>

      <h2>${esc(report.title || "Overtime Report")}</h2>
      <p><b>Period:</b> ${esc(report.fromDate)} to ${esc(report.toDate)}</p>

      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:14px;">
        <tr>
          <th>Employees</th><th>Entries</th><th>Actual OT Hours</th><th>Standard Hours</th><th>OT Productivity</th>
        </tr>
        <tr>
          <td>${esc(s.employees)}</td><td>${esc(s.entries)}</td><td>${esc(s.totalActualHours)}</td><td>${esc(s.totalStandardHours)}</td><td>${esc(s.productivityPct)}%</td>
        </tr>
      </table>

      <h3>Employee Summary</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr><th>Emp ID</th><th>Name</th><th>Actual OT Hours</th><th>Standard Hours</th><th>Productivity</th><th>Entries</th></tr></thead>
        <tbody>
          ${empRows.map((r) => `<tr><td>${esc(r.empCode)}</td><td>${esc(r.empName)}</td><td>${esc(r.actualHours)}</td><td>${esc(r.standardHours)}</td><td>${esc(r.productivityPct)}%</td><td>${esc(r.entries)}</td></tr>`).join("") || `<tr><td colspan="6">No overtime records.</td></tr>`}
        </tbody>
      </table>

      <h3>Detailed Records</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr><th>Date</th><th>Emp ID</th><th>Name</th><th>Shift</th><th>Actual OT Hours</th><th>Standard Hours</th><th>Productivity</th></tr></thead>
        <tbody>
          ${detailRows.map((r) => `<tr><td>${esc(r.workDate)}</td><td>${esc(r.empCode)}</td><td>${esc(r.empName)}</td><td>${esc(r.shift)}</td><td>${esc(r.actualHours)}</td><td>${esc(r.standardHours)}</td><td>${esc(r.productivityPct)}%</td></tr>`).join("") || `<tr><td colspan="7">No overtime records.</td></tr>`}
        </tbody>
      </table>

      <p>Regards,<br>SP WorkTrack</p>
    </div>`;

  const text = [
    "Dear Team,",
    "",
    `${report.title || "Overtime Report"} - ${report.period}`,
    `Period: ${report.fromDate} to ${report.toDate}`,
    `Employees: ${s.employees}`,
    `Entries: ${s.entries}`,
    `Actual OT Hours: ${s.totalActualHours}`,
    `Standard Hours: ${s.totalStandardHours}`,
    `OT Productivity: ${s.productivityPct}%`,
    "",
    "Regards,",
    "SP WorkTrack"
  ].join("\n");

  return { html, text };
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
    text: body.text,
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


