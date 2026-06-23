// main.js
// SP WorkTrack Electron Server Launcher
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

let mainWindow = null;
let pocketBaseProcess = null;

function appRoot() {
  return __dirname;
}

function runtimeRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : appRoot();
}

function logLine(message, extra) {
  const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${extra}` : ""}\n`;
  console.log(line.trim());
  try {
    const dir = path.join(runtimeRoot(), "runtime_logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "electron-runtime.log"), line, "utf8");
  } catch (_) {}
}

function asarUnpackedPath(filePath) {
  return filePath && filePath.includes("app.asar")
    ? filePath.replace("app.asar", "app.asar.unpacked")
    : filePath;
}

function findExistingFile(candidates) {
  const checked = [];
  for (const p of candidates) {
    if (!p) continue;
    checked.push(p);
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function loadEnv() {
  const exeDir = path.dirname(process.execPath);
  const envPath = findExistingFile([
    path.join(runtimeRoot(), ".env"),
    path.join(exeDir, ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(appRoot(), ".env")
  ]);

  if (envPath) {
    dotenv.config({ path: envPath });
    logLine("Loaded env", envPath);
  } else {
    logLine("No .env found; using defaults/env vars");
  }
}

function getApiPort() {
  return Number(process.env.SPWT_API_PORT || 3030);
}

function getApiUrl() {
  return `http://127.0.0.1:${getApiPort()}`;
}

function getPocketBaseUrl() {
  return String(process.env.POCKETBASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
}

async function fetchJson(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function isHealthy(url) {
  try {
    const r = await fetchJson(`${url}/api/health`, 2500);
    return !!(r && (r.ok || r.code === 200 || String(r.message || "").toLowerCase().includes("healthy")));
  } catch (_) {
    return false;
  }
}

async function waitForHealthy(url, label, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await isHealthy(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function pocketBaseExePath() {
  const exeRel = path.join("local-tools", "pocketbase", "pocketbase.exe");
  const candidates = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", exeRel),
    asarUnpackedPath(path.join(appRoot(), exeRel)),
    path.join(process.resourcesPath || "", exeRel),
    path.join(runtimeRoot(), exeRel),
    path.join(appRoot(), exeRel)
  ];

  const exe = findExistingFile(candidates);
  if (!exe) logLine("PocketBase executable search failed", candidates.join(" | "));
  return exe;
}

function pocketBaseListenArg() {
  const u = new URL(getPocketBaseUrl());
  const host = u.hostname || "127.0.0.1";
  const port = u.port || "8090";
  return `${host}:${port}`;
}

async function ensurePocketBase() {
  const pbUrl = getPocketBaseUrl();
  if (await isHealthy(pbUrl)) {
    logLine("PocketBase already running", pbUrl);
    return;
  }

  const exe = pocketBaseExePath();
  if (!exe) {
    throw new Error("PocketBase executable not found. Expected local-tools\\pocketbase\\pocketbase.exe in the app package.");
  }

  const cwd = path.dirname(exe);
  const arg = pocketBaseListenArg();
  logLine("Starting PocketBase", `${exe} --http=${arg}`);

  pocketBaseProcess = spawn(exe, ["serve", `--http=${arg}`], {
    cwd,
    windowsHide: true,
    stdio: "pipe"
  });

  pocketBaseProcess.stdout.on("data", (data) => logLine("PocketBase", String(data).trim()));
  pocketBaseProcess.stderr.on("data", (data) => logLine("PocketBase error", String(data).trim()));
  pocketBaseProcess.on("exit", (code) => logLine("PocketBase exited", String(code)));
  pocketBaseProcess.on("error", (err) => logLine("PocketBase start error", err && err.message ? err.message : String(err)));

  await waitForHealthy(pbUrl, "PocketBase", 25000);
}

async function ensureServer() {
  const apiUrl = getApiUrl();
  if (await isHealthy(apiUrl)) {
    logLine("SP WorkTrack API already running", apiUrl);
    return;
  }

  try {
    require.resolve("express");
  } catch (_) {
    throw new Error("Server dependency missing: express. Reinstall or use the packaged SP WorkTrack Server App.");
  }

  logLine("Starting SP WorkTrack API", apiUrl);
  require(path.join(appRoot(), "server", "app.js"));
  await waitForHealthy(apiUrl, "SP WorkTrack API", 25000);
}

function loadingHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="font-family:Segoe UI,Arial;margin:40px;background:#f7f9fc;color:#1f2937;">
      <h2>SP WorkTrack is starting...</h2>
      <p>Starting PocketBase database and SP WorkTrack server. Please wait.</p>
    </body></html>
  `)}`;
}

function errorHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="font-family:Segoe UI,Arial;margin:40px;background:#fff7f7;color:#7f1d1d;">
      <h2>SP WorkTrack could not start</h2>
      <p style="white-space:pre-wrap;line-height:1.5;">${String(message || "Unknown error").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</p>
      <p>Check <b>runtime_logs/electron-runtime.log</b> in the app folder.</p>
    </body></html>
  `)}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    icon: path.join(appRoot(), "assets", "app.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(loadingHtml());
}

async function startApp() {
  loadEnv();
  createWindow();

  try {
    await ensurePocketBase();
    await ensureServer();
    await mainWindow.loadURL(getApiUrl());
    logLine("SP WorkTrack opened", getApiUrl());
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    logLine("Startup failed", message);
    if (mainWindow) mainWindow.loadURL(errorHtml(message));
    dialog.showErrorBox("SP WorkTrack startup failed", message);
  }
}

app.whenReady().then(startApp);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (pocketBaseProcess && !pocketBaseProcess.killed) {
    try { pocketBaseProcess.kill(); } catch (_) {}
  }
});