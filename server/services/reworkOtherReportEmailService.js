// server/services/reworkOtherReportEmailService.js
// Recipients and send service for Rework / Other Work reports.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { sendEmail } = require("./emailService");
const { generatePdfFromHtml } = require("./pdfReportService");

const COLLECTION = "admin_settings";
const RECIPIENTS_KEY = "rework_other_report_recipients_json";

function clean(value) { return String(value ?? "").trim(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)); }
function safeJsonParse(value, fallback) { try { const parsed = JSON.parse(value || ""); return parsed && typeof parsed === "object" ? parsed : fallback; } catch { return fallback; } }
function safeFilePart(value) { return clean(value || "Report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Report"; }
function isMissingCollectionError(err) { return err?.status === 404 || /missing collection context/i.test(String(err?.message || "")); }

async function findSettingRecord(settingKey) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "GET", query: { page: 1, perPage: 1, filter: `setting_key="${settingKey}"` } });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) { if (isMissingCollectionError(err)) return null; throw err; }
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
  return { id: clean(r.id || `R${index + 1}`), name: clean(r.name || r.recipientName), email: clean(r.email || r.emailId), role: clean(r.role || r.department || r.designation), type, active: r.active !== false };
}

function normalizeRecipients(value) {
  const list = Array.isArray(value?.recipients) ? value.recipients : Array.isArray(value) ? value : [];
  return list.map(normalizeRecipient).filter((r) => r.email);
}

async function getReworkOtherReportRecipients() {
  const rec = await findSettingRecord(RECIPIENTS_KEY);
  const parsed = safeJsonParse(rec?.setting_value, { recipients: [] });
  return { recipients: normalizeRecipients(parsed) };
}

async function saveReworkOtherReportRecipients(raw = {}) {
  const data = { recipients: normalizeRecipients(raw) };
  return await saveSettingJson(RECIPIENTS_KEY, data);
}

function splitManualEmails(value = "") { return clean(value).split(/[;,]/).map(clean).filter(Boolean); }

function buildTargets({ to = "", cc = "", recipients = [] } = {}) {
  const active = recipients.filter((r) => r.active && r.email);
  const rawTo = clean(to) ? splitManualEmails(to) : active.filter((r) => r.type !== "cc").map((r) => clean(r.email));
  const rawCc = clean(cc) ? splitManualEmails(cc) : active.filter((r) => r.type === "cc").map((r) => clean(r.email));
  const invalid = [], validTo = [], validCc = [];
  rawTo.forEach((email) => isValidEmail(email) ? validTo.push(email) : invalid.push(email));
  rawCc.forEach((email) => isValidEmail(email) ? validCc.push(email) : invalid.push(email));
  const toSet = new Set(validTo.map((e) => e.toLowerCase()));
  const ccFiltered = validCc.filter((email) => !toSet.has(email.toLowerCase()));
  return { to: Array.from(new Set(validTo)), cc: Array.from(new Set(ccFiltered)), invalid: Array.from(new Set(invalid)) };
}

function buildMailBody({ title, period, machine }) {
  const machineLine = clean(machine) && clean(machine) !== "All" ? ` for machine ${clean(machine)}` : " for all selected machines";
  const plain = [
    "Dear Team,",
    "",
    `Please find attached the ${title}${machineLine} for ${clean(period || "the selected period")}.`,
    "",
    "The PDF contains machine-wise summary, employee-wise summary, and detailed work nature records for review and action.",
    "",
    "Regards,",
    "SP WorkTrack"
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827;">
      <p>Dear Team,</p>
      <p>Please find attached the <b>${clean(title)}</b>${machineLine} for <b>${clean(period || "the selected period")}</b>.</p>
      <p>The PDF contains machine-wise summary, employee-wise summary, and detailed work nature records for review and action.</p>
      <p>Regards,<br><b>SP WorkTrack</b></p>
    </div>`;

  return { plain, html };
}

async function sendReworkOtherReport({ reportType = "rework", period = "", machine = "All", html = "", to = "", cc = "", pdfHtml = "" } = {}) {
  const recipientsData = await getReworkOtherReportRecipients();
  const targets = buildTargets({ to, cc, recipients: recipientsData.recipients });
  if (!targets.to.length) {
    const err = new Error(targets.invalid.length ? `No valid main recipient found. Invalid: ${targets.invalid.join(", ")}` : "No active main recipient found. Add at least one Main Recipient in Rework / Other Work report emails.");
    err.status = 400;
    throw err;
  }

  const title = clean(reportType).toLowerCase() === "other" ? "Other Work Report" : "Rework Report";
  const subject = `SP WorkTrack ${title} - ${period || "Selected Period"}${machine && machine !== "All" ? " - " + machine : ""}`;
  const reportHtml = clean(pdfHtml || html);
  const attachments = [];

  if (reportHtml) {
    const pdfBuffer = await generatePdfFromHtml(reportHtml);
    attachments.push({ filename: `${title.replace(/\s+/g, "_")}_${safeFilePart(period)}.pdf`, content: pdfBuffer, contentType: "application/pdf" });
  }

  const body = buildMailBody({ title, period, machine });
  const primaryTo = targets.to[0];
  const copied = Array.from(new Set([...targets.to.slice(1), ...targets.cc]));
  const result = await sendEmail({ to: primaryTo, cc: copied.join(", "), subject, text: body.plain, html: body.html, attachments });

  return { sent: result.accepted?.length || targets.to.length, mainRecipients: targets.to, ccRecipients: targets.cc, attachmentCount: attachments.length, skippedInvalidRecipients: targets.invalid, results: [{ email: primaryTo, cc: copied.join(", "), ...result }] };
}

module.exports = { getReworkOtherReportRecipients, saveReworkOtherReportRecipients, sendReworkOtherReport };
