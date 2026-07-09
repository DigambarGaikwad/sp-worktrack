// server/services/databaseTransferService.js
// Creates SP WorkTrack database transfer packages for moving DB/config to another server PC.

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const CODE_ROOT = process.env.SPWT_APP_ROOT || path.resolve(__dirname, "../..");
const ROOT_DIR = process.env.SPWT_RUNTIME_ROOT || CODE_ROOT;
const TRANSFER_DIR = path.join(ROOT_DIR, "transfer_packages");
const PACKAGE_PREFIX = "SPWT_TRANSFER";

const CORE_COMPONENTS = [
  {
    key: "pb_data",
    relPath: "pb_data",
    packagePath: "pb_data",
    altRelPaths: ["pb_data", "local-tools/pocketbase/pb_data"],
    required: true,
    type: "directory",
    note: "PocketBase database and uploaded files. The service detects both root pb_data and local-tools/pocketbase/pb_data."
  },
  {
    key: "pb_migrations",
    relPath: "pb_migrations",
    packagePath: "pb_migrations",
    altRelPaths: ["pb_migrations", "local-tools/pocketbase/pb_migrations"],
    required: false,
    type: "directory",
    note: "PocketBase schema migrations. The service detects both root pb_migrations and local-tools/pocketbase/pb_migrations."
  },
  {
    key: "env",
    relPath: ".env",
    packagePath: "env/.env",
    altRelPaths: [".env"],
    required: false,
    type: "file",
    note: "Server configuration. Contains secrets; keep package secure."
  },
  {
    key: "package",
    relPath: "package.json",
    packagePath: "package.json",
    altRelPaths: ["package.json"],
    required: false,
    type: "file",
    preferCodeRoot: true,
    note: "App version/package reference."
  },
  {
    key: "package_lock",
    relPath: "package-lock.json",
    packagePath: "package-lock.json",
    altRelPaths: ["package-lock.json"],
    required: false,
    type: "file",
    preferCodeRoot: true,
    note: "Dependency lock file for repeatable production installs."
  }
];

const COUNT_COLLECTIONS = [
  { name: "employees" },
  { name: "machines" },
  { name: "shifts" },
  { name: "loss_reasons" },
  { name: "root_areas" },
  { name: "machine_categories", optional: true, note: "Optional legacy/master collection. Some builds store categories inside machine/work records." },
  { name: "work_subworks", optional: true, note: "Optional legacy/master collection. Some builds store work/subwork through other master tables." },
  { name: "production_entries" },
  { name: "production_entry_lines" },
  { name: "planned_absences" },
  { name: "quality_logs", optional: true, note: "Optional until quality module is used." },
  { name: "admin_settings" },
  { name: "admin_access_users", optional: true, note: "Optional if access users are stored in admin settings or collection is not created yet." },
  { name: "backup_logs", optional: true, note: "Optional until backup logging collection is created." }
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

function uniqueRoots(component) {
  const roots = component.preferCodeRoot ? [CODE_ROOT, ROOT_DIR] : [ROOT_DIR, CODE_ROOT];
  return roots.filter((root, index, arr) => root && arr.indexOf(root) === index);
}

async function findComponentSource(component) {
  const candidates = Array.isArray(component.altRelPaths) && component.altRelPaths.length
    ? component.altRelPaths
    : [component.relPath];

  for (const root of uniqueRoots(component)) {
    for (const relPath of candidates) {
      const absPath = path.join(root, relPath);
      const info = await folderStats(absPath);
      if (info.exists) return { root, relPath, absPath, info };
    }
  }

  const relPath = candidates[0] || component.relPath;
  return {
    root: uniqueRoots(component)[0] || ROOT_DIR,
    relPath,
    absPath: path.join(uniqueRoots(component)[0] || ROOT_DIR, relPath),
    info: { exists: false, files: 0, folders: 0, bytes: 0 }
  };
}

async function componentStatus() {
  const components = [];
  for (const item of CORE_COMPONENTS) {
    const source = await findComponentSource(item);
    components.push({
      ...item,
      sourceRoot: source.root,
      sourceRelPath: source.relPath,
      sourcePath: source.absPath,
      absPath: source.absPath,
      packagePath: item.packagePath || item.relPath,
      exists: source.info.exists,
      files: source.info.files,
      folders: source.info.folders,
      bytes: source.info.bytes,
      size: formatBytes(source.info.bytes),
      ok: item.required ? source.info.exists : true
    });
  }
  return components;
}

async function getRecordCounts() {
  const counts = [];
  for (const item of COUNT_COLLECTIONS) {
    const collection = item.name || item;
    try {
      const data = await pocketBaseRequest(`/api/collections/${collection}/records`, {
        method: "GET",
        query: { page: 1, perPage: 1 }
      });
      counts.push({ collection, count: Number(data.totalItems || 0), ok: true, optional: !!item.optional, note: item.note || "" });
    } catch (err) {
      if (item.optional) {
        counts.push({
          collection,
          count: null,
          ok: false,
          optional: true,
          message: item.note || "Optional collection is not created in this database. This is not a transfer blocker."
        });
      } else {
        counts.push({ collection, count: 0, ok: false, optional: false, message: err?.message || "Unavailable" });
      }
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
    appRoot: CODE_ROOT,
    transferDir: TRANSFER_DIR,
    server: {
      hostname: os.hostname(),
      platform: process.platform,
      node: process.version,
      port: Number(process.env.SPWT_API_PORT || 3032)
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
      "For final migration, stop new production entry before creating the last package.",
      "Restore is a separate step. Do not replace pb_data while PocketBase is running.",
      "Optional record-count collections may show as optional/not created. Full pb_data transfer still includes whatever exists in the database."
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
  for (const item of status.components) {
    const dest = path.join(workDir, item.packagePath || item.relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const ok = item.exists ? await copyIfExists(item.absPath, dest) : false;
    copied.push({
      key: item.key,
      relPath: item.relPath,
      sourceRoot: item.sourceRoot,
      sourceRelPath: item.sourceRelPath,
      packagePath: item.packagePath,
      copied: ok,
      note: item.note
    });
  }

  const manifest = {
    app: "SP WorkTrack",
    packageType: "database-transfer",
    packageVersion: 3,
    createdAt,
    createdOnServer: status.server,
    rootDir: ROOT_DIR,
    appRoot: CODE_ROOT,
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
    "Contains PocketBase data, migrations, server config, and package reference files if present.",
    "Keep this ZIP secure. It may contain database records and configuration secrets.",
    "For restore, stop PocketBase first, then restore folders on the new server PC.",
    "After restore, start PocketBase and Node/SP WorkTrack Server again.",
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
    bytes: stat.size,
    size: formatBytes(stat.size),
    createdAt,
    componentCount: copied.filter(item => item.copied).length,
    recordCounts: status.recordCounts,
    warnings: status.warnings
  };
}

function resolvePackagePath(fileName) {
  return Promise.resolve(path.join(TRANSFER_DIR, safeTransferName(fileName)));
}

module.exports = {
  getDatabaseTransferStatus,
  createTransferPackage,
  listTransferPackages,
  safeTransferName,
  resolvePackagePath,
  TRANSFER_DIR,
  PACKAGE_PREFIX
};
