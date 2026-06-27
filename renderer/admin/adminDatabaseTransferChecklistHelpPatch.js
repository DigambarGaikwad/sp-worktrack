// renderer/admin/adminDatabaseTransferChecklistHelpPatch.js
// Replaces the short transfer checklist with the actual Phase 4.2 app + DB transfer guide.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const SAMPLE_ZIP = "SPWT_TRANSFER_YYYYMMDD_HHMMSS.zip";
  const RUNTIME_PATH = "%APPDATA%\\sp-worktrack-v2\\runtime";
  const DB_PATH = "%APPDATA%\\sp-worktrack-v2\\runtime\\local-tools\\pocketbase\\pb_data\\data.db";
  const ENV_PATTERN = "SPWT_API_PORT|POCKETBASE_URL|POCKETBASE_SUPERUSER_EMAIL";

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
  function codeBlock(text) { return `<pre class="spwt-transfer-code"><code>${esc(text)}</code></pre>`; }

  const sourceVerifyPs = [
    '$Runtime = "$env:APPDATA\\sp-worktrack-v2\\runtime"',
    '$Db = Join-Path $Runtime "local-tools\\pocketbase\\pb_data\\data.db"',
    'Test-Path $Db',
    'Select-String -Path (Join-Path $Runtime ".env") -Pattern "SPWT_API_PORT|POCKETBASE_URL|POCKETBASE_SUPERUSER_EMAIL"',
    'Get-ChildItem (Join-Path $Runtime "transfer_packages") -Filter "SPWT_TRANSFER_*.zip" |',
    '  Sort-Object LastWriteTime -Descending |',
    '  Select-Object -First 3 FullName,Length,LastWriteTime'
  ].join("\n");

  const targetCopyZipPs = [
    '$ZipSource = "<FULL_PATH_TO_TRANSFER_ZIP>\\SPWT_TRANSFER_YYYYMMDD_HHMMSS.zip"',
    '$Runtime = "$env:APPDATA\\sp-worktrack-v2\\runtime"',
    '$TransferDir = Join-Path $Runtime "transfer_packages"',
    'New-Item -ItemType Directory -Force $TransferDir | Out-Null',
    'Copy-Item -LiteralPath $ZipSource -Destination $TransferDir -Force',
    'Get-ChildItem $TransferDir -Filter "SPWT_TRANSFER_*.zip" |',
    '  Sort-Object LastWriteTime -Descending |',
    '  Select-Object -First 5 Name,Length,LastWriteTime'
  ].join("\n");

  const targetManualRestorePs = [
    '# Use this only when the in-app Restore button is not available.',
    '# Close SP WorkTrack V2 completely before running this block.',
    '$Zip = "<FULL_PATH_TO_TRANSFER_ZIP>\\SPWT_TRANSFER_YYYYMMDD_HHMMSS.zip"',
    '$Runtime = "$env:APPDATA\\sp-worktrack-v2\\runtime"',
    '$PbBase = Join-Path $Runtime "local-tools\\pocketbase"',
    '$TransferDir = Join-Path $Runtime "transfer_packages"',
    '$Work = Join-Path $TransferDir "_manual_restore"',
    '$Backup = Join-Path $TransferDir ("pre_restore_backups\\PRE_RESTORE_" + (Get-Date -Format "yyyyMMdd_HHmmss"))',
    '',
    'Get-Process pocketbase -ErrorAction SilentlyContinue | Stop-Process -Force',
    'Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue',
    'New-Item -ItemType Directory -Force $Work,$Backup,$PbBase | Out-Null',
    'Expand-Archive -LiteralPath $Zip -DestinationPath $Work -Force',
    '',
    'if (!(Test-Path (Join-Path $Work "pb_data\\data.db"))) { throw "Invalid transfer ZIP: pb_data\\data.db missing" }',
    'if (!(Test-Path (Join-Path $Work "env\\.env"))) { throw "Invalid transfer ZIP: env\\.env missing" }',
    '',
    '# Backup existing target PC runtime before overwrite',
    'if (Test-Path (Join-Path $Runtime ".env")) { New-Item -ItemType Directory -Force (Join-Path $Backup "env") | Out-Null; Copy-Item (Join-Path $Runtime ".env") (Join-Path $Backup "env\\.env") -Force }',
    'if (Test-Path (Join-Path $PbBase "pb_data")) { Copy-Item (Join-Path $PbBase "pb_data") (Join-Path $Backup "pb_data") -Recurse -Force }',
    'if (Test-Path (Join-Path $PbBase "pb_migrations")) { Copy-Item (Join-Path $PbBase "pb_migrations") (Join-Path $Backup "pb_migrations") -Recurse -Force }',
    '',
    '# Restore transferred runtime files',
    'Copy-Item (Join-Path $Work "env\\.env") (Join-Path $Runtime ".env") -Force',
    'Remove-Item (Join-Path $PbBase "pb_data") -Recurse -Force -ErrorAction SilentlyContinue',
    'Copy-Item (Join-Path $Work "pb_data") (Join-Path $PbBase "pb_data") -Recurse -Force',
    'Remove-Item (Join-Path $PbBase "pb_migrations") -Recurse -Force -ErrorAction SilentlyContinue',
    'Copy-Item (Join-Path $Work "pb_migrations") (Join-Path $PbBase "pb_migrations") -Recurse -Force',
    '',
    'Test-Path (Join-Path $PbBase "pb_data\\data.db")',
    'Select-String -Path (Join-Path $Runtime ".env") -Pattern "SPWT_API_PORT|POCKETBASE_URL|POCKETBASE_SUPERUSER_EMAIL"',
    'Write-Host "Restore done. Open SP WorkTrack V2 again and verify Admin/Dashboard."'
  ].join("\n");

  const targetVerifyPs = [
    'Test-Path "$env:APPDATA\\sp-worktrack-v2\\runtime\\local-tools\\pocketbase\\pb_data\\data.db"',
    'Select-String -Path "$env:APPDATA\\sp-worktrack-v2\\runtime\\.env" -Pattern "SPWT_API_PORT|POCKETBASE_URL|POCKETBASE_SUPERUSER_EMAIL"'
  ].join("\n");

  function transferContext() {
    return {
      folder: $("dbTransferFolderText")?.textContent || `${RUNTIME_PATH}\\transfer_packages`,
      latestPackage: $("dbTransferLatestPath")?.textContent || $("dbRestorePackageSelect")?.value || SAMPLE_ZIP
    };
  }

  function compactHelpHtml(ctx) {
    return `
      <div class="section-title">Transfer Help / Printable Checklist</div>
      <div class="small-hint">This guide is based on the actual Phase 4.2 transfer method used for SP WorkTrack V2: create ZIP on old/source PC, install app on second PC, copy ZIP into runtime transfer folder, restore/import DB, then verify <b>data.db</b> and <b>.env</b>.</div>
      <div class="grid-2" style="gap:12px;margin-top:10px;">
        <div class="card" style="padding:12px;">
          <div class="section-title">Source / old PC</div>
          <ol class="small-hint" style="line-height:1.65;margin:8px 0 0 18px;">
            <li>Stop new production entry for final migration.</li>
            <li>Open <b>Admin &gt; Database Transfer</b>.</li>
            <li>Click <b>Check Database Status</b>.</li>
            <li>Click <b>Create Transfer Package</b>.</li>
            <li>Copy/download latest ZIP: <b>${esc(ctx.latestPackage)}</b>.</li>
          </ol>
        </div>
        <div class="card" style="padding:12px;">
          <div class="section-title">Second / new PC</div>
          <ol class="small-hint" style="line-height:1.65;margin:8px 0 0 18px;">
            <li>Install latest <b>SP WorkTrack V2 Setup</b>.</li>
            <li>Open once so runtime folder is created, then close app fully.</li>
            <li>Copy transfer ZIP into <b>${esc(RUNTIME_PATH)}\\transfer_packages</b>.</li>
            <li>Open app &gt; Admin &gt; Database Transfer &gt; Restore.</li>
            <li>Preview, Test Extract, type <b>RESTORE_DB</b>, then restore.</li>
          </ol>
        </div>
      </div>
      <div class="card" style="padding:12px;margin-top:12px;background:#eef6ff;border-color:#bfdbfe;">
        <div class="section-title">Confirmed Phase 4.2 paths</div>
        <div class="small-hint"><b>Runtime:</b> ${esc(RUNTIME_PATH)}</div>
        <div class="small-hint"><b>Database:</b> ${esc(DB_PATH)}</div>
        <div class="small-hint"><b>Expected .env values:</b> SPWT_API_PORT=3032, POCKETBASE_URL=http://127.0.0.1:8092, POCKETBASE_SUPERUSER_EMAIL=spworktrack.spt@gmail.com</div>
      </div>
    `;
  }

  function guideHtml(ctx) {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SP WorkTrack V2 Transfer Help</title>
  <style>
    body{font-family:Arial,Segoe UI,sans-serif;color:#111827;padding:24px;line-height:1.5;max-width:1040px;margin:0 auto;}
    h1{font-size:24px;margin:0 0 6px;} h2{font-size:18px;margin:24px 0 8px;} h3{font-size:15px;margin:16px 0 6px;}
    .muted{color:#4b5563;} .box{border:1px solid #dbe3ef;border-radius:12px;padding:14px;margin:12px 0;background:#f8fafc;}
    .warn{background:#fff7ed;border-color:#fed7aa;} .ok{background:#ecfdf5;border-color:#bbf7d0;}
    table{border-collapse:collapse;width:100%;margin:8px 0 14px;} th,td{border:1px solid #dbe3ef;padding:8px;text-align:left;vertical-align:top;} th{background:#f1f5f9;}
    ol{padding-left:22px;} li{margin:6px 0;} code{font-family:Consolas,monospace;}
    .spwt-transfer-code{white-space:pre-wrap;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:12px;overflow:auto;font-size:12px;line-height:1.45;}
    .printbar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #e5e7eb;margin-bottom:12px;}
    button{border:0;border-radius:8px;background:#166534;color:#fff;padding:9px 14px;cursor:pointer;font-weight:700;}
    @media print{.printbar{display:none;} body{padding:0;max-width:none;} .box{break-inside:avoid;} .spwt-transfer-code{white-space:pre-wrap;color:#111;background:#f1f5f9;border:1px solid #cbd5e1;}}
  </style>
</head>
<body>
  <div class="printbar"><button onclick="window.print()">Print this checklist</button></div>
  <h1>SP WorkTrack V2 — Database Transfer Help / Checklist</h1>
  <div class="muted">Use this for shifting the installed app database from one PC to another PC. It follows the Phase 4.2 method actually used.</div>

  <div class="box ok">
    <b>Current detected transfer folder:</b> ${esc(ctx.folder)}<br>
    <b>Latest / example transfer package:</b> ${esc(ctx.latestPackage)}
  </div>

  <h2>1. What gets transferred</h2>
  <table>
    <tr><th>Item</th><th>Package path</th><th>Target PC restore path</th></tr>
    <tr><td>PocketBase database</td><td>pb_data</td><td>${esc(DB_PATH)}</td></tr>
    <tr><td>PocketBase migrations</td><td>pb_migrations</td><td>${esc(RUNTIME_PATH)}\\local-tools\\pocketbase\\pb_migrations</td></tr>
    <tr><td>Runtime config</td><td>env\\.env</td><td>${esc(RUNTIME_PATH)}\\.env</td></tr>
  </table>

  <h2>2. Source / old PC checklist</h2>
  <ol>
    <li>Tell users to stop new production entry for final transfer.</li>
    <li>Open SP WorkTrack V2 on source PC.</li>
    <li>Go to <b>Admin Settings &gt; Database Transfer</b>.</li>
    <li>Click <b>Check Database Status</b>. Required item <b>pb_data</b> must be found.</li>
    <li>Click <b>Create Transfer Package</b>. Package name format is <b>SPWT_TRANSFER_YYYYMMDD_HHMMSS.zip</b>.</li>
    <li>Click <b>Download Latest Package</b> or copy the ZIP from the transfer folder.</li>
    <li>Keep one safe backup copy before restoring on another PC.</li>
  </ol>

  <h3>Source PC PowerShell verification</h3>
  ${codeBlock(sourceVerifyPs)}

  <h2>3. Second / new PC checklist</h2>
  <ol>
    <li>Install latest <b>SP WorkTrack V2 Setup</b>.</li>
    <li>Open SP WorkTrack V2 once so this runtime folder is created: <b>${esc(RUNTIME_PATH)}</b>.</li>
    <li>Close SP WorkTrack V2 completely before copying/restoring database.</li>
    <li>Copy the transfer ZIP to the second PC.</li>
    <li>Use the PowerShell block below to place ZIP inside the app transfer folder.</li>
  </ol>

  <h3>Second PC PowerShell — copy transfer ZIP into runtime</h3>
  ${codeBlock(targetCopyZipPs)}

  <h2>4. Recommended import/restore from ZIP using app UI</h2>
  <ol>
    <li>Open SP WorkTrack V2 on the second PC.</li>
    <li>Go to <b>Admin Settings &gt; Database Transfer</b>.</li>
    <li>In <b>Restore Transfer Package</b>, click <b>Refresh Packages</b>.</li>
    <li>Select the copied ZIP.</li>
    <li>Click <b>Preview / Validate Package</b>.</li>
    <li>Click <b>Test Extract to Folder</b>. This must not touch live DB.</li>
    <li>Keep <b>Stop PocketBase before restore</b> checked.</li>
    <li>Type <b>RESTORE_DB</b> in Safety Confirmation.</li>
    <li>Click <b>Restore Selected Package</b>.</li>
    <li>Close SP WorkTrack V2 completely, then open it again.</li>
  </ol>

  <div class="box warn">
    <b>Do not replace pb_data while PocketBase is running.</b><br>
    The restore wizard validates the ZIP, stops PocketBase when selected, creates a pre-restore backup, and then restores .env, pb_data, and pb_migrations.
  </div>

  <h2>5. Manual PowerShell import from ZIP, only if app restore is not available</h2>
  <div class="muted">This manual block performs the same file-level restore: it stops PocketBase, extracts ZIP, backs up existing runtime files, restores .env, pb_data, and pb_migrations, then verifies data.db.</div>
  ${codeBlock(targetManualRestorePs)}

  <h2>6. Final verification on second PC</h2>
  ${codeBlock(targetVerifyPs)}
  <p>Expected output from first command: <b>True</b>.</p>
  <p>Expected .env lines include: <b>SPWT_API_PORT=3032</b>, <b>POCKETBASE_URL=http://127.0.0.1:8092</b>, and <b>POCKETBASE_SUPERUSER_EMAIL=spworktrack.spt@gmail.com</b>.</p>

  <h2>7. Functional checks after restore</h2>
  <ol>
    <li>Open app and login.</li>
    <li>Check Admin master data: employees, machines, shifts, work/sub-work, admin controls.</li>
    <li>Check production entry dropdowns.</li>
    <li>Check People Dashboard and Machine Dashboard.</li>
    <li>Check email test/report send.</li>
    <li>Check Google backup/sync settings if used.</li>
  </ol>
</body>
</html>`;
  }

  function openHelp() {
    const ctx = transferContext();
    const win = window.open("", "_blank", "width=1040,height=760");
    if (!win) return alert("Popup blocked. Allow popups for SP WorkTrack.");
    win.document.write(guideHtml(ctx));
    win.document.close();
  }

  function replaceExistingHelpCard() {
    const page = $("tabDatabaseTransfer");
    if (!page) return;
    const ctx = transferContext();
    const titles = Array.from(page.querySelectorAll(".section-title"));
    const title = titles.find(el => el.textContent.trim() === "Step-by-step transfer notes" || el.textContent.trim() === "Transfer Help / Printable Checklist");
    const card = title?.closest(".admin-controls-card");
    if (card && card.__spwtChecklistHelpApplied !== "v2") {
      card.__spwtChecklistHelpApplied = "v2";
      card.innerHTML = compactHelpHtml(ctx);
    }
  }

  function patchButton() {
    const btn = $("dbTransferChecklistBtn");
    if (!btn || btn.__spwtChecklistHelpButtonApplied === "v2") return;
    btn.__spwtChecklistHelpButtonApplied = "v2";
    btn.textContent = "Transfer Help / Print";
    btn.title = "Open full app + database transfer help with PowerShell commands and print option";
    btn.onclick = openHelp;
  }

  function tick() {
    patchButton();
    replaceExistingHelpCard();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 1200));
  document.addEventListener("click", () => setTimeout(tick, 200), true);
  setInterval(tick, 1500);
})();
