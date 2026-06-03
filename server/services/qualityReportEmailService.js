// server/services/qualityReportEmailService.js
// Stores quality report email recipients, observations and sends report emails.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { sendEmail } = require("./emailService");
const { generatePdfFromHtml } = require("./pdfReportService");

const COLLECTION = "admin_settings";
const RECIPIENTS_KEY = "quality_report_recipients_json";
const OBSERVATIONS_KEY = "quality_report_observations_json";

function clean(value) { return String(value ?? "").trim(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)); }
function machineKey(value) { return clean(value).toUpperCase(); }

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
  if (rec?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, { method: "PATCH", body });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  }
  return data;
}

function normalizeRecipient(r = {}, index = 0) {
  const type = clean(r.type || r.recipientType || "to").toLowerCase() === "cc" ? "cc" : "to";
  return {
    id: clean(r.id || `R${index + 1}`),
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

function safeFilePart(value) {
  return clean(value || "Report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Report";
}

async function getQualityReportRecipients() {
  const rec = await findSettingRecord(RECIPIENTS_KEY);
  const parsed = safeJsonParse(rec?.setting_value, { recipients: [] });
  return { recipients: normalizeRecipients(parsed) };
}

async function saveQualityReportRecipients(raw = {}) {
  const data = { recipients: normalizeRecipients(raw) };
  return await saveSettingJson(RECIPIENTS_KEY, data);
}

async function getQualityReportObservation(machineNo = "") {
  const key = machineKey(machineNo);
  if (!key) return { machineNo: clean(machineNo), observation: "", updatedAt: "" };
  const rec = await findSettingRecord(OBSERVATIONS_KEY);
  const parsed = safeJsonParse(rec?.setting_value, { observations: {} });
  const item = parsed?.observations?.[key] || {};
  return { machineNo: clean(machineNo), observation: clean(item.observation || item.text || ""), updatedAt: clean(item.updatedAt || "") };
}

async function saveQualityReportObservation({ machineNo = "", observation = "" } = {}) {
  const key = machineKey(machineNo);
  if (!key) {
    const err = new Error("Machine No is required to save observation.");
    err.status = 400;
    throw err;
  }
  const rec = await findSettingRecord(OBSERVATIONS_KEY);
  const parsed = safeJsonParse(rec?.setting_value, { observations: {} });
  const observations = parsed.observations && typeof parsed.observations === "object" ? parsed.observations : {};
  observations[key] = { machineNo: clean(machineNo), observation: clean(observation), updatedAt: new Date().toISOString() };
  await saveSettingJson(OBSERVATIONS_KEY, { observations });
  return await getQualityReportObservation(machineNo);
}

function splitManualEmails(value = "") {
  return clean(value).split(/[;,]/).map(clean).filter(Boolean);
}

function buildTargets({ to = "", cc = "", recipients = [] } = {}) {
  const active = recipients.filter((r) => r.active && r.email);
  const rawTo = clean(to) ? splitManualEmails(to) : active.filter((r) => r.type !== "cc").map((r) => clean(r.email));
  const rawCc = clean(cc) ? splitManualEmails(cc) : active.filter((r) => r.type === "cc").map((r) => clean(r.email));
  const invalid = [];
  const validTo = [];
  const validCc = [];
  rawTo.forEach((email) => isValidEmail(email) ? validTo.push(email) : invalid.push(email));
  rawCc.forEach((email) => isValidEmail(email) ? validCc.push(email) : invalid.push(email));
  const toSet = new Set(validTo.map((e) => e.toLowerCase()));
  const ccFiltered = validCc.filter((email) => !toSet.has(email.toLowerCase()));
  return { to: Array.from(new Set(validTo)), cc: Array.from(new Set(ccFiltered)), invalid: Array.from(new Set(invalid)) };
}

async function sendQualityReport({ machineNo = "", machineCategory = "", period = "", html = "", text = "", to = "", cc = "", pdfHtml = "" } = {}) {
  const recipientsData = await getQualityReportRecipients();
  const targets = buildTargets({ to, cc, recipients: recipientsData.recipients });
  if (!targets.to.length) {
    const err = new Error(targets.invalid.length ? `No valid main recipient found. Invalid: ${targets.invalid.join(", ")}` : "No active main recipient found. Add at least one Main Recipient in Admin screen.");
    err.status = 400;
    throw err;
  }

  const subject = `SP WorkTrack Quality Report - ${clean(machineNo) || "Machine"}${period ? " - " + period : ""}`;
  const attachments = [];
  if (clean(pdfHtml || html)) {
    const pdfBuffer = await generatePdfFromHtml(pdfHtml || html);
    attachments.push({ filename: `Quality_Report_${safeFilePart(machineNo)}.pdf`, content: pdfBuffer, contentType: "application/pdf" });
  }
  const bodyText = text || `SP WorkTrack Quality Report\nMachine: ${machineNo}\nCategory: ${machineCategory}\nPeriod: ${period}\n\nPDF report is attached.`;
  const bodyHtml = html || `<div style="font-family:Arial,sans-serif;line-height:1.5;"><h2>SP WorkTrack Quality Report</h2><p><b>Machine:</b> ${clean(machineNo)}</p><p><b>Category:</b> ${clean(machineCategory)}</p><p><b>Period:</b> ${clean(period)}</p><p>Please find attached PDF report.</p></div>`;

  const primaryTo = targets.to[0];
  const copied = Array.from(new Set([...targets.to.slice(1), ...targets.cc]));
  const result = await sendEmail({ to: primaryTo, cc: copied.join(", "), subject, text: bodyText, html: bodyHtml, attachments });

  return { sent: result.accepted?.length || targets.to.length, mainRecipients: targets.to, ccRecipients: targets.cc, attachmentCount: attachments.length, skippedInvalidRecipients: targets.invalid, results: [{ email: primaryTo, cc: copied.join(", "), ...result }] };
}

module.exports = { getQualityReportRecipients, saveQualityReportRecipients, getQualityReportObservation, saveQualityReportObservation, sendQualityReport };
