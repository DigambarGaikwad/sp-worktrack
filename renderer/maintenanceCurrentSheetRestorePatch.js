// renderer/maintenanceCurrentSheetRestorePatch.js
// Adds Maintenance UI to restore DB Edition backup exported from current Google Sheet.

(function () {
  const REQUEST_TIMEOUT_MS = 900000;
  const ACTION = "restore_current_sheet_backup";
  let lastAnalysis = null;
  let otpRequestToken = "";

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function postJson(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(body || {}) });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timed out. Restore may be large; check server console and DB status before retrying.");
      throw err;
    } finally { clearTimeout(timer); }
  }

  function setStatus(message, type = "") {
    const el = document.getElementById("currentSheetRestoreStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : type === "warn" ? "#c2410c" : "#64748b";
    el.style.fontWeight = type ? "900" : "700";
  }

  function setResult(message, type = "info") {
    const host = document.getElementById("currentSheetRestoreResult");
    if (!host) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : type === "warn" ? "#c2410c" : "#0b3f73";
    host.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function setButtonText(text) {
    const btn = document.getElementById("currentSheetRestoreBtn");
    if (btn) btn.textContent = text || "Restore Current Sheet Backup";
  }

  function setBusy(value, label = "") {
    ["currentSheetChooseBtn", "currentSheetAnalyzeBtn", "currentSheetOtpBtn", "currentSheetRestoreBtn"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = Boolean(value);
    });
    setButtonText(value ? (label || "Working...") : "Restore Current Sheet Backup");
  }

  function focusField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { el.focus(); el.classList.add("entry-error"); setTimeout(() => el.classList.remove("entry-error"), 1600); }, 250);
  }

  function renderObjectTable(obj) {
    const rows = Object.entries(obj || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:900;">${esc(v)}</td></tr>`).join("");
    return rows ? `<table><tbody>${rows}</tbody></table>` : `<div class="small-hint">No data.</div>`;
  }

  function renderSummaryTable(summary) {
    const rows = Object.entries(summary || {}).map(([name, c]) => `<tr><td>${esc(name)}</td><td>${esc(c.checked || 0)}</td><td>${esc(c.wouldCreate || 0)}</td><td>${esc(c.wouldUpdate || 0)}</td><td>${esc(c.created || 0)}</td><td>${esc(c.updated || 0)}</td><td>${esc(c.skipped || 0)}</td><td>${esc(c.errors || 0)}</td></tr>`).join("");
    return rows ? `<table><thead><tr><th>Collection</th><th>Checked</th><th>Would Create</th><th>Would Update</th><th>Created</th><th>Updated</th><th>Skipped</th><th>Errors</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="small-hint">No restore summary.</div>`;
  }

  function renderAnalysis(data) {
    const host = document.getElementById("currentSheetRestoreResult");
    if (!host) return;
    const warnings = (data.warnings || []).map(w => `<li>${esc(w)}</li>`).join("");
    host.innerHTML = `
      <div class="sum-table-wrap" style="margin-top:10px;">
        <div class="sum-table-title">Current Google Sheet Backup Analyze</div>
        <div class="small-hint"><b>File:</b> ${esc(data.fileName)}<br><b>Date range:</b> ${esc(data.dateRange?.from || "-")} to ${esc(data.dateRange?.to || "-")}</div>
        <div class="small-hint"><b>LOG sheets:</b> ${esc((data.logSheets || []).join(", ") || "-")}<br><b>ATT sheets:</b> ${esc((data.attendanceSheets || []).join(", ") || "-")}</div>
        ${renderObjectTable(data.counts)}
        ${warnings ? `<div class="danger-note" style="margin-top:8px;"><b>Warnings:</b><ul>${warnings}</ul></div>` : ""}
      </div>`;
  }

  function renderRestoreResult(data) {
    const host = document.getElementById("currentSheetRestoreResult");
    if (!host) return;
    host.innerHTML = `
      <div class="sum-table-wrap" style="margin-top:10px;">
        <div class="sum-table-title">Current Sheet Restore Result (${esc(data.mode)})</div>
        <div class="small-hint"><b>Restored file:</b> ${esc(data.analysis?.fileName || "-")}<br><b>Safety backup:</b> ${esc(data.backup?.fileName || "Created/Not requested")}</div>
        ${renderSummaryTable(data.summary)}
        <div class="small-hint" style="margin-top:8px;font-weight:900;color:#15803d;">Open Dashboard and refresh. Restored data is saved in PocketBase.</div>
      </div>`;
  }

  function ensureUi() {
    const grid = document.querySelector("#tabMaintenance .maintenance-grid");
    if (!grid || document.getElementById("currentSheetRestoreBox")) return;

    const box = document.createElement("div");
    box.className = "maintenance-box";
    box.id = "currentSheetRestoreBox";
    box.innerHTML = `
      <div class="maintenance-title">7. Restore Current Google Sheet Backup</div>
      <div class="small-hint">Use Excel downloaded from current DB-edition Google Sheet backup. Expected sheets: LOG_YYYY, ATT_YYYY, QUALITY_LOG, BOOKING_LOG, BOOKING_STATUS.</div>
      <input id="currentSheetFileInput" type="file" accept=".xlsx,.xls" style="display:none;" />
      <div class="field"><label>Selected Excel File</label><input id="currentSheetFilePath" class="admin-input" placeholder="Choose current backup .xlsx file" readonly /></div>
      <div class="row" style="gap:8px; flex-wrap:wrap;">
        <button class="btn grey" id="currentSheetChooseBtn" type="button">Choose Excel File</button>
        <button class="btn grey" id="currentSheetAnalyzeBtn" type="button">Analyze Current Backup</button>
        <label class="quality-recheck-line"><input id="currentSheetCreateBackup" type="checkbox" checked /> Create safety DB backup before restore</label>
      </div>
      <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:8px;">
        <button class="btn grey" id="currentSheetOtpBtn" type="button">Request Restore OTP</button>
        <input id="currentSheetOtpInput" class="admin-input" style="max-width:150px;" placeholder="Enter OTP" autocomplete="one-time-code" />
      </div>
      <label class="confirm-label">Type RESTORE_SHEET here to confirm</label>
      <input id="currentSheetConfirmText" class="admin-input confirm-input" placeholder="RESTORE_SHEET" autocomplete="off" />
      <button class="btn orange" id="currentSheetRestoreBtn" type="button">Restore Current Sheet Backup</button>
      <div class="small-hint danger-note">Restore is merge/update safe. Existing Admin PIN/settings are kept. Backup first.</div>
      <div id="currentSheetRestoreStatus" class="small-hint" style="margin-top:8px;"></div>
      <div id="currentSheetRestoreResult"></div>
    `;
    grid.appendChild(box);
    wire();
  }

  function selectedFilePath(file) {
    return clean(file?.path || file?.webkitRelativePath || file?.name);
  }

  function chooseFile() {
    document.getElementById("currentSheetFileInput")?.click();
  }

  function onFileSelected() {
    const file = document.getElementById("currentSheetFileInput")?.files?.[0];
    const filePath = selectedFilePath(file);
    if (!filePath) { setStatus("Could not read selected file path. Use Electron app window, not browser.", "error"); return; }
    if (!/\.xlsx?$/i.test(filePath)) { setStatus("Select only .xlsx/.xls file.", "error"); return; }
    document.getElementById("currentSheetFilePath").value = filePath;
    lastAnalysis = null;
    otpRequestToken = "";
    setStatus("Excel file selected. Click Analyze Current Backup.", "success");
  }

  function payloadBase() {
    const filePath = clean(document.getElementById("currentSheetFilePath")?.value);
    if (!filePath) { setStatus("Choose current backup Excel file first.", "error"); focusField("currentSheetChooseBtn"); return null; }
    return { filePath };
  }

  async function analyze() {
    const body = payloadBase();
    if (!body) return;
    try {
      setBusy(true, "Analyzing...");
      setStatus("Analyzing current Google Sheet backup...");
      setResult("Reading Excel workbook and validating LOG/ATT backup sheets...");
      const data = await postJson("/api/maintenance/current-sheet-backup/analyze", body);
      lastAnalysis = data;
      renderAnalysis(data);
      setStatus("Analyze complete. Review counts and warnings before restore.", "success");
    } catch (err) {
      setStatus(err?.message || String(err), "error");
      setResult(err?.message || String(err), "error");
    } finally { setBusy(false); }
  }

  async function requestOtp() {
    const body = payloadBase();
    if (!body) return;
    try {
      setBusy(true, "Requesting OTP...");
      setStatus("Requesting restore OTP...");
      const data = await postJson("/api/maintenance/otp/request", { action: ACTION });
      otpRequestToken = clean(data.requestToken || data.otpRequestToken || data.token);
      setStatus("OTP sent. Enter OTP, type RESTORE_SHEET and click Restore.", "success");
      focusField("currentSheetOtpInput");
    } catch (err) { setStatus(err?.message || String(err), "error"); }
    finally { setBusy(false); }
  }

  async function restoreNow() {
    const body = payloadBase();
    if (!body) return;
    const otp = clean(document.getElementById("currentSheetOtpInput")?.value);
    const confirmText = clean(document.getElementById("currentSheetConfirmText")?.value);
    const createBackup = document.getElementById("currentSheetCreateBackup")?.checked !== false;

    if (!lastAnalysis) { setStatus("Analyze current backup first, then restore.", "error"); focusField("currentSheetAnalyzeBtn"); return; }
    if (!otpRequestToken) { setStatus("Request Restore OTP first.", "error"); focusField("currentSheetOtpBtn"); return; }
    if (!otp) { setStatus("Enter OTP first.", "error"); focusField("currentSheetOtpInput"); return; }
    if (confirmText !== "RESTORE_SHEET") { setStatus("Type RESTORE_SHEET in confirmation box first.", "error"); focusField("currentSheetConfirmText"); return; }

    try {
      setBusy(true, createBackup ? "Backing up..." : "Restoring...");
      setStatus(createBackup ? "Creating safety DB backup before restore. Please wait..." : "Starting restore. Please wait...", "warn");
      setResult(createBackup ? "Safety backup in progress... After backup, restore will start automatically." : "Restore in progress... This can take several minutes.", "warn");
      setTimeout(() => {
        setStatus("Restore request is still running. Please wait; do not click Restore again.", "warn");
        setButtonText("Working...");
      }, 8000);

      const data = await postJson("/api/maintenance/current-sheet-backup/restore", { ...body, confirmText, otpRequestToken, otp, action: ACTION, createBackup });
      renderRestoreResult(data);
      document.getElementById("currentSheetConfirmText").value = "";
      document.getElementById("currentSheetOtpInput").value = "";
      otpRequestToken = "";
      setStatus("Current Google Sheet backup restored successfully.", "success");
    } catch (err) {
      setStatus(err?.message || String(err), "error");
      setResult(err?.message || String(err), "error");
      if (/otp/i.test(String(err?.message || ""))) focusField("currentSheetOtpBtn");
    } finally { setBusy(false); }
  }

  function wire() {
    const fileInput = document.getElementById("currentSheetFileInput");
    if (fileInput && !fileInput.__currentSheetWired) { fileInput.__currentSheetWired = true; fileInput.addEventListener("change", onFileSelected); }
    const choose = document.getElementById("currentSheetChooseBtn");
    if (choose && !choose.__currentSheetWired) { choose.__currentSheetWired = true; choose.addEventListener("click", chooseFile); }
    const analyzeBtn = document.getElementById("currentSheetAnalyzeBtn");
    if (analyzeBtn && !analyzeBtn.__currentSheetWired) { analyzeBtn.__currentSheetWired = true; analyzeBtn.addEventListener("click", analyze); }
    const otpBtn = document.getElementById("currentSheetOtpBtn");
    if (otpBtn && !otpBtn.__currentSheetWired) { otpBtn.__currentSheetWired = true; otpBtn.addEventListener("click", requestOtp); }
    const restoreBtn = document.getElementById("currentSheetRestoreBtn");
    if (restoreBtn && !restoreBtn.__currentSheetWired) { restoreBtn.__currentSheetWired = true; restoreBtn.addEventListener("click", restoreNow); }
  }

  function init() { ensureUi(); wire(); }
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1300));
  document.addEventListener("click", () => setTimeout(init, 200), true);
  setInterval(init, 1500);
})();
