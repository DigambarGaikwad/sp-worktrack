// server/services/performanceCommentService.js
// Stores employee monthly performance report comments in admin_settings JSON.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "admin_settings";
const COMMENTS_KEY = "employee_performance_comments_json";

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function safeJsonParse(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function isMissingCollectionError(err) { return err?.status === 404 || /missing collection context/i.test(String(err?.message || "")); }
function keyOf(x) { return [clean(x.year), clean(x.month), clean(x.empCode).toLowerCase() || clean(x.empName).toLowerCase()].join("|"); }

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

async function readAllComments() {
  const rec = await findSettingRecord(COMMENTS_KEY);
  const rows = safeJsonParse(rec?.setting_value, []);
  return Array.isArray(rows) ? rows.map(normalizeComment).filter((x) => x.year && x.month && (x.empCode || x.empName)) : [];
}

async function writeAllComments(rows) {
  const cleanRows = rows.map(normalizeComment).filter((x) => x.year && x.month && (x.empCode || x.empName));
  const rec = await findSettingRecord(COMMENTS_KEY);
  const body = { setting_key: COMMENTS_KEY, setting_value: JSON.stringify(cleanRows) };
  if (rec?.id) await pocketBaseRequest(`/api/collections/${COLLECTION}/records/${rec.id}`, { method: "PATCH", body });
  else await pocketBaseRequest(`/api/collections/${COLLECTION}/records`, { method: "POST", body });
  return cleanRows;
}

function normalizeComment(input = {}) {
  const year = num(input.year, new Date().getFullYear());
  const month = Math.min(12, Math.max(1, num(input.month, new Date().getMonth() + 1)));
  return {
    year,
    month,
    empCode: clean(input.empCode || input.emp_code || input.code),
    empName: clean(input.empName || input.emp_name || input.name),
    department: clean(input.department),
    positives: clean(input.positives),
    negatives: clean(input.negatives),
    initiatives: clean(input.initiatives),
    multiSkillInitiative: clean(input.multiSkillInitiative || input.multi_skill_initiative || input.multiskillInitiative),
    updatedAt: clean(input.updatedAt) || new Date().toISOString()
  };
}

async function listPerformanceComments(query = {}) {
  const rows = await readAllComments();
  const year = clean(query.year);
  const month = clean(query.month);
  const empCode = clean(query.empCode || query.emp_code || query.code).toLowerCase();
  const empName = clean(query.empName || query.emp_name || query.name || query.employee).toLowerCase();

  return rows.filter((x) => {
    if (year && clean(x.year) !== year) return false;
    if (month && clean(x.month) !== month) return false;
    if (empCode && clean(x.empCode).toLowerCase() !== empCode) return false;
    if (!empCode && empName && clean(x.empName).toLowerCase() !== empName) return false;
    return true;
  });
}

async function getPerformanceComment(query = {}) {
  const rows = await listPerformanceComments(query);
  return rows[0] || null;
}

async function savePerformanceComment(input = {}) {
  const row = normalizeComment(input);
  if (!row.empCode && !row.empName) {
    const err = new Error("Employee is required for performance comment.");
    err.status = 400;
    throw err;
  }

  const rows = await readAllComments();
  const map = new Map(rows.map((x) => [keyOf(x), x]));
  map.set(keyOf(row), { ...row, updatedAt: new Date().toISOString() });
  const saved = await writeAllComments(Array.from(map.values()));
  return saved.find((x) => keyOf(x) === keyOf(row)) || row;
}

module.exports = { listPerformanceComments, getPerformanceComment, savePerformanceComment };
