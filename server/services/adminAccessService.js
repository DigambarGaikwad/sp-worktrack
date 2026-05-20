// server/services/adminAccessService.js
// Role based admin access stored inside existing admin_settings collection.
// This avoids extra PocketBase collection migration for the first RBAC version.

const crypto = require("crypto");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");
const { verifyAdminPin } = require("./adminPinService");

const COLLECTION = "admin_settings";
const ACCESS_KEY = "admin_access_users_json";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const ALL_PERMISSIONS = [
  "machines",
  "employees",
  "shifts",
  "lossReasons",
  "rootAreas",
  "workStandards",
  "plannedAbsence",
  "skillMatrix",
  "pin",
  "userAccess"
];

const ROLE_TEMPLATES = {
  admin: ALL_PERMISSIONS,
  supervisor: ["machines", "employees", "plannedAbsence", "skillMatrix"],
  engineer: ["lossReasons", "rootAreas", "workStandards", "skillMatrix"]
};

const sessions = new Map();

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeUsername(value) {
  return clean(value).toLowerCase();
}

function hashPin(pin, salt) {
  return crypto.createHash("sha256").update(`${salt}:${clean(pin)}`).digest("hex");
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

async function findSettingRecord(key) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "GET",
      query: {
        page: 1,
        perPage: 1,
        filter: `setting_key="${key}"`
      }
    });
    return Array.isArray(result.items) ? result.items[0] || null : null;
  } catch (err) {
    if (isMissingCollectionError(err)) return null;
    throw err;
  }
}

async function getStoredUsers() {
  const rec = await findSettingRecord(ACCESS_KEY);
  const users = safeJsonParse(rec?.setting_value, []);
  return Array.isArray(users) ? users : [];
}

function publicUser(user) {
  return {
    username: normalizeUsername(user.username),
    displayName: clean(user.displayName || user.display_name || user.username),
    role: clean(user.role || "supervisor") || "supervisor",
    permissions: normalizePermissions(user.permissions || ROLE_TEMPLATES[user.role] || []),
    active: user.active !== false
  };
}

function normalizePermissions(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  return Array.from(new Set(list.map(clean).filter((p) => ALL_PERMISSIONS.includes(p))));
}

function userCan(user, permission) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (Array.isArray(user.permissions) && user.permissions.includes("all")) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

async function saveStoredUsers(users) {
  const sanitized = users
    .map((u) => ({
      username: normalizeUsername(u.username),
      displayName: clean(u.displayName || u.display_name || u.username),
      role: clean(u.role || "supervisor") || "supervisor",
      salt: clean(u.salt),
      pinHash: clean(u.pinHash || u.pin_hash),
      permissions: normalizePermissions(u.permissions || ROLE_TEMPLATES[u.role] || []),
      active: u.active !== false
    }))
    .filter((u) => u.username && u.pinHash);

  const rec = await findSettingRecord(ACCESS_KEY);
  const body = {
    setting_key: ACCESS_KEY,
    setting_value: JSON.stringify(sanitized)
  };

  if (rec?.id) {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, {
      method: "PATCH",
      body
    });
  } else {
    await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, {
      method: "POST",
      body
    });
  }

  return sanitized.map(publicUser);
}

async function listAccessUsers() {
  const users = await getStoredUsers();
  return {
    permissions: ALL_PERMISSIONS,
    roleTemplates: ROLE_TEMPLATES,
    users: users.map(publicUser)
  };
}

async function upsertAccessUsers(incoming = []) {
  const existing = await getStoredUsers();
  const existingByUsername = new Map(existing.map((u) => [normalizeUsername(u.username), u]));

  const users = (Array.isArray(incoming) ? incoming : []).map((raw) => {
    const username = normalizeUsername(raw.username);
    const old = existingByUsername.get(username) || {};
    const newPin = clean(raw.pin || raw.newPin);
    const salt = clean(old.salt) || crypto.randomBytes(12).toString("hex");

    return {
      username,
      displayName: clean(raw.displayName || raw.display_name || old.displayName || username),
      role: clean(raw.role || old.role || "supervisor") || "supervisor",
      salt,
      pinHash: newPin ? hashPin(newPin, salt) : clean(old.pinHash || old.pin_hash),
      permissions: normalizePermissions(raw.permissions || old.permissions || ROLE_TEMPLATES[raw.role] || []),
      active: raw.active !== false
    };
  }).filter((u) => u.username && u.pinHash);

  return saveStoredUsers(users);
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  const sessionUser = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    permissions: user.permissions,
    active: user.active !== false
  };

  sessions.set(token, {
    user: sessionUser,
    expiresAt: Date.now() + SESSION_TTL_MS
  });

  return { token, user: sessionUser };
}

async function loginAdminAccess({ username = "", pin = "" } = {}) {
  const uname = normalizeUsername(username || "admin");
  const enteredPin = clean(pin);

  if (!enteredPin) {
    const err = new Error("PIN is required.");
    err.status = 400;
    throw err;
  }

  // Existing admin PIN remains the super-admin login.
  if (!uname || uname === "admin" || uname === "superadmin" || uname === "super_admin") {
    const valid = await verifyAdminPin(enteredPin);
    if (!valid) return { valid: false };
    return {
      valid: true,
      ...createSession({
        username: "admin",
        displayName: "Super Admin",
        role: "super_admin",
        permissions: ["all"],
        active: true
      })
    };
  }

  const users = await getStoredUsers();
  const user = users.find((u) => normalizeUsername(u.username) === uname && u.active !== false);
  if (!user?.pinHash || !user?.salt) return { valid: false };

  const valid = hashPin(enteredPin, user.salt) === user.pinHash;
  if (!valid) return { valid: false };

  return {
    valid: true,
    ...createSession(publicUser(user))
  };
}

function getSession(token) {
  const rawToken = clean(token);
  if (!rawToken) return null;
  const session = sessions.get(rawToken);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(rawToken);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function requirePermission(token, permission) {
  const session = getSession(token);
  if (!session?.user) {
    const err = new Error("Login session required.");
    err.status = 401;
    throw err;
  }
  if (!userCan(session.user, permission)) {
    const err = new Error(`Permission required: ${permission}`);
    err.status = 403;
    throw err;
  }
  return session.user;
}

function getSessionUser(token) {
  return getSession(token)?.user || null;
}

module.exports = {
  ALL_PERMISSIONS,
  ROLE_TEMPLATES,
  listAccessUsers,
  upsertAccessUsers,
  loginAdminAccess,
  requirePermission,
  getSessionUser,
  userCan
};
