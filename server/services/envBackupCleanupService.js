// server/services/envBackupCleanupService.js
// Keeps runtime .env backup files from piling up after System Settings saves.

const fs = require("fs");
const path = require("path");

const DEFAULT_KEEP = Math.max(1, Number(process.env.SPWT_MAX_ENV_BACKUPS || 3));

function runtimeRoot(rootDir = process.cwd()) {
  return process.env.SPWT_RUNTIME_ROOT || rootDir;
}

function currentEnvPath(rootDir = process.cwd()) {
  return process.env.SPWT_ENV_FILE || path.join(runtimeRoot(rootDir), ".env");
}

function cleanupEnvBackups(rootDir = process.cwd(), keep = DEFAULT_KEEP) {
  const envFile = currentEnvPath(rootDir);
  const dir = path.dirname(envFile);
  const base = path.basename(envFile);

  if (!fs.existsSync(dir)) return { envFile, keep, found: 0, removed: 0 };

  const backups = fs.readdirSync(dir)
    .filter(name => name.startsWith(`${base}.bak_`))
    .map(name => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let removed = 0;
  for (const item of backups.slice(keep)) {
    try {
      fs.rmSync(item.fullPath, { force: true });
      removed += 1;
    } catch (err) {
      console.warn("Failed to delete old env backup:", item.fullPath, err.message || err);
    }
  }

  return { envFile, keep, found: backups.length, removed };
}

module.exports = { cleanupEnvBackups, currentEnvPath };
