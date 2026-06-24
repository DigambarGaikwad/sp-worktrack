// server/services/transferCleanupService.js
// Removes stale transfer work folders and keeps only latest transfer ZIPs.

const fs = require("fs/promises");
const path = require("path");
const { TRANSFER_DIR, PACKAGE_PREFIX } = require("./databaseTransferService");

const DEFAULT_KEEP = Math.max(1, Number(process.env.SPWT_MAX_TRANSFER_PACKAGES || 5));

async function statSafe(fullPath) {
  try { return await fs.stat(fullPath); }
  catch (err) { if (err?.code === "ENOENT") return null; throw err; }
}

async function cleanupTransferFolder(keep = DEFAULT_KEEP) {
  await fs.mkdir(TRANSFER_DIR, { recursive: true });
  const entries = await fs.readdir(TRANSFER_DIR, { withFileTypes: true });
  const zips = [];
  let removedTemp = 0;
  let removedOldZips = 0;

  for (const entry of entries) {
    const fullPath = path.join(TRANSFER_DIR, entry.name);
    if (!entry.name.startsWith(PACKAGE_PREFIX)) continue;

    if (entry.isFile() && entry.name.endsWith(".zip")) {
      const stat = await statSafe(fullPath);
      if (stat) zips.push({ fullPath, name: entry.name, mtimeMs: stat.mtimeMs });
      continue;
    }

    // Leftover work directory or partial non-zip file from interrupted package creation.
    await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
    removedTemp += 1;
  }

  zips.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of zips.slice(keep)) {
    await fs.rm(item.fullPath, { force: true }).catch(() => {});
    removedOldZips += 1;
  }

  return {
    transferDir: TRANSFER_DIR,
    keepLatest: keep,
    zipCountBefore: zips.length,
    removedTemp,
    removedOldZips
  };
}

module.exports = { cleanupTransferFolder };
