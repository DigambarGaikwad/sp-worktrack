// renderer/maintenanceAdminPatch.js
// Adds Admin → Maintenance tab for backup, cleanup, employee entry deletion and old sheet import placeholder.

(function () {
  const REQUEST_TIMEOUT_MS = 45000;
  let wired = false;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function requestJson(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body || {})
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timed out. Check backend/PocketBase and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function status(message, type = "") {
    const el = document.getElementById("maintenanceStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = type ? "800" : "600";
  }

  function setBusy(value) {
    document.querySelectorAll("#tabMaintenance button").forEach(btn => { btn.disabled = Boolean(value); });
  }

  function renderCounts(hostId, data) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const counts = data?.counts || data?.collections || {};
    const rows = Object.entries(counts).map(([name, count]) => `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:800;">${esc(count)}</td></tr>`).join("");
    host.innerHTML = rows ? `<table><thead><tr><th>Collection</th><th style="text-align:right;">Count</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="small-hint">No count data.</div>`;
  }

  function ensureTab() {
    const panel = document.getElementById("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return;

    if (!tabs.querySelector('[data-tab="tabMaintenance"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.setAttribute("data-tab", "tabMaintenance");
      btn.textContent = "Maintenance";
      const pinTab = tabs.querySelector('[data-tab="tabPin"]');
      if (pinTab) tabs.insertBefore(btn, pinTab);
      else tabs.appendChild(btn);
    }

    if (!document.getElementById("tabMaintenance")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabMaintenance";
      page.innerHTML = `
        <div class="section-title">Maintenance</div>
        <div class="small-hint">Use carefully. Always take backup before deleting or importing data.</div>

        <div class="card admin-controls-card">
          <style>
            #tabMaintenance .maintenance-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
            #tabMaintenance .maintenance-box { border:1px solid #dbe3ee; border-radius:12px; padding:12px; background:#f8fafc; }
            #tabMaintenance .maintenance-title { font-weight:900; color:#172033; margin-bottom:6px; }
            #tabMaintenance table { width:100%; border-collapse:collapse; margin-top:8px; }
            #tabMaintenance th { text-align:left; padding:6px; background:#0b3f73; color:white; }
            #tabMaintenance td { padding:6px; border-bottom:1px solid #e5e7eb; }
            #tabMaintenance .danger-note { color:#b91c1c; font-weight:800; }
            #tabMaintenance .confirm-input { margin-top:8px; max-width:240px; border:2px solid #ef4444!important; font-weight:900; letter-spacing:.5px; }
            #tabMaintenance .confirm-label { margin-top:8px; display:block; font-weight:900; color:#b91c1c; }
            @media(max-width:900px){ #tabMaintenance .maintenance-grid{grid-template-columns:1fr;} }
          </style>

          <div class="maintenance-grid">
            <div class="maintenance-box">
              <div class="maintenance-title">1. Backup DB</div>
              <div class="small-hint">Creates JSON backup in server /backups folder.</div>
              <button class="btn green" id="maintenanceBackupBtn" type="button">Backup DB Now</button>
              <div id="maintenanceBackupResult"></div>
            </div>

            <div class="maintenance-box">
              <div class="maintenance-title">2. Clear Transaction Data</div>
              <div class="small-hint">Deletes production entries, lines, booking logs/status, quality logs, attendance.</div>
              <div class="grid-2">
                <div class="field"><label>From Date</label><input id="clearFromDate" class="admin-input" type="date" /></div>
                <div class="field"><label>To Date</label><input id="clearToDate" class="admin-input" type="date" /></div>
              </div>
              <button class="btn grey" id="previewClearTransactionsBtn" type="button">Preview Clear Count</button>
              <label class="confirm-label">Type CLEAR here to confirm</label>
              <input id="clearConfirmText" class="admin-input confirm-input" placeholder="CLEAR" autocomplete="off" />
              <button class="btn red" id="confirmClearTransactionsBtn" type="button">Clear Transaction Data</button>
              <div class="small-hint danger-note">This action deletes transaction data. Backup first.</div>
              <div id="clearTransactionsResult"></div>
            </div>

            <div class="maintenance-box">
              <div class="maintenance-title">3. Delete Entries by Employee</div>
              <div class="small-hint">Deletes one employee's entries for selected date range and rebuilds booking status.</div>
              <div class="grid-2">
                <div class="field"><label>Employee Code</label><input id="deleteEmpCode" class="admin-input" placeholder="Example: SPT022" /></div>
                <div class="field"><label>From Date</label><input id="deleteEmpFromDate" class="admin-input" type="date" /></div>
                <div class="field"><label>To Date</label><input id="deleteEmpToDate" class="admin-input" type="date" /></div>
              </div>
              <button class="btn grey" id="previewDeleteEmployeeBtn" type="button">Preview Employee Count</button>
              <label class="confirm-label">Type DELETE here to confirm</label>
              <input id="deleteEmpConfirmText" class="admin-input confirm-input" placeholder="DELETE" autocomplete="off" />
              <button class="btn red" id="confirmDeleteEmployeeBtn" type="button">Delete Employee Entries</button>
              <div class="small-hint danger-note">This action deletes selected employee entries. Backup first.</div>
              <div id="deleteEmployeeResult"></div>
            </div>

            <div class="maintenance-box">
              <div class="maintenance-title">4. Import Old Sheet Data</div>
              <div class="small-hint">Placeholder ready. Upload V1 Excel/CSV first; then we will add column mapping import.</div>
              <button class="btn orange" id="importOldSheetBtn" type="button">Import Old Sheet Data</button>
              <div id="importOldSheetResult"></div>
            </div>
          </div>

          <div class="row admin-controls-actions" style="margin-top:12px;">
            <span class="small-hint" id="maintenanceStatus"></span>
          </div>
        </div>`;
      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }
  }

  function readClearPayload() {
    return { fromDate: clean(document.getElementById("clearFromDate")?.value), toDate: clean(document.getElementById("clearToDate")?.value) };
  }
  function readEmpPayload() {
    return { empCode: clean(document.getElementById("deleteEmpCode")?.value), fromDate: clean(document.getElementById("deleteEmpFromDate")?.value), toDate: clean(document.getElementById("deleteEmpToDate")?.value) };
  }

  async function run(action) {
    try {
      setBusy(true);
      await action();
    } catch (err) {
      status(err?.message || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  function wireButtons() {
    const backupBtn = document.getElementById("maintenanceBackupBtn");
    if (backupBtn && !backupBtn.__wired) {
      backupBtn.__wired = true;
      backupBtn.addEventListener("click", () => run(async () => {
        status("Creating DB backup...");
        const data = await requestJson("/api/maintenance/backup-db", { includeMaster: true, includeTransactions: true });
        renderCounts("maintenanceBackupResult", data);
        status(`Backup created: ${data.fileName}`, "success");
      }));
    }

    const previewClearBtn = document.getElementById("previewClearTransactionsBtn");
    if (previewClearBtn && !previewClearBtn.__wired) {
      previewClearBtn.__wired = true;
      previewClearBtn.addEventListener("click", () => run(async () => {
        status("Previewing transaction data...");
        const data = await requestJson("/api/maintenance/clear-transactions/preview", readClearPayload());
        renderCounts("clearTransactionsResult", data);
        status(`Preview complete. Total records: ${data.total}`, "success");
      }));
    }

    const confirmClearBtn = document.getElementById("confirmClearTransactionsBtn");
    if (confirmClearBtn && !confirmClearBtn.__wired) {
      confirmClearBtn.__wired = true;
      confirmClearBtn.addEventListener("click", () => run(async () => {
        const confirmText = clean(document.getElementById("clearConfirmText")?.value);
        if (confirmText !== "CLEAR") return status("Type CLEAR in the red confirmation box first.", "error");
        status("Clearing transaction data...");
        const data = await requestJson("/api/maintenance/clear-transactions/confirm", { ...readClearPayload(), confirmText });
        renderCounts("clearTransactionsResult", { counts: Object.fromEntries((data.deleted || []).map(x => [x.collection, x.deleted])) });
        document.getElementById("clearConfirmText").value = "";
        status("Transaction data cleared.", "success");
      }));
    }

    const previewEmpBtn = document.getElementById("previewDeleteEmployeeBtn");
    if (previewEmpBtn && !previewEmpBtn.__wired) {
      previewEmpBtn.__wired = true;
      previewEmpBtn.addEventListener("click", () => run(async () => {
        status("Previewing employee entries...");
        const data = await requestJson("/api/maintenance/employee-delete/preview", readEmpPayload());
        renderCounts("deleteEmployeeResult", data);
        status(`Preview complete. Total records: ${data.total}`, "success");
      }));
    }

    const confirmEmpBtn = document.getElementById("confirmDeleteEmployeeBtn");
    if (confirmEmpBtn && !confirmEmpBtn.__wired) {
      confirmEmpBtn.__wired = true;
      confirmEmpBtn.addEventListener("click", () => run(async () => {
        const confirmText = clean(document.getElementById("deleteEmpConfirmText")?.value);
        if (confirmText !== "DELETE") return status("Type DELETE in the red confirmation box first.", "error");
        status("Deleting employee entries and rebuilding booking status...");
        const data = await requestJson("/api/maintenance/employee-delete/confirm", { ...readEmpPayload(), confirmText });
        renderCounts("deleteEmployeeResult", { counts: Object.fromEntries((data.deleted || []).map(x => [x.collection, x.deleted])) });
        document.getElementById("deleteEmpConfirmText").value = "";
        status(`Employee entries deleted. Booking status rebuilt: ${data.bookingRebuild?.rebuilt || 0}`, "success");
      }));
    }

    const importBtn = document.getElementById("importOldSheetBtn");
    if (importBtn && !importBtn.__wired) {
      importBtn.__wired = true;
      importBtn.addEventListener("click", () => run(async () => {
        status("Old sheet import mapping not configured yet...");
        await requestJson("/api/maintenance/import-old-sheet", {});
      }));
    }
  }

  function showTab() {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabMaintenance"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    document.getElementById("tabMaintenance")?.classList.remove("hidden");
    wireButtons();
  }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtMaintenancePatched) return;
    const patched = function (tabId) {
      if (tabId === "tabMaintenance") { showTab(); return; }
      return original.apply(this, arguments);
    };
    patched.__spwtMaintenancePatched = true;
    window.switchAdminTab = patched;
  }

  function init() {
    ensureTab();
    patchSwitchAdminTab();
    wireButtons();
    if (!wired) {
      wired = true;
      document.addEventListener("click", (e) => {
        if (e.target?.closest?.('[data-tab="tabMaintenance"]')) {
          e.preventDefault(); e.stopPropagation(); setTimeout(showTab, 0);
        }
        setTimeout(wireButtons, 0);
      }, true);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
