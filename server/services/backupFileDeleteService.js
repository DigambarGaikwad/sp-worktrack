// server/services/backupFileDeleteService.js
// Deletes local DB backup JSON files only. Does not touch PocketBase records.

const fs = require("fs");
const path = require("path");

function clean(value) {
  return String(value ?? "").trim();
}

function runtimeRoot() {
  return clean(process.env.SPWT_RUNTIME_ROOT) || path.join(process.env.APPDATA || process.cwd(), "sp-worktrack-v2", "runtime");
}

function backupDir() {
  return path.join(runtimeRoot(), "backups");
}

function safeBackupFileName(fileName) {
  const name = path.basename(clean(fileName));
  if (!/^spwt-db-backup-.*\.json$/i.test(name)) {
    const err = new Error("Invalid backup file name.");
    err.status = 400;
    throw err;
  }
  return name;
}

function listBackupFiles() {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir)
    .filter(name => /^spwt-db-backup-.*\.json$/i.test(name))
    .map((fileName) => {
      const filePath = path.join(dir, fileName);
      const stat = fs.statSync(filePath);
      let createdAt = "";
      let counts = {};

      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        createdAt = clean(parsed.createdAt);
        counts = Object.fromEntries(Object.entries(parsed.collections || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
      } catch (err) {}

      return { fileName, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(), createdAt, counts };
    })
    .sort((a, b) => clean(b.createdAt || b.modifiedAt).localeCompare(clean(a.createdAt || a.modifiedAt)));

  return { folder: dir, files };
}

function deleteBackupFile({ fileName = "", confirmText = "" } = {}) {
  if (clean(confirmText) !== "DELETE_BACKUP") {
    const err = new Error("Type DELETE_BACKUP to confirm backup file deletion.");
    err.status = 400;
    throw err;
  }

  const name = safeBackupFileName(fileName);
  const filePath = path.join(backupDir(), name);

  if (!fs.existsSync(filePath)) {
    const err = new Error("Backup file not found.");
    err.status = 404;
    throw err;
  }

  fs.unlinkSync(filePath);

  return {
    deletedFile: name,
    remaining: listBackupFiles().files
  };
}

module.exports = { deleteBackupFile };
