// server/services/capacityPlanEmailService.js
// Stores capacity production plan recipients and sends plan emails with PDF attachment.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { sendEmail } = require("./emailService");
const { generatePdfFromHtml } = require("./pdfReportService");

const COLLECTION = "admin_settings";
const RECIPIENTS_KEY = "capacity_plan_recipients_json";

function clean(value) { return String(value ?? "").trim(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)); }
function safeJsonParse(value, fallback) { try { const parsed = JSON.parse(value || ""); return parsed && typeof parsed === "object" ? parsed : fallback; } catch { return fallback; } }
function isMissingCollectionError(err) { return err?.status === 404 || /missing collection context/i.test(String(err?.message || "")); }
function safeFilePart(value) { return clean(value || "Production_Plan").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Production_Plan"; }

async function findSettingRecord(settingKey) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1, filter: `setting_key=\"${settingKey}\"` }
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
    id: clean(r.id || `CP${index + 1}`),
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

async function getCapacityPlanRecipients() {
  const rec = await findSettingRecord(RECIPIENTS_KEY);
  const parsed = safeJsonParse(rec?.setting_value, { recipients: [] });
  return { recipients: normalizeRecipients(parsed) };
}

async function saveCapacityPlanRecipients(raw = {}) {
  const data = { recipients: normalizeRecipients(raw) };
  return await saveSettingJson(RECIPIENTS_KEY, data);
}

async function sendCapacityPlan({ period = "", html = "", text = "", to = "", cc = "", pdfHtml = "" } = {}) {
  const recipientsData = await getCapacityPlanRecipients();
  const targets = buildTargets({ to, cc, recipients: recipientsData.recipients });
  if (!targets.to.length) {
    const err = new Error(targets.invalid.length ? `No valid main recipient found. Invalid: ${targets.invalid.join(", ")}` : "No active main recipient found. Add at least one Main Recipient in Admin screen.");
    err.status = 400;
    throw err;
  }

  const cleanPeriod = clean(period || "Selected Period");
  const subject = `SP WorkTrack Production Plan - ${cleanPeriod}`;
  const reportHtml = clean(pdfHtml || html);
  const attachments = [];
  if (reportHtml) attachments.push({ filename: `Production_Plan_${safeFilePart(cleanPeriod)}.pdf`, content: await generatePdfFromHtml(reportHtml), contentType: "application/pdf" });

  const bodyText = text || `SP WorkTrack Production Plan\nPeriod: ${cleanPeriod}\n\nPDF report is attached.`;
  const bodyHtml = html || `<div style="font-family:Arial,sans-serif;line-height:1.5;"><h2>SP WorkTrack Production Plan</h2><p><b>Period:</b> ${cleanPeriod}</p><p>Please find attached PDF report.</p></div>`;
  const primaryTo = targets.to[0];
  const copied = Array.from(new Set([...targets.to.slice(1), ...targets.cc]));
  const result = await sendEmail({ to: primaryTo, cc: copied.join(", "), subject, text: bodyText, html: bodyHtml, attachments });

  return { sent: result.accepted?.length || targets.to.length, mainRecipients: targets.to, ccRecipients: targets.cc, attachmentCount: attachments.length, skippedInvalidRecipients: targets.invalid, results: [{ email: primaryTo, cc: copied.join(", "), ...result }] };
}

module.exports = { getCapacityPlanRecipients, saveCapacityPlanRecipients, sendCapacityPlan };
