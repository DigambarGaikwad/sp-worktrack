// server/services/systemInfoService.js
// Detects current app URLs, network addresses, and safe configuration details.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

function clean(value) {
  return String(value ?? "").trim();
}

function isPrivateLanIp(ip) {
  const parts = clean(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n))) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isTailscaleIp(ip) {
  const parts = clean(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n))) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function appUrl(ip, port) {
  return `http://${ip}:${port}`;
}

function getIpv4Addresses() {
  const result = [];
  const nets = os.networkInterfaces();

  for (const [name, addresses] of Object.entries(nets)) {
    for (const item of addresses || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const ip = item.address;
      if (!ip || ip.startsWith("169.254.")) continue;

      result.push({
        name,
        ip,
        type: isTailscaleIp(ip) ? "tailscale" : isPrivateLanIp(ip) ? "lan" : "other"
      });
    }
  }

  return result.sort((a, b) => {
    const order = { lan: 0, tailscale: 1, other: 2 };
    return (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name);
  });
}

function execFileText(command, args = [], timeout = 2500) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: clean(stderr || err.message) });
      resolve({ ok: true, text: clean(stdout) });
    });
  });
}

async function getTailscaleIpsFromCli() {
  const out = await execFileText("tailscale", ["ip", "-4"]);
  if (!out.ok) return { ok: false, error: out.error, ips: [] };
  const ips = out.text.split(/\s+/).map(clean).filter(isTailscaleIp);
  return { ok: true, ips };
}

function buildRequestUrl(req, port) {
  const protocol = clean(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0] || "http";
  const host = clean(req.headers.host || `localhost:${port}`);
  return `${protocol}://${host}`;
}

function isSensitiveEnvKey(key) {
  return /(?:PASS|PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE|CREDENTIAL)/i.test(clean(key));
}

function maskSecret(value) {
  return clean(value) ? "********" : "";
}

function maskEmail(value) {
  const email = clean(value);
  return email ? email.replace(/^(.{2}).*(@.*)$/u, "$1***$2") : "";
}

function safeEnvValue(key, value) {
  return isSensitiveEnvKey(key) ? maskSecret(value) : clean(value);
}

function readTextFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return "";
  }
}

function sanitizeEnvContent(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return line;
      const key = trimmed.split("=")[0].trim();
      if (!isSensitiveEnvKey(key)) return line;
      return `${key}=${maskSecret(trimmed.slice(key.length + 1))}`;
    })
    .join("\n");
}

function envSummary(keys = []) {
  return keys.map(key => ({ key, value: safeEnvValue(key, process.env[key] || ""), sensitive: isSensitiveEnvKey(key) }));
}

function getConfigInfo(rootDir) {
  const envPath = path.join(rootDir, ".env");
  const envExamplePath = path.join(rootDir, ".env.example");
  const envContent = readTextFile(envPath);

  return {
    files: {
      env: { path: envPath, exists: fs.existsSync(envPath) },
      envExample: { path: envExamplePath, exists: fs.existsSync(envExamplePath) }
    },
    sanitizedEnvContent: sanitizeEnvContent(envContent),
    envSummary: envSummary([
      "SPWT_API_PORT",
      "SPWT_STORAGE_MODE",
      "POCKETBASE_URL",
      "POCKETBASE_SUPERUSER_EMAIL",
      "POCKETBASE_SUPERUSER_PASSWORD",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "SMTP_USER",
      "SMTP_PASS",
      "MAIL_FROM",
      "GOOGLE_SHEET_BACKUP_ENABLED",
      "GOOGLE_SHEET_WEBAPP_URL",
      "GOOGLE_SHEET_BACKUP_SECRET",
      "GOOGLE_SHEET_BACKUP_TIMEOUT_MS"
    ]),
    pocketbase: {
      url: clean(process.env.POCKETBASE_URL || "http://127.0.0.1:8090"),
      superuserEmail: maskEmail(process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.POCKETBASE_ADMIN_EMAIL || ""),
      hasSuperuserPassword: !!clean(process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.POCKETBASE_ADMIN_PASSWORD || "")
    },
    email: {
      host: clean(process.env.SMTP_HOST || ""),
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
      user: maskEmail(process.env.SMTP_USER || ""),
      hasPassword: !!clean(process.env.SMTP_PASS || ""),
      from: clean(process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "")
    },
    googleSheetBackup: {
      enabled: String(process.env.GOOGLE_SHEET_BACKUP_ENABLED || "false").toLowerCase() === "true",
      webAppUrl: clean(process.env.GOOGLE_SHEET_WEBAPP_URL || ""),
      hasSecret: !!clean(process.env.GOOGLE_SHEET_BACKUP_SECRET || ""),
      timeoutMs: Number(process.env.GOOGLE_SHEET_BACKUP_TIMEOUT_MS || 15000),
      schedulerIntervalMs: Number(process.env.GOOGLE_SHEET_BACKUP_SCHEDULER_INTERVAL_MS || 60000)
    }
  };
}

async function getSystemInfo(req) {
  const port = Number(process.env.SPWT_API_PORT || 3030);
  const rootDir = process.cwd();
  const interfaces = getIpv4Addresses();
  const lan = interfaces.filter(i => i.type === "lan").map(i => ({ ...i, url: appUrl(i.ip, port) }));
  const tsFromInterface = interfaces.filter(i => i.type === "tailscale").map(i => i.ip);
  const tsCli = await getTailscaleIpsFromCli();
  const tsIps = Array.from(new Set([...tsFromInterface, ...(tsCli.ips || [])]));
  const tailscale = tsIps.map(ip => ({ ip, url: appUrl(ip, port) }));

  return {
    generatedAt: new Date().toISOString(),
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      nodeVersion: process.version,
      pid: process.pid,
      port,
      rootDir
    },
    current: {
      apiOrigin: buildRequestUrl(req, port),
      browserUrl: clean(req.query?.currentUrl || req.headers.referer || ""),
      homeFromRequest: `${buildRequestUrl(req, port)}/index.html`
    },
    urls: {
      localhost: appUrl("localhost", port),
      lan,
      tailscale
    },
    network: {
      interfaces,
      tailscaleCli: tsCli.ok ? "ok" : `not available: ${tsCli.error || "unknown"}`
    },
    config: getConfigInfo(rootDir),
    notes: [
      "Use LAN URL for devices on the same WiFi/LAN.",
      "Use Tailscale URL for approved VPN devices.",
      "localhost works only on the server PC.",
      "Passwords and secrets are masked in System Info. Update them only from .env or the future Email Settings screen."
    ]
  };
}

module.exports = { getSystemInfo };
