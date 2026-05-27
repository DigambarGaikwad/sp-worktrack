// server/services/emailService.js
// Reusable SMTP email service for SP WorkTrack notifications.
// Future use: PIN recovery, quality reports, shortage alerts, daily summaries.

const nodemailer = require("nodemailer");

function clean(value) {
  return String(value ?? "").trim();
}

function getSmtpConfig() {
  return {
    host: clean(process.env.SMTP_HOST),
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: clean(process.env.SMTP_USER),
    pass: clean(process.env.SMTP_PASS),
    from: clean(process.env.MAIL_FROM || process.env.SMTP_USER || "SP WorkTrack <no-reply@spworktrack.local>")
  };
}

function isConfigured() {
  const cfg = getSmtpConfig();
  return Boolean(cfg.host && cfg.port && cfg.user && cfg.pass);
}

function ensureConfigured() {
  if (!isConfigured()) {
    const err = new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in .env.");
    err.status = 400;
    err.details = { reasonCode: "SMTP_NOT_CONFIGURED" };
    throw err;
  }
}

function createTransporter() {
  ensureConfigured();
  const cfg = getSmtpConfig();

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass
    }
  });
}

function assertEmail(value, label = "Email") {
  const email = clean(value);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error(`${label} is not valid.`);
    err.status = 400;
    throw err;
  }
  return email;
}

async function sendEmail({ to, cc = "", bcc = "", subject = "", text = "", html = "", attachments = [] } = {}) {
  const cfg = getSmtpConfig();
  const transporter = createTransporter();

  const message = {
    from: cfg.from,
    to: assertEmail(to, "To email"),
    subject: clean(subject) || "SP WorkTrack Notification",
    text: clean(text) || undefined,
    html: clean(html) || undefined
  };

  if (clean(cc)) message.cc = cc;
  if (clean(bcc)) message.bcc = bcc;
  if (Array.isArray(attachments) && attachments.length) message.attachments = attachments;
  if (!message.text && !message.html) message.text = "SP WorkTrack notification.";

  const result = await transporter.sendMail(message);
  return {
    messageId: result.messageId || "",
    accepted: result.accepted || [],
    rejected: result.rejected || []
  };
}

async function sendTestEmail(to) {
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  return sendEmail({
    to,
    subject: "SP WorkTrack SMTP Test Email",
    text: `SMTP test successful.\n\nThis email was sent from SP WorkTrack on ${now}.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;">
        <h2>SP WorkTrack SMTP Test Successful</h2>
        <p>This email was sent from <b>SP WorkTrack</b>.</p>
        <p><b>Time:</b> ${now}</p>
      </div>
    `
  });
}

function getEmailStatus() {
  const cfg = getSmtpConfig();
  return {
    configured: isConfigured(),
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user ? cfg.user.replace(/^(.{2}).*(@.*)$/u, "$1***$2") : "",
    from: cfg.from
  };
}

module.exports = {
  getEmailStatus,
  sendEmail,
  sendTestEmail
};
