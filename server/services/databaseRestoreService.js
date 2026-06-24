// server/services/databaseRestoreService.js
// Validates and restores SP WorkTrack database transfer packages safely.

const fs = require("fs/promises");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { TRANSFER_DIR, resolvePackagePath } = require("./databaseTransferService");

const ROOT_DIR = process.env.SPWT_RUNTIME_ROOT || path.resolve(__dirname, "../..");
const RESTORE_CONFIRM_TOKEN = "RESTORE_DB";
const POCKETBASE_PORT = 8090;

function pad(n) {
  return String(n).padStart(2, "0");
}

function stamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "_",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join("");
}

function quotePs(value) {
  return String(value || "").replace(/'/g, "''");
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    ps.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    ps.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    ps.on("error", reject);
    ps.on("close", code => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || stdout.trim() || `PowerShell failed with exit code ${code}`));
    });
  });
}

async function existsStats(absPath) {
  try {
    return await fs.stat(absPath);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function folderStats(absPath) {
  const stat = await existsStats(absPath);
  if (!stat) return { exists: false, files: 0, folders: 0, bytes: 0 };
  if (!stat.isDirectory()) return { exists: true, files: 1, folders: 0, bytes: stat.size };

  let files = 0;
  let folders = 0;
  let bytes = 0;

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        folders += 1;
        await walk(full);
      } else if (entry.isFile()) {
        files += 1;
        const s = await fs.stat(full);
        bytes += s.size;
      }
    }
  }

  await walk(absPath);
  return { exists: true, files, folders, bytes };
}

function portOpen(host, port, timeoutMs = 800) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function expandZip(zipPath, workDir) {
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  await runPowerShell(`Expand-Archive -LiteralPath '${quotePs(zipPath)}' -DestinationPath '${quotePs(workDir)}' -Force`);
}

async function readJsonIfExists(absPath) {
  try {
    return JSON.parse(await fs.readFile(absPath, "utf8"));
  } catch {
    return null;
  }
}

async function inspectComponent(workDir, item) {
  const absPath = path.join(workDir, item.relPath);
  const stat = await existsStats(absPath);
  let exists = false;
  let bytes = 0;
  let files = 0;
  let folders = 0;
  let note = item.note || "";

  if (stat) {
    if (item.type === "directory") {
      const info = await folderStats(absPath);
      exists = info.exists;
      bytes = info.bytes;
      files = info.files;
      folders = info.folders;
      if (item.mustContain) {
        const child = await existsStats(path.join(absPath, item.mustContain));
        if (!child) {
          exists = false;
          note = `${item.mustContain} missing inside ${item.relPath}`;
        }
      }
    } else {
      exists = stat.isFile();
      bytes = stat.size;
      files = exists ? 1 : 0;
    }
  }

  return {
    key: item.key,
    relPath: item.relPath,
    required: !!item.required,
    type: item.type,
    exists,
    ok: item.required ? exists : true,
    files,
    folders,
    bytes,
    size: formatBytes(bytes),
    note
  };
}

function restoreTargets() {
  const pbBase = path.join(ROOT_DIR, "local-tools", "pocketbase");
  return {
    env: process.env.SPWT_ENV_FILE || path.join(ROOT_DIR, ".env"),
    pb_data: path.join(pbBase, "pb_data"),
    pb_migrations: path.join(pbBase, "pb_migrations")
  };
}

async function copyIfExists(src, dest) {
  const stat = await existsStats(src);
  if (!stat) return false;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (stat.isDirectory()) await fs.cp(src, dest, { recursive: true, force: true });
  else await fs.copyFile(src, dest);
  return true;
}

async function backupCurrentState(targets) {
  const backupRoot = path.join(TRANSFER_DIR, "pre_restore_backups", `PRE_RESTORE_${stamp()}`);
  await fs.mkdir(backupRoot, { recursive: true });

  const copied = [];
  for (const item of [
    { key: "env", source: targets.env, dest: path.join(backupRoot, "env", ".env") },
    { key: "pb_data", source: targets.pb_data, dest: path.join(backupRoot, "pb_data") },
    { key: "pb_migrations", source: targets.pb_migrations, dest: path.join(backupRoot, "pb_migrations") }
  ]) {
    const ok = await copyIfExists(item.source, item.dest);
    copied.push({ key: item.key, source: item.source, copied: ok });
  }

  return { backupRoot, copied };
}

async function extractAndInspect(fileName, mode = "preview") {
  const zipPath = await resolvePackagePath(fileName);
  const workDir = path.join(TRANSFER_DIR, `_${mode}_${stamp()}_${Math.random().toString(16).slice(2)}`);
  await expandZip(zipPath, workDir);

  const manifest = await readJsonIfExists(path.join(workDir, "SPWT_TRANSFER_MANIFEST.json"));
  const items = [
    { key: "manifest", relPath: "SPWT_TRANSFER_MANIFEST.json", type: "file", required: true, note: "Transfer manifest." },
    { key: "env", relPath: path.join("env", ".env"), type: "file", required: true, note: "Server .env. Contains secrets; content is not displayed." },
    { key: "pb_data", relPath: "pb_data", type: "directory", required: true, mustContain: "data.db", note: "PocketBase database data." },
    { key: "pb_migrations", relPath: "pb_migrations", type: "directory", required: true, note: "PocketBase schema migrations." },
    { key: "package", relPath: "package.json", type: "file", required: false, note: "Package reference only; restore does not overwrite app code." },
    { key: "readme", relPath: "READ_ME_FIRST.txt", type: "file", required: false, note: "Human restore notes." }
  ];

  const components = [];
  for (const item of items) components.push(await inspectComponent(workDir, item));
  const missing = components.filter(item => item.required && !item.exists).map(item => item.relPath);

  return {
    fileName: path.basename(zipPath),
    fullPath: zipPath,
    workDir,
    ok: missing.length === 0,
    missing,
    components,
    manifest: manifest ? {
      app: manifest.app || "",
      packageType: manifest.packageType || "",
      packageVersion: manifest.packageVersion || "",
      createdAt: manifest.createdAt || "",
      createdOnServer: manifest.createdOnServer || null,
      recordCounts: Array.isArray(manifest.recordCounts) ? manifest.recordCounts : []
    } : null,
    warnings: [
      "Restore package contains database records and .env secrets. Keep it private.",
      "PocketBase must be stopped before actual restore.",
      "Restore replaces current pb_data, pb_migrations, and .env in the writable runtime folder. A pre-restore backup folder is created first.",
      "App source code/package.json is not overwritten by restore. Install/update the app separately."
    ]
  };
}

async function validateTransferPackage(fileName) {
  const data = await extractAndInspect(fileName, "restore_preview");
  await fs.rm(data.workDir, { recursive: true, force: true }).catch(() => {});
  delete data.workDir;
  return data;
}

async function restoreTransferPackage(fileName, options = {}) {
  if (String(options.confirmToken || "").trim() !== RESTORE_CONFIRM_TOKEN) {
    const err = new Error(`Type ${RESTORE_CONFIRM_TOKEN} to confirm restore.`);
    err.status = 400;
    throw err;
  }

  const data = await extractAndInspect(fileName, "restore_apply");
  try {
    if (!data.ok) {
      const err = new Error(`Transfer package validation failed. Missing: ${data.missing.join(", ")}`);
      err.status = 400;
      err.details = data;
      throw err;
    }

    const pbRunning = await portOpen("127.0.0.1", POCKETBASE_PORT, 900);
    if (pbRunning) {
      const err = new Error("PocketBase is still running on 127.0.0.1:8090. Stop PocketBase first, then restore.");
      err.status = 409;
      throw err;
    }

    const targets = restoreTargets();
    const backup = await backupCurrentState(targets);
    const restored = [];

    const restoreItems = [
      { key: "env", source: path.join(data.workDir, "env", ".env"), target: targets.env, type: "file" },
      { key: "pb_data", source: path.join(data.workDir, "pb_data"), target: targets.pb_data, type: "directory" },
      { key: "pb_migrations", source: path.join(data.workDir, "pb_migrations"), target: targets.pb_migrations, type: "directory" }
    ];

    for (const item of restoreItems) {
      await fs.mkdir(path.dirname(item.target), { recursive: true });
      await fs.rm(item.target, { recursive: true, force: true });
      const copied = await copyIfExists(item.source, item.target);
      restored.push({ key: item.key, target: item.target, restored: copied });
    }

    return {
      ok: true,
      fileName: data.fileName,
      preRestoreBackupDir: backup.backupRoot,
      backedUp: backup.copied,
      restored,
      message: "Transfer package restored. Restart SP WorkTrack so PocketBase and Node load restored runtime files.",
      warnings: [
        "Close SP WorkTrack completely after restore.",
        "Open SP WorkTrack again so restored .env and database are loaded.",
        "Open Admin and verify employees, machines, attendance, reports, email, and Google backup settings."
      ]
    };
  } finally {
    await fs.rm(data.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  RESTORE_CONFIRM_TOKEN,
  validateTransferPackage,
  restoreTransferPackage
};
