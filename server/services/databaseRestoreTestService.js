// server/services/databaseRestoreTestService.js
// Safe restore test: validates and extracts a transfer ZIP into a test folder without touching live DB.

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { TRANSFER_DIR, resolvePackagePath } = require("./databaseTransferService");
const { validateTransferPackage } = require("./databaseRestoreService");

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

async function testExtractTransferPackage(fileName) {
  const preview = await validateTransferPackage(fileName);
  if (!preview.ok) {
    const err = new Error(`Transfer package validation failed. Missing: ${preview.missing.join(", ")}`);
    err.status = 400;
    err.details = preview;
    throw err;
  }

  const zipPath = await resolvePackagePath(fileName);
  const testDir = path.join(TRANSFER_DIR, "restore_test_runs", `RESTORE_TEST_${stamp()}`);
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(testDir, { recursive: true });
  await runPowerShell(`Expand-Archive -LiteralPath '${quotePs(zipPath)}' -DestinationPath '${quotePs(testDir)}' -Force`);

  return {
    ok: true,
    fileName: preview.fileName,
    testDir,
    components: preview.components,
    manifest: preview.manifest,
    message: "Package safely extracted into test folder. Live pb_data, pb_migrations, and .env were not changed.",
    warnings: [
      "This is a safe extraction test only; it does not start PocketBase from the test folder.",
      "Use actual restore only on target/test server after confirming this preview.",
      "The test folder may contain .env secrets. Keep it private or delete it after testing."
    ]
  };
}

module.exports = { testExtractTransferPackage };
