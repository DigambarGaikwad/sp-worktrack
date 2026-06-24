// server/services/systemConfigService.js
// Reads and updates selected .env settings from the Admin System Settings tab.

const fs = require("fs");
const path = require("path");

const SECRET_KEYS = new Set([
  "POCKETBASE_SUPERUSER_PASSWORD",
  "POCKETBASE_ADMIN_PASSWORD",
  "SMTP_PASS",
  "GOOGLE_SHEET_BACKUP_SECRET"
]);

const EDITABLE_KEYS = [
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
  "GOOGLE_SHEET_BACKUP_TIMEOUT_MS",
  "GOOGLE_SHEET_BACKUP_SCHEDULER_INTERVAL_MS"
];

const SECTION_KEYS = {
  pocketbase: ["POCKETBASE_URL", "POCKETBASE_SUPERUSER_EMAIL", "POCKETBASE_SUPERUSER_PASSWORD"],
  email: ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"],
  googleSheetBackup: ["GOOGLE_SHEET_BACKUP_ENABLED", "GOOGLE_SHEET_WEBAPP_URL", "GOOGLE_SHEET_BACKUP_SECRET", "GOOGLE_SHEET_BACKUP_TIMEOUT_MS", "GOOGLE_SHEET_BACKUP_SCHEDULER_INTERVAL_MS"]
};

function clean(value) {
  return String(value ?? "").trim();
}

function runtimeRoot(rootDir = process.cwd()) {
  return process.env.SPWT_RUNTIME_ROOT || rootDir;
}

function envPath(rootDir = process.cwd()) {
  return process.env.SPWT_ENV_FILE || path.join(runtimeRoot(rootDir), ".env");
}

function envExamplePath(rootDir = process.cwd()) {
  const appRoot = process.env.SPWT_APP_ROOT || rootDir;
  return path.join(appRoot, ".env.example");
}

function readEnvFile(rootDir = process.cwd()) {
  const file = envPath(rootDir);
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

function unquote(value = "") {
  const text = String(value ?? "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseEnv(text = "") {
  const values = {};
  const lines = String(text || "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    values[key] = unquote(line.slice(idx + 1));
  }

  return values;
}

function quoteEnvValue(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (/\s|#|"/.test(text)) return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return text;
}

function maskedSecret(value) {
  return clean(value) ? "********" : "";
}

function publicValue(key, values) {
  const value = values[key] ?? process.env[key] ?? "";
  if (SECRET_KEYS.has(key)) return "";
  return clean(value);
}

function hasSecret(key, values) {
  return SECRET_KEYS.has(key) && Boolean(clean(values[key] ?? process.env[key] ?? ""));
}

function settingObject(key, values) {
  return {
    key,
    value: publicValue(key, values),
    sensitive: SECRET_KEYS.has(key),
    hasValue: SECRET_KEYS.has(key) ? hasSecret(key, values) : Boolean(clean(values[key] ?? process.env[key] ?? "")),
    maskedValue: SECRET_KEYS.has(key) ? maskedSecret(values[key] ?? process.env[key] ?? "") : clean(values[key] ?? process.env[key] ?? "")
  };
}

function buildSections(values) {
  return Object.fromEntries(Object.entries(SECTION_KEYS).map(([section, keys]) => [
    section,
    Object.fromEntries(keys.map(key => [key, settingObject(key, values)]))
  ]));
}

function getSystemConfig(rootDir = process.cwd()) {
  const file = envPath(rootDir);
  const example = envExamplePath(rootDir);
  const values = parseEnv(readEnvFile(rootDir));

  return {
    envPath: file,
    envExists: fs.existsSync(file),
    envExamplePath: example,
    envExampleExists: fs.existsSync(example),
    runtimeRoot: runtimeRoot(rootDir),
    sections: buildSections(values),
    notes: [
      "Secret fields are not displayed. Leave secret inputs blank to keep the existing saved value.",
      "Email and Google Sheet settings update process.env immediately for the running Node server.",
      "PocketBase superuser changes are saved to the writable runtime .env for future runtime setup; direct PocketBase user password changes still belong in PocketBase admin/maintenance flow.",
      "Restart SP WorkTrack after major configuration changes if any service still uses old values."
    ]
  };
}

function splitLine(line) {
  const idx = line.indexOf("=");
  if (idx < 0) return null;
  const key = line.slice(0, idx).trim();
  return key ? { key, value: line.slice(idx + 1) } : null;
}

function normalizeIncoming(raw = {}) {
  const input = raw.settings || raw.data || raw;
  const result = {};
  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) result[key] = clean(input[key]);
  }
  return result;
}

function shouldSkipSecretUpdate(key, value, clearKeys) {
  if (!SECRET_KEYS.has(key)) return false;
  if (Array.isArray(clearKeys) && clearKeys.includes(key)) return false;
  return !clean(value);
}

function buildUpdatedEnv(existingText, updates, clearKeys = []) {
  const lines = String(existingText || "").split(/\r?\n/);
  const seen = new Set();
  const clearSet = new Set(Array.isArray(clearKeys) ? clearKeys : []);

  const updatedLines = lines.map((line) => {
    const parsed = splitLine(line);
    if (!parsed || !EDITABLE_KEYS.includes(parsed.key)) return line;

    const key = parsed.key;
    seen.add(key);
    if (!Object.prototype.hasOwnProperty.call(updates, key) && !clearSet.has(key)) return line;
    if (shouldSkipSecretUpdate(key, updates[key], Array.from(clearSet))) return line;

    const value = clearSet.has(key) ? "" : updates[key];
    return `${key}=${quoteEnvValue(value)}`;
  });

  const append = EDITABLE_KEYS
    .filter(key => !seen.has(key) && (Object.prototype.hasOwnProperty.call(updates, key) || clearSet.has(key)))
    .filter(key => !shouldSkipSecretUpdate(key, updates[key], Array.from(clearSet)))
    .map(key => `${key}=${quoteEnvValue(clearSet.has(key) ? "" : updates[key])}`);

  if (append.length) {
    if (updatedLines.length && clean(updatedLines[updatedLines.length - 1])) updatedLines.push("");
    updatedLines.push("# Updated from SP WorkTrack Admin - System Settings");
    updatedLines.push(...append);
  }

  return updatedLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function applyToProcessEnv(updates, clearKeys = []) {
  const clearSet = new Set(Array.isArray(clearKeys) ? clearKeys : []);
  for (const key of EDITABLE_KEYS) {
    if (clearSet.has(key)) {
      process.env[key] = "";
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    if (SECRET_KEYS.has(key) && !clean(updates[key])) continue;
    process.env[key] = clean(updates[key]);
  }
}

function saveSystemConfig(raw = {}, rootDir = process.cwd()) {
  const file = envPath(rootDir);
  const clearKeys = Array.isArray(raw.clearKeys) ? raw.clearKeys.filter(key => SECRET_KEYS.has(key)) : [];
  const updates = normalizeIncoming(raw);
  const existing = readEnvFile(rootDir);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "", "utf8");
  if (existing) {
    const backupPath = `${file}.bak_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.writeFileSync(backupPath, existing, "utf8");
  }

  const nextText = buildUpdatedEnv(existing, updates, clearKeys);
  fs.writeFileSync(file, nextText, "utf8");
  applyToProcessEnv(updates, clearKeys);

  return getSystemConfig(rootDir);
}

module.exports = {
  EDITABLE_KEYS,
  SECRET_KEYS,
  getSystemConfig,
  saveSystemConfig
};
