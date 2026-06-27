// renderer/maintenanceV1ExcelImportPatch.js
// Adds rugged V1 Excel Backup import UI in Admin -> Maintenance.

(function () {
  const REQUEST_TIMEOUT_MS = 900000;
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
      if (err?.name === "AbortError") throw new Error("Request timed out. Import may be large; check server console and DB status before retrying.");
      throw err;
    } finally { clearTimeout(timer); }
  }

  function setStatus(message, type = "") {
    const el = document.getElementById("v1ExcelStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : type === "warn" ? "#c2410c" : "#64748b";
    el.style.fontWeight = type ? "900" : "700";
  }

  function setResultMessage(message, type = "info") {
    const host = document.getElementById("v1ExcelResult");
    if (!host) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : type === "warn" ? "#c2410c" : "#0b3f73";
    host.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function setButtonText(id, text) {
    const btn = document.getElementById(id);
    if (btn && text) btn.textContent = text;
  }

  function focusField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { el.focus(); el.classList.add("entry-error"); setTimeout(() => el.classList.remove("entry-error"), 1600); }, 250);
  }

  function setBusy(value, busyLabel = "") {
    ["v1ChooseFileBtn", "v1AnalyzeBtn", "v1RequestOtpBtn", "v1ImportBtn"].forEach(id => { const btn = document.getElementById(id); if (btn) btn.disabled = Boolean(value); });
    setButtonText("v1ImportBtn", value ? (busyLabel || "Working...") : "Import V1 Excel Backup");
  }

  function renderObjectTable(obj) {
    const rows = Object.entries(obj || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:900;">${esc(v)}</td></tr>`).join("");
    return rows ? `<table><tbody>${rows}</tbody></table>` : `<div class="small-hint">No data.</div>`;
  }

  function renderSummaryTable(summary) {
    const rows = Object.entries(summary || {}).map(([name, c]) => `<tr><td>${esc(name)}</td><td>${esc(c.checked || 0)}</td><td>${esc(c.wouldCreate || 0)}</td><td>${esc(c.wouldUpdate || 0)}</td><td>${esc(c.created || 0)}</td><td>${esc(c.updated || 0)}</td><td>${esc(c.skipped || 0)}</td><td>${esc(c.errors || 0)}</td></tr>`).join("");
    return rows ? `<table><thead><tr><th>Collection</th><th>Checked</th><th>Would Create</th><th>Would Update</th><th>Created</th><th>Updated</th><th>Skipped</th><th>Errors</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="small-hint">No import summary.</div>`;
  }

  function renderAnalysis(data) {
    const host = document.getElementById("v1ExcelResult");
    if (!host) return;
    const warnings = (data.warnings || []).map(w => `<li>${esc(w)}</li>`).join("");
    host.innerHTML = `
      <div class="sum-table-wrap" style="margin-top:10px;">
        <div class="sum-table-title">Analyze Preview</div>
        <div class="small-hint"><b>File:</b> ${esc(data.fileName)}<br><b>Date range:</b> ${esc(data.dateRange?.from || "-")} to ${esc(data.dateRange?.to || "-")}</div>
        ${renderObjectTable(data.counts)}
        <div class="grid-2" style="margin-top:10px;">
          <div><div class="sum-table-title">LOG Type Count</div>${renderObjectTable(data.logTypeCount)}</div>
          <div><div class="sum-table-title">Attendance Status Count</div>${renderObjectTable(data.attendanceStatusCount)}</div>
        </div>
        <div class="small-hint" style="margin-top:8px;"><b>Machine Categories:</b> ${esc((data.machineCategories || []).join(", ") || "-")}</div>
        ${warnings ? `<div class="danger-note" style="margin-top:8px;"><b>Warnings:</b><ul>${warnings}</ul></div>` : ""}
      </div>`;
  }

  function renderImportResult(data) {
    const host = document.getElementById("v1ExcelResult");
    if (!host) return;
    host.innerHTML = `
      <div class="sum-table-wrap" style="margin-top:10px;">
        <div class="sum-table-title">V1 Import Result (${esc(data.mode)})</div>
        <div class="small-hint"><b>Imported file:</b> ${esc(data.analysis?.fileName || "-")}<br><b>Backup:</b> ${esc(data.backup?.fileName || "Created/Not requested")}</div>
        ${renderSummaryTable(data.summary)}
      </div>`;
  }

  function ensureUi() {
    const oldBox = document.getElementById("importOldSheetBtn")?.closest(".maintenance-box");
    if (!oldBox || document.getElementById("v1ExcelImportBox")) return;
    oldBox.innerHTML = `
      <div id="v1ExcelImportBox">
        <div class="maintenance-title">4. Import V1 Excel Backup</div>
        <div class="small-hint">Choose old Google Sheet Excel backup. ADMIN sheet is ignored. Planned_Work is validation/snapshot only.</div>
        <input id="v1ExcelFileInput" type="file" accept=".xlsx,.xls" style="display:none;" />
        <div class="field"><label>Selected Excel File</label><input id="v1ExcelFilePath" class="admin-input" placeholder="Choose .xlsx file" readonly /></div>
        <div class="row" style="gap:8px; flex-wrap:wrap;">
          <button class="btn grey" id="v1ChooseFileBtn" type="button">Choose Excel File</button>
          <button class="btn grey" id="v1AnalyzeBtn" type="button">Analyze Excel</button>
          <label class="quality-recheck-line"><input id="v1CreateBackup" type="checkbox" checked /> Create DB backup before import</label>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button class="btn grey" id="v1RequestOtpBtn" type="button">Request Import OTP</button>
          <input id="v1OtpInput" class="admin-input" style="max-width:150px;" placeholder="Enter OTP" autocomplete="one-time-code" />
        </div>
        <label class="confirm-label">Type IMPORT_V1 here to confirm</label>
        <input id="v1ConfirmText" class="admin-input confirm-input" placeholder="IMPORT_V1" autocomplete="off" />
        <button class="btn orange" id="v1ImportBtn" type="button">Import V1 Excel Backup</button>
        <div class="small-hint danger-note">Import is merge/update safe and duplicate-controlled by keys. Take backup before import.</div>
        <div id="v1ExcelStatus" class="small-hint" style="margin-top:8px;"></div>
        <div id="v1ExcelResult"></div>
      </div>`;
    wire();
  }

  function selectedFilePath(file) {
    return clean(file?.path || file?.webkitRelativePath || file?.name);
  }

  function chooseFile() {
    const fileInput = document.getElementById("v1ExcelFileInput");
    fileInput?.click();
  }

  function onFileSelected() {
    const file = document.getElementById("v1ExcelFileInput")?.files?.[0];
    const filePath = selectedFilePath(file);
    if (!filePath) { setStatus("Could not read selected file path. Use Electron app window, not browser.", "error"); return; }
    if (!/\.xlsx?$/i.test(filePath)) { setStatus("Select only .xlsx/.xls file.", "error"); return; }
    document.getElementById("v1ExcelFilePath").value = filePath;
    lastAnalysis = null;
    otpRequestToken = "";
    setStatus("Excel file selected. Click Analyze Excel.", "success");
  }

  function payloadBase() {
    const filePath = clean(document.getElementById("v1ExcelFilePath")?.value);
    if (!filePath) { setStatus("Choose Excel file first.", "error"); focusField("v1ChooseFileBtn"); return null; }
    return { filePath };
  }

  async function analyze() {
    const body = payloadBase();
    if (!body) return;
    try {
      setBusy(true, "Analyzing...");
      setStatus("Analyzing V1 Excel file...");
      setResultMessage("Reading Excel workbook and validating sheets...");
      const data = await postJson("/api/maintenance/v1-excel/analyze", body);
      lastAnalysis = data;
      renderAnalysis(data);
      setStatus("Analyze complete. Review counts and warnings before import.", "success");
    } catch (err) { setStatus(err?.message || String(err), "error"); }
    finally { setBusy(false); }
  }

  async function requestOtp() {
    const body = payloadBase();
    if (!body) return;
    try {
      setBusy(true, "Requesting OTP...");
      setStatus("Requesting import OTP...");
      const data = await postJson("/api/maintenance/otp/request", { action: "import_v1_excel" });
      otpRequestToken = clean(data.requestToken || data.otpRequestToken || data.token);
      setStatus("OTP sent. Enter OTP, type IMPORT_V1 and click Import.", "success");
      focusField("v1OtpInput");
    } catch (err) { setStatus(err?.message || String(err), "error"); }
    finally { setBusy(false); }
  }

  async function importNow() {
    const body = payloadBase();
    if (!body) return;
    const otp = clean(document.getElementById("v1OtpInput")?.value);
    const confirmText = clean(document.getElementById("v1ConfirmText")?.value);
    const createBackup = document.getElementById("v1CreateBackup")?.checked !== false;

    if (!lastAnalysis) { setStatus("Analyze Excel first, then import.", "error"); focusField("v1AnalyzeBtn"); return; }
    if (!otpRequestToken) { setStatus("Request Import OTP first.", "error"); focusField("v1RequestOtpBtn"); return; }
    if (!otp) { setStatus("Enter OTP first.", "error"); focusField("v1OtpInput"); return; }
    if (confirmText !== "IMPORT_V1") { setStatus("Type IMPORT_V1 in confirmation box first.", "error"); focusField("v1ConfirmText"); return; }

    try {
      setBusy(true, createBackup ? "Backing up..." : "Importing...");
      setStatus(createBackup ? "Creating DB backup before import. Please wait; do not close the app..." : "Starting V1 Excel import. Please wait; do not close the app...", "warn");
      setResultMessage(createBackup ? "Backup in progress... After backup, import will start automatically." : "Import in progress... This can take several minutes for large Excel files.", "warn");

      if (createBackup) {
        setTimeout(() => {
          setStatus("Backup/import request is still running. Please wait; do not click Import again.", "warn");
          setButtonText("v1ImportBtn", "Working...");
        }, 8000);
      }

      const data = await postJson("/api/maintenance/v1-excel/import", { ...body, confirmText, otpRequestToken, otp, action: "import_v1_excel", createBackup });
      renderImportResult(data);
      document.getElementById("v1ConfirmText").value = "";
      document.getElementById("v1OtpInput").value = "";
      otpRequestToken = "";
      setStatus("V1 Excel import completed.", "success");
    } catch (err) {
      setStatus(err?.message || String(err), "error");
      setResultMessage(err?.message || String(err), "error");
      if (/otp/i.test(String(err?.message || ""))) focusField("v1RequestOtpBtn");
    } finally { setBusy(false); }
  }

  function wire() {
    const fileInput = document.getElementById("v1ExcelFileInput");
    if (fileInput && !fileInput.__wired) { fileInput.__wired = true; fileInput.addEventListener("change", onFileSelected); }
    const c = document.getElementById("v1ChooseFileBtn");
    if (c && !c.__wired) { c.__wired = true; c.addEventListener("click", chooseFile); }
    const a = document.getElementById("v1AnalyzeBtn");
    if (a && !a.__wired) { a.__wired = true; a.addEventListener("click", analyze); }
    const o = document.getElementById("v1RequestOtpBtn");
    if (o && !o.__wired) { o.__wired = true; o.addEventListener("click", requestOtp); }
    const i = document.getElementById("v1ImportBtn");
    if (i && !i.__wired) { i.__wired = true; i.addEventListener("click", importNow); }
  }

  function init() { ensureUi(); wire(); }
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1200));
  document.addEventListener("click", () => setTimeout(init, 200), true);
  setInterval(init, 1500);
})();
