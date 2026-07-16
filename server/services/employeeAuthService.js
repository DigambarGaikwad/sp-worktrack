// server/services/employeeAuthService.js
// Employee production-entry authentication. Passwords are salted hashes in admin_settings.

const crypto = require("crypto");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const SETTING_KEY = "employee_passwords_json";
const SESSION_TTL_MS = 10 * 60 * 60 * 1000;
const sessions = new Map();

function clean(value) { return String(value ?? "").trim(); }
function normEmp(value) { return clean(value).toUpperCase(); }
function hashPassword(password, salt) { return crypto.createHash("sha256").update(`${salt}:${clean(password)}`).digest("hex"); }
function safeJsonParse(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function isMissingCollectionError(err) { return err?.status === 404 || /missing collection context/i.test(String(err?.message || "")); }

async function findSettingRecord(key) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1, filter: `setting_key="${key}"` }
    });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) {
    if (isMissingCollectionError(err)) return null;
    throw err;
  }
}

async function getStoredEmployeePasswords() {
  const rec = await findSettingRecord(SETTING_KEY);
  const rows = safeJsonParse(rec?.setting_value, []);
  return Array.isArray(rows) ? rows : [];
}

async function saveStoredEmployeePasswords(rows) {
  const sanitized = (Array.isArray(rows) ? rows : [])
    .map((x) => ({
      empCode: normEmp(x.empCode || x.emp_code || x.code),
      empName: clean(x.empName || x.emp_name || x.name),
      salt: clean(x.salt),
      passwordHash: clean(x.passwordHash || x.password_hash),
      active: x.active !== false,
      updatedAt: clean(x.updatedAt || x.updated_at || new Date().toISOString())
    }))
    .filter((x) => x.empCode && x.salt && x.passwordHash);

  const rec = await findSettingRecord(SETTING_KEY);
  const body = { setting_key: SETTING_KEY, setting_value: JSON.stringify(sanitized) };
  if (rec?.id) await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, { method: "PATCH", body });
  else await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  return sanitized;
}

async function listEmployeePasswordStatus() {
  const rows = await getStoredEmployeePasswords();
  return rows.map((x) => ({ empCode: normEmp(x.empCode), empName: clean(x.empName), hasPassword: !!(x.salt && x.passwordHash), active: x.active !== false, updatedAt: clean(x.updatedAt) }));
}

async function resetEmployeePassword({ empCode, empName, password, newPassword, pin } = {}) {
  const code = normEmp(empCode || "");
  const nextPassword = clean(password || newPassword || pin);
  if (!code) { const err = new Error("Employee code is required."); err.status = 400; throw err; }
  if (!nextPassword || nextPassword.length < 4) { const err = new Error("Employee password must be at least 4 characters."); err.status = 400; throw err; }

  const rows = await getStoredEmployeePasswords();
  const oldMap = new Map(rows.map((x) => [normEmp(x.empCode), x]));
  const salt = crypto.randomBytes(12).toString("hex");
  oldMap.set(code, {
    empCode: code,
    empName: clean(empName || oldMap.get(code)?.empName || ""),
    salt,
    passwordHash: hashPassword(nextPassword, salt),
    active: true,
    updatedAt: new Date().toISOString()
  });
  const saved = await saveStoredEmployeePasswords(Array.from(oldMap.values()));
  return { empCode: code, hasPassword: true, updatedAt: saved.find((x) => normEmp(x.empCode) === code)?.updatedAt || "" };
}

function createEmployeeSession(empCode) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { empCode: normEmp(empCode), expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

async function loginEmployee({ empCode, password, pin } = {}) {
  const code = normEmp(empCode);
  const entered = clean(password || pin);
  if (!code) { const err = new Error("Employee code is required."); err.status = 400; throw err; }
  if (!entered) { const err = new Error("Employee password is required."); err.status = 400; throw err; }

  const rows = await getStoredEmployeePasswords();
  const row = rows.find((x) => normEmp(x.empCode) === code && x.active !== false);
  if (!row?.salt || !row?.passwordHash) {
    const err = new Error("Employee password is not set. Ask admin to reset password in Employees tab.");
    err.status = 403;
    err.details = { reasonCode: "EMPLOYEE_PASSWORD_NOT_SET", empCode: code };
    throw err;
  }
  if (hashPassword(entered, row.salt) !== row.passwordHash) {
    const err = new Error("Wrong employee password.");
    err.status = 401;
    err.details = { reasonCode: "EMPLOYEE_PASSWORD_NOT_MATCHED", empCode: code };
    throw err;
  }
  const token = createEmployeeSession(code);
  return { valid: true, empCode: code, token, expiresInMinutes: Math.round(SESSION_TTL_MS / 60000) };
}

function verifyEmployeeSessionToken(empCode, token) {
  const code = normEmp(empCode);
  const rawToken = clean(token);
  if (!code || !rawToken) return false;
  const session = sessions.get(rawToken);
  if (!session) return false;
  if (Date.now() > session.expiresAt) { sessions.delete(rawToken); return false; }
  if (session.empCode !== code) return false;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

async function assertEmployeeAuthForSubmit(payload = {}) {
  const empCode = normEmp(payload.empCode || payload.empId || payload.employeeId || payload.teamMemberId);
  const token = clean(payload.employeeAuthToken || payload.employee_auth_token || payload.empAuthToken);
  if (verifyEmployeeSessionToken(empCode, token)) return true;

  const err = new Error("Employee password verification required before production entry submit.");
  err.status = 401;
  err.details = { reasonCode: "EMPLOYEE_AUTH_REQUIRED", empCode };
  throw err;
}

module.exports = { listEmployeePasswordStatus, resetEmployeePassword, loginEmployee, verifyEmployeeSessionToken, assertEmployeeAuthForSubmit };
