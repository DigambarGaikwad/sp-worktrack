// server/adapters/pocketbaseClient.js
// PocketBase REST client with server-side superuser authentication.
// Frontend never talks directly to PocketBase.

const PB_URL = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";
const PB_TIMEOUT_MS = Number(process.env.POCKETBASE_TIMEOUT_MS || 12000);

let authToken = "";
let authTokenTime = 0;

function buildPocketBaseUrl(path, queryParams = {}) {
  const url = new URL(path, PB_URL);
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PB_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      const error = new Error(`PocketBase request timed out after ${timeoutMs} ms`);
      error.status = 504;
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function authenticatePocketBase() {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD;
  if (!email || !password) throw new Error("PocketBase superuser email/password missing in .env");

  const now = Date.now();
  if (authToken && now - authTokenTime < 30 * 60 * 1000) return authToken;

  const url = buildPocketBaseUrl("/api/collections/_superusers/auth-with-password");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "PocketBase superuser authentication failed");

  authToken = data.token;
  authTokenTime = Date.now();
  return authToken;
}

async function pocketBaseRequest(path, options = {}) {
  const token = await authenticatePocketBase();
  const url = buildPocketBaseUrl(path, options.query);
  const response = await fetchWithTimeout(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || `PocketBase request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

module.exports = { PB_URL, pocketBaseRequest };
