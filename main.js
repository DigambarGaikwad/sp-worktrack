// main.js
// SP WorkTrack V2 Electron Server Launcher
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const dotenv = require("dotenv");

const APP_PRODUCT_NAME = "SP WorkTrack V2";
const APP_USER_DATA_DIR = "sp-worktrack-v2";
const DEFAULT_API_PORT = 3032;
const DEFAULT_POCKETBASE_URL = "http://127.0.0.1:8092";
const BLANK_DB_MAX_BYTES = 700 * 1024;

try {
  app.setName(APP_PRODUCT_NAME);
  const appDataRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  app.setPath("userData", path.join(appDataRoot, APP_USER_DATA_DIR));
} catch (_) {}

let mainWindow = null;
let pocketBaseProcess = null;

function appRoot() {
  return __dirname;
}

function runtimeRoot() {
  // In packaged mode, Program Files/app.asar is read-only for normal users.
  // Keep DB, .env, transfer packages and logs in Electron userData instead.
  return app.isPackaged ? path.join(app.getPath("userData"), "runtime") : appRoot();
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

function copyFileIfMissing(src, dest) {
  if (!src || !fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirIfMissing(src, dest, requiredChild = "") {
  if (!src || !fs.existsSync(src)) return false;
  if (requiredChild && fs.existsSync(path.join(dest, requiredChild))) return false;
  if (!requiredChild && fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  return true;
}

function removeDirSafe(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDirReplace(src, dest) {
  if (!src || !fs.existsSync(src)) throw new Error(`Source folder missing: ${src}`);
  removeDirSafe(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function packagedPath(relPath) {
  const candidates = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", relPath),
    asarUnpackedPath(path.join(appRoot(), relPath)),
    path.join(process.resourcesPath || "", relPath),
    path.join(appRoot(), relPath)
  ];
  return findExistingFile(candidates);
}

function ensureWritableRuntime() {
  const root = runtimeRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "local-tools", "pocketbase"), { recursive: true });
  fs.mkdirSync(path.join(root, "transfer_packages"), { recursive: true });

  if (!app.isPackaged) return;

  const envTarget = path.join(root, ".env");
  const envSource = findExistingFile([
    path.join(path.dirname(process.execPath), ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", ".env"),
    asarUnpackedPath(path.join(appRoot(), ".env")),
    path.join(appRoot(), ".env")
  ]);
  if (copyFileIfMissing(envSource, envTarget)) logLine("Seeded writable .env", envTarget);

  const pbDataSource = packagedPath(path.join("local-tools", "pocketbase", "pb_data"));
  const pbDataTarget = path.join(root, "local-tools", "pocketbase", "pb_data");
  if (copyDirIfMissing(pbDataSource, pbDataTarget, "data.db")) logLine("Seeded writable pb_data", pbDataTarget);

  const pbMigrationSource = packagedPath(path.join("local-tools", "pocketbase", "pb_migrations"));
  const pbMigrationTarget = path.join(root, "local-tools", "pocketbase", "pb_migrations");
  if (copyDirIfMissing(pbMigrationSource, pbMigrationTarget)) logLine("Seeded writable pb_migrations", pbMigrationTarget);
}

function dbLooksBlank() {
  const db = path.join(runtimeRoot(), "local-tools", "pocketbase", "pb_data", "data.db");
  if (!fs.existsSync(db)) return true;
  try {
    return fs.statSync(db).size <= BLANK_DB_MAX_BYTES;
  } catch (_) {
    return true;
  }
}

function runtimeNeedsTransferRestore() {
  const envMissing = !fs.existsSync(path.join(runtimeRoot(), ".env"));
  return envMissing || dbLooksBlank();
}

function newestTransferZip() {
  const dir = path.join(runtimeRoot(), "transfer_packages");
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir)
    .filter((name) => /^SPWT_TRANSFER_.*\.zip$/i.test(name))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

function extractTransferPackage(zipPath) {
  const workDir = path.join(os.tmpdir(), `spwt-transfer-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  // Use built-in PowerShell Expand-Archive on Windows to avoid adding a new dependency.
  const ps = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(workDir)} -Force`
  ], { windowsHide: true, stdio: "pipe" });

  return new Promise((resolve, reject) => {
    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += String(d); });
    ps.on("error", reject);
    ps.on("exit", (code) => {
      if (code === 0) resolve(workDir);
      else reject(new Error(`Transfer ZIP extract failed. ${stderr || `Exit code ${code}`}`));
    });
  });
}

async function restoreTransferPackageBeforeStartup() {
  ensureWritableRuntime();
  const zip = newestTransferZip();
  if (!zip) return false;

  if (!runtimeNeedsTransferRestore()) {
    logLine("Transfer package found but runtime already initialized; skipping auto-restore", zip);
    return false;
  }

  logLine("Auto-restoring transfer package before startup", zip);
  const extracted = await extractTransferPackage(zip);
  const envFile = path.join(extracted, "env", ".env");
  const pbData = path.join(extracted, "pb_data");
  const pbMigrations = path.join(extracted, "pb_migrations");
  const dbFile = path.join(pbData, "data.db");

  if (!fs.existsSync(envFile)) throw new Error("Invalid transfer package: env\\.env missing.");
  if (!fs.existsSync(dbFile)) throw new Error("Invalid transfer package: pb_data\\data.db missing.");

  const backupRoot = path.join(runtimeRoot(), "transfer_packages", "pre_auto_restore_backups", `PRE_AUTO_RESTORE_${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(backupRoot, { recursive: true });

  const currentEnv = path.join(runtimeRoot(), ".env");
  const currentPbData = path.join(runtimeRoot(), "local-tools", "pocketbase", "pb_data");
  const currentPbMigrations = path.join(runtimeRoot(), "local-tools", "pocketbase", "pb_migrations");

  if (fs.existsSync(currentEnv)) fs.copyFileSync(currentEnv, path.join(backupRoot, ".env"));
  if (fs.existsSync(currentPbData)) fs.cpSync(currentPbData, path.join(backupRoot, "pb_data"), { recursive: true, force: true });
  if (fs.existsSync(currentPbMigrations)) fs.cpSync(currentPbMigrations, path.join(backupRoot, "pb_migrations"), { recursive: true, force: true });

  fs.mkdirSync(path.dirname(currentEnv), { recursive: true });
  fs.copyFileSync(envFile, currentEnv);
  copyDirReplace(pbData, currentPbData);
  if (fs.existsSync(pbMigrations)) copyDirReplace(pbMigrations, currentPbMigrations);

  const marker = path.join(runtimeRoot(), "transfer_packages", `RESTORED_${path.basename(zip)}.txt`);
  fs.writeFileSync(marker, `Restored ${zip}\nAt ${new Date().toISOString()}\nBackup ${backupRoot}\n`, "utf8");
  removeDirSafe(extracted);
  logLine("Auto-restore completed", marker);
  return true;
}

async function loadEnv() {
  await restoreTransferPackageBeforeStartup();

  process.env.SPWT_RUNTIME_ROOT = runtimeRoot();
  process.env.SPWT_APP_ROOT = appRoot();
  process.env.SPWT_ENV_FILE = path.join(runtimeRoot(), ".env");

  const exeDir = path.dirname(process.execPath);
  const envPath = findExistingFile([
    process.env.SPWT_ENV_FILE,
    path.join(runtimeRoot(), ".env"),
    path.join(exeDir, ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", ".env"),
    asarUnpackedPath(path.join(appRoot(), ".env")),
    path.join(appRoot(), ".env")
  ]);

  if (envPath) {
    dotenv.config({ path: envPath, override: true });
    logLine("Loaded env", envPath);
  } else {
    logLine("No .env found; using V2 defaults/env vars");
  }
}

function getApiPort() {
  return Number(process.env.SPWT_API_PORT || DEFAULT_API_PORT);
}

function getApiUrl() {
  return `http://127.0.0.1:${getApiPort()}`;
}

function getPocketBaseUrl() {
  return String(process.env.POCKETBASE_URL || DEFAULT_POCKETBASE_URL).replace(/\/$/, "");
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

function pocketBaseRuntimeDir() {
  const dir = path.join(runtimeRoot(), "local-tools", "pocketbase");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pocketBaseDataDir() {
  const dir = path.join(pocketBaseRuntimeDir(), "pb_data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pocketBaseListenArg() {
  const u = new URL(getPocketBaseUrl());
  const host = u.hostname || "127.0.0.1";
  const port = u.port || "8092";
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

  const cwd = pocketBaseRuntimeDir();
  const dataDir = pocketBaseDataDir();
  const arg = pocketBaseListenArg();
  const args = ["serve", `--http=${arg}`, `--dir=${dataDir}`];
  logLine("Starting PocketBase", `${exe} ${args.join(" ")} cwd=${cwd}`);

  pocketBaseProcess = spawn(exe, args, {
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
    logLine("SP WorkTrack V2 API already running", apiUrl);
    return;
  }

  try {
    require.resolve("express");
  } catch (_) {
    throw new Error("Server dependency missing: express. Reinstall or use the packaged SP WorkTrack V2 Server App.");
  }

  logLine("Starting SP WorkTrack V2 API", apiUrl);
  require(path.join(appRoot(), "server", "app.js"));
  await waitForHealthy(apiUrl, "SP WorkTrack V2 API", 25000);
}

function loadingHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="font-family:Segoe UI,Arial;margin:40px;background:#f7f9fc;color:#1f2937;">
      <h2>SP WorkTrack V2 is starting...</h2>
      <p>Starting PocketBase database and SP WorkTrack V2 server. Please wait.</p>
    </body></html>
  `)}`;
}

function errorHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="font-family:Segoe UI,Arial;margin:40px;background:#fff7f7;color:#7f1d1d;">
      <h2>SP WorkTrack V2 could not start</h2>
      <p style="white-space:pre-wrap;line-height:1.5;">${String(message || "Unknown error").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</p>
      <p>Check <b>runtime_logs/electron-runtime.log</b> in the writable app data folder.</p>
    </body></html>
  `)}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_PRODUCT_NAME,
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
  await loadEnv();
  createWindow();

  try {
    await ensurePocketBase();
    await ensureServer();
    await mainWindow.loadURL(getApiUrl());
    logLine("SP WorkTrack V2 opened", getApiUrl());
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    logLine("Startup failed", message);
    if (mainWindow) mainWindow.loadURL(errorHtml(message));
    dialog.showErrorBox("SP WorkTrack V2 startup failed", message);
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
