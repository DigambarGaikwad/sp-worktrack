// server/services/databaseTransferService.js
// Creates SP WorkTrack database transfer packages for moving DB/config to another server PC.

const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const ROOT_DIR = path.resolve(__dirname, "../..");
const TRANSFER_DIR = path.join(ROOT_DIR, "transfer_packages");
const PACKAGE_PREFIX = "SPWT_TRANSFER";

const CORE_COMPONENTS = [
  { key: "pb_data", relPath: "pb_data", required: true, type: "directory", note: "PocketBase database and uploaded files." },
  { key: "pb_migrations", relPath: "pb_migrations", required: false, type: "directory", note: "PocketBase schema migrations." },
  { key: "env", relPath: ".env", required: false, type: "file", note: "Server configuration. Contains secrets; keep package secure." },
  { key: "package", relPath: "package.json", required: false, type: "file", note: "App version/package reference." }
];

const COUNT_COLLECTIONS = [
  "employees",
  "machines",
  "shifts",
  "loss_reasons",
  "root_areas",
  "machine_categories",
  "work_subworks",
  "production_entries",
  "production_entry_lines",
  "planned_absences",
  "quality_logs",
  "admin_settings",
  "admin_access_users",
  "backup_logs"
];

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

function safeTransferName(value) {
  const name = path.basename(String(value || ""));
  if (!name.startsWith(PACKAGE_PREFIX)) throw new Error("Invalid transfer package name.");
  return name;
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function existsStats(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return stat;
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

async function componentStatus() {
  const components = [];
  for (const item of CORE_COMPONENTS) {
    const absPath = path.join(ROOT_DIR, item.relPath);
    const info = await folderStats(absPath);
    components.push({
      ...item,
      absPath,
      exists: info.exists,
      files: info.files,
      folders: info.folders,
      bytes: info.bytes,
      size: formatBytes(info.bytes),
      ok: item.required ? info.exists : true
    });
  }
  return components;
}

async function getRecordCounts() {
  const counts = [];
  for (const collection of COUNT_COLLECTIONS) {
    try {
      const data = await pocketBaseRequest(`/api/collections/${collection}/records`, {
        method: "GET",
        query: { page: 1, perPage: 1 }
      });
      counts.push({ collection, count: Number(data.totalItems || 0), ok: true });
    } catch (err) {
      counts.push({ collection, count: 0, ok: false, message: err?.message || "Unavailable" });
    }
  }
  return counts;
}

async function listTransferPackages() {
  await fs.mkdir(TRANSFER_DIR, { recursive: true });
  const entries = await fs.readdir(TRANSFER_DIR, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip") || !entry.name.startsWith(PACKAGE_PREFIX)) continue;
    const fullPath = path.join(TRANSFER_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    packages.push({
      fileName: entry.name,
      fullPath,
      bytes: stat.size,
      size: formatBytes(stat.size),
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString()
    });
  }

  packages.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  return packages;
}

async function getDatabaseTransferStatus() {
  const components = await componentStatus();
  const recordCounts = await getRecordCounts();
  const packages = await listTransferPackages();
  const totalComponentBytes = components.reduce((sum, item) => sum + Number(item.bytes || 0), 0);

  return {
    rootDir: ROOT_DIR,
    transferDir: TRANSFER_DIR,
    server: {
      hostname: os.hostname(),
      platform: process.platform,
      node: process.version,
      port: Number(process.env.SPWT_API_PORT || 3030)
    },
    components,
    recordCounts,
    totalComponentBytes,
    totalComponentSize: formatBytes(totalComponentBytes),
    ready: components.every(item => item.ok),
    latestPackage: packages[0] || null,
    packages,
    warnings: [
      "Transfer package can contain .env secrets. Store and share it carefully.",
      "For final migration, stop new production entry before creating the last package."
    ]
  };
}

async function copyIfExists(src, dest) {
  const stat = await existsStats(src);
  if (!stat) return false;
  if (stat.isDirectory()) await fs.cp(src, dest, { recursive: true, force: true });
  else await fs.copyFile(src, dest);
  return true;
}

function runPowerShellZip(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const cmd = [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
    ];

    const ps = spawn("powershell.exe", cmd, { windowsHide: true });
    let stderr = "";
    ps.stderr.on("data", chunk => { stderr += chunk.toString(); });
    ps.on("error", reject);
    ps.on("close", code => {
      if (code === 0) resolve(true);
      else reject(new Error(stderr || `Compress-Archive failed with exit code ${code}`));
    });
  });
}

async function createTransferPackage(options = {}) {
  await fs.mkdir(TRANSFER_DIR, { recursive: true });

  const status = await getDatabaseTransferStatus();
  if (!status.ready) {
    const missing = status.components.filter(item => !item.ok).map(item => item.relPath).join(", ");
    throw new Error(`Required database component missing: ${missing}`);
  }

  const createdAt = new Date().toISOString();
  const name = `${PACKAGE_PREFIX}_${stamp()}`;
  const workDir = path.join(TRANSFER_DIR, name);
  const zipPath = path.join(TRANSFER_DIR, `${name}.zip`);

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });

  const copied = [];
  for (const item of CORE_COMPONENTS) {
    const src = path.join(ROOT_DIR, item.relPath);
    const dest = path.join(workDir, item.relPath === ".env" ? "env/.env" : item.relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const ok = await copyIfExists(src, dest);
    copied.push({ key: item.key, relPath: item.relPath, copied: ok, note: item.note });
  }

  const manifest = {
    app: "SP WorkTrack",
    packageType: "database-transfer",
    packageVersion: 1,
    createdAt,
    createdOnServer: status.server,
    rootDir: ROOT_DIR,
    transferDir: TRANSFER_DIR,
    components: status.components,
    copied,
    recordCounts: status.recordCounts,
    warnings: status.warnings,
    restoreNote: "Restore should be done on the new server PC while PocketBase is stopped. Do not overwrite pb_data while PocketBase is running."
  };

  await fs.writeFile(path.join(workDir, "SPWT_TRANSFER_MANIFEST.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(workDir, "READ_ME_FIRST.txt"), [
    "SP WorkTrack Database Transfer Package",
    "",
    `Created: ${createdAt}`,
    `Server: ${status.server.hostname}`,
    "",
    "Contains pb_data, pb_migrations, and server config if present.",
    "Keep this ZIP secure. It may contain database records and configuration secrets.",
    "For restore, stop PocketBase first, then restore folders on the new server PC.",
    ""
  ].join("\r\n"), "utf8");

  try {
    await runPowerShellZip(workDir, zipPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const stat = await fs.stat(zipPath);
  return {
    fileName: path.basename(zipPath),
    fullPath: zipPath,
    transferDir: TRANSFER_DIR,
    bytes: stat.size,
    size: formatBytes(stat.size),
    createdAt,
    manifest,
    note: options.note || "Transfer package created. Store securely."
  };
}

async function resolvePackagePath(fileName) {
  const safeName = safeTransferName(fileName);
  const fullPath = path.join(TRANSFER_DIR, safeName);
  const stat = await existsStats(fullPath);
  if (!stat || !stat.isFile()) {
    const err = new Error("Transfer package not found.");
    err.status = 404;
    throw err;
  }
  return fullPath;
}

module.exports = {
  TRANSFER_DIR,
  getDatabaseTransferStatus,
  createTransferPackage,
  listTransferPackages,
  resolvePackagePath
};