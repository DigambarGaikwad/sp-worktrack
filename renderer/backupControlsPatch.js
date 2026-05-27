// renderer/backupControlsPatch.js
// Adds Backup Controls tab in Admin screen.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let backupControlsLoaded = false;
  let backupControls = null;
  let eventsWired = false;

  function apiBaseUrl() {
    return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timeout. Check backend server / Apps Script connection.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function todayISO() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function getAdminToken() {
    if (window.SPWT_ADMIN_ACCESS?.getToken) return window.SPWT_ADMIN_ACCESS.getToken() || "";
    return window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || "";
  }

  function status(message, type = "") {
    const el = document.getElementById("backupControlsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
  }

  function ensureBackupControlsTab() {
    const panel = document.getElementById("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return;

    if (!tabs.querySelector('[data-tab="tabBackupControls"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.setAttribute("data-tab", "tabBackupControls");
      btn.textContent = "Backup";

      const controlsTab = tabs.querySelector('[data-tab="tabControls"]');
      const pinTab = tabs.querySelector('[data-tab="tabPin"]');
      if (pinTab) tabs.insertBefore(btn, pinTab);
      else if (controlsTab) tabs.insertBefore(btn, controlsTab.nextSibling);
      else tabs.appendChild(btn);
    }

    if (!document.getElementById("tabBackupControls")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabBackupControls";
      page.innerHTML = `
        <div class="section-title">Backup Controls</div>
        <div class="small-hint">Control Google Sheet backup and daily auto backup. Backend must be running for daily backup.</div>

        <div class="card admin-controls-card">
          <div class="grid-2">
            <div class="field">
              <label class="quality-recheck-line">
                <input type="checkbox" id="googleSheetBackupEnabled" />
                Enable Google Sheet backup
              </label>
              <div class="small-hint">If disabled, manual and daily sheet backup will be blocked.</div>
            </div>

            <div class="field">
              <label class="quality-recheck-line">
                <input type="checkbox" id="dailyBackupEnabled" />
                Enable daily auto backup
              </label>
              <div class="small-hint">Runs once daily when backend server is running.</div>
            </div>

            <div class="field">
              <label>Daily Backup Time</label>
              <input id="dailyBackupTime" class="admin-input" type="time" value="20:00" />
              <div class="small-hint">Use 24-hour format. Example: 20:00 for 8 PM.</div>
            </div>

            <div class="field">
              <label>Manual Backup Date</label>
              <input id="manualBackupDate" class="admin-input" type="date" />
              <div class="small-hint">Use this to sync a selected date to Google Sheet backup.</div>
            </div>
          </div>

          <div class="row admin-controls-actions" style="gap:8px; flex-wrap:wrap;">
            <button class="btn green" id="saveBackupControlsBtn" type="button">Save Backup Controls</button>
            <button class="btn grey" id="testBackupBtn" type="button">Test Connection</button>
            <button class="btn orange" id="syncTodayBackupBtn" type="button">Sync Today</button>
            <button class="btn orange" id="syncDateBackupBtn" type="button">Sync Selected Date</button>
          </div>

          <div class="small-hint" id="backupControlsStatus"></div>

          <div class="summary-cards" style="margin-top:12px;">
            <div class="sum-card">
              <div class="sum-card-label">Configured</div>
              <div class="sum-card-val" id="backupConfiguredVal">—</div>
            </div>
            <div class="sum-card">
              <div class="sum-card-label">Last Run</div>
              <div class="sum-card-val" id="backupLastRunVal">—</div>
            </div>
            <div class="sum-card">
              <div class="sum-card-label">Last Result</div>
              <div class="sum-card-val" id="backupLastResultVal">—</div>
            </div>
            <div class="sum-card">
              <div class="sum-card-label">Last Work Date</div>
              <div class="sum-card-val" id="backupLastDateVal">—</div>
            </div>
          </div>

          <div class="sum-table-wrap" style="margin-top:12px;">
            <div class="sum-table-title">Last Backup Sheet Summary</div>
            <div class="sum-table" id="backupLastSummaryTable">No backup run yet.</div>
          </div>
        </div>
      `;

      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }
  }

  function fillBackupForm(data) {
    backupControls = data || backupControls || {};

    const googleEnabled = document.getElementById("googleSheetBackupEnabled");
    const dailyEnabled = document.getElementById("dailyBackupEnabled");
    const dailyTime = document.getElementById("dailyBackupTime");
    const manualDate = document.getElementById("manualBackupDate");

    if (googleEnabled) googleEnabled.checked = backupControls.googleSheetBackupEnabled !== false;
    if (dailyEnabled) dailyEnabled.checked = backupControls.dailyBackupEnabled === true;
    if (dailyTime) dailyTime.value = backupControls.dailyBackupTime || "20:00";
    if (manualDate && !manualDate.value) manualDate.value = todayISO();
  }

  function renderStatusCards(statusData) {
    const controls = statusData?.controls || backupControls || {};
    const configured = document.getElementById("backupConfiguredVal");
    const lastRun = document.getElementById("backupLastRunVal");
    const lastResult = document.getElementById("backupLastResultVal");
    const lastDate = document.getElementById("backupLastDateVal");

    if (configured) configured.textContent = statusData?.configured ? "Yes" : "No";
    if (lastRun) lastRun.textContent = controls.lastRunAt ? new Date(controls.lastRunAt).toLocaleString() : "—";
    if (lastResult) lastResult.textContent = controls.lastRunOk === true ? "OK" : controls.lastRunOk === false ? "Failed" : "—";
    if (lastDate) lastDate.textContent = controls.lastRunWorkDate || "—";

    renderLastSummary(controls.lastRunSummary);
  }

  function renderLastSummary(summary) {
    const host = document.getElementById("backupLastSummaryTable");
    if (!host) return;
    const sheets = summary?.sheets || null;
    if (!sheets) {
      host.textContent = "No backup summary available.";
      return;
    }

    host.innerHTML = `
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px;">Sheet</th>
            <th style="text-align:right; padding:6px;">Rows</th>
            <th style="text-align:right; padding:6px;">Added</th>
            <th style="text-align:right; padding:6px;">Skipped/Updated</th>
          </tr>
        </thead>
        <tbody>
          ${Object.keys(sheets).map((key) => {
            const x = sheets[key] || {};
            const added = x.appended ?? x.inserted ?? 0;
            const changed = x.skippedDuplicates ?? x.updated ?? 0;
            return `<tr>
              <td style="padding:6px;">${escapeHtml(x.sheetName || key)}</td>
              <td style="text-align:right; padding:6px;">${Number(x.rowCount || 0)}</td>
              <td style="text-align:right; padding:6px;">${Number(added || 0)}</td>
              <td style="text-align:right; padding:6px;">${Number(changed || 0)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  async function loadBackupControls(force = false) {
    if (backupControlsLoaded && !force) return backupControls;
    const payload = await requestJson("/api/backup/sheets/status", { method: "GET" });
    backupControlsLoaded = true;
    backupControls = payload.data?.controls || {};
    fillBackupForm(backupControls);
    renderStatusCards(payload.data);
    return backupControls;
  }

  function readBackupForm() {
    return {
      googleSheetBackupEnabled: document.getElementById("googleSheetBackupEnabled")?.checked !== false,
      dailyBackupEnabled: document.getElementById("dailyBackupEnabled")?.checked === true,
      dailyBackupTime: document.getElementById("dailyBackupTime")?.value || "20:00"
    };
  }

  async function saveBackupControls() {
    const btn = document.getElementById("saveBackupControlsBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
      status("Saving backup controls...");

      const token = getAdminToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers["x-spwt-admin-token"] = token;

      const payload = await requestJson("/api/backup/sheets/controls", {
        method: "POST",
        headers,
        body: JSON.stringify(readBackupForm())
      });

      backupControlsLoaded = false;
      backupControls = payload.data;
      await loadBackupControls(true);
      status("Backup controls saved.", "success");
    } catch (err) {
      console.error("Backup controls save failed:", err);
      status("Save failed: " + (err?.message || err), "error");
      alert("Backup controls save failed: " + (err?.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save Backup Controls"; }
    }
  }

  async function testBackupConnection() {
    const btn = document.getElementById("testBackupBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Testing..."; }
      status("Testing Google Sheet connection...");
      await requestJson("/api/backup/sheets/test", { method: "POST" });
      status("Connection OK.", "success");
      await loadBackupControls(true);
    } catch (err) {
      status("Connection failed: " + (err?.message || err), "error");
      alert("Backup test failed: " + (err?.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Test Connection"; }
    }
  }

  async function syncBackupDate(workDate, buttonId) {
    const btn = document.getElementById(buttonId);
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Syncing..."; }
      status("Syncing backup for " + workDate + "...");

      await requestJson("/api/backup/sheets/sync-today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDate, runType: "manual-ui" })
      });

      status("Backup synced for " + workDate + ".", "success");
      backupControlsLoaded = false;
      await loadBackupControls(true);
    } catch (err) {
      status("Sync failed: " + (err?.message || err), "error");
      alert("Backup sync failed: " + (err?.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = buttonId === "syncTodayBackupBtn" ? "Sync Today" : "Sync Selected Date";
      }
    }
  }

  function wireButtons() {
    const saveBtn = document.getElementById("saveBackupControlsBtn");
    const testBtn = document.getElementById("testBackupBtn");
    const syncTodayBtn = document.getElementById("syncTodayBackupBtn");
    const syncDateBtn = document.getElementById("syncDateBackupBtn");

    if (saveBtn && !saveBtn.__spwtBackupWired) { saveBtn.__spwtBackupWired = true; saveBtn.onclick = saveBackupControls; }
    if (testBtn && !testBtn.__spwtBackupWired) { testBtn.__spwtBackupWired = true; testBtn.onclick = testBackupConnection; }
    if (syncTodayBtn && !syncTodayBtn.__spwtBackupWired) {
      syncTodayBtn.__spwtBackupWired = true;
      syncTodayBtn.onclick = () => syncBackupDate(todayISO(), "syncTodayBackupBtn");
    }
    if (syncDateBtn && !syncDateBtn.__spwtBackupWired) {
      syncDateBtn.__spwtBackupWired = true;
      syncDateBtn.onclick = () => {
        const d = document.getElementById("manualBackupDate")?.value || todayISO();
        syncBackupDate(d, "syncDateBackupBtn");
      };
    }
  }

  function showBackupTabDirectly() {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabBackupControls"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    document.getElementById("tabBackupControls")?.classList.remove("hidden");
    renderBackupControls();
  }

  async function renderBackupControls() {
    ensureBackupControlsTab();
    wireButtons();
    status("Loading backup status...");
    try {
      await loadBackupControls(true);
      status("Backup controls loaded.");
    } catch (err) {
      status("Load failed: " + (err?.message || err), "error");
    }
  }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtBackupPatched) return;

    const patched = function (tabId) {
      if (tabId === "tabBackupControls") {
        showBackupTabDirectly();
        return;
      }
      return original.apply(this, arguments);
    };
    patched.__spwtBackupPatched = true;
    window.switchAdminTab = patched;
  }

  function wireEventsOnce() {
    if (eventsWired) return;
    eventsWired = true;

    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabBackupControls"]')) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(showBackupTabDirectly, 0);
      }
      setTimeout(wireButtons, 0);
    }, true);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  async function init() {
    ensureBackupControlsTab();
    patchSwitchAdminTab();
    wireButtons();
    wireEventsOnce();
  }

  window.SPWT_RENDER_BACKUP_CONTROLS = renderBackupControls;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
