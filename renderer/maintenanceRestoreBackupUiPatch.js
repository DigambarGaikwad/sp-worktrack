// renderer/maintenanceRestoreBackupUiPatch.js
// Adds Restore DB Backup UI in Maintenance tab with OTP verification.

(function () {
  const REQUEST_TIMEOUT_MS = 60000;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function post(path, body = {}) {
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
      if (/failed to fetch/i.test(String(err?.message || err))) throw new Error("Cannot reach backend server. Restart npm run server and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function show(id, message, type = "info") {
    const el = document.getElementById(id);
    if (!el) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#0b3f73";
    el.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function renderCounts(counts = {}) {
    const rows = Object.entries(counts).map(([name, count]) => `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:900;">${esc(count)}</td></tr>`).join("");
    return rows ? `<table><thead><tr><th>Collection</th><th style="text-align:right;">Records</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="small-hint">No count data.</div>`;
  }

  function waitOtp(action) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          document.removeEventListener("spwt-maintenance-otp-ready", handler);
          reject(new Error("OTP timed out. Try restore again."));
        }
      }, 600000);

      function handler(e) {
        const d = e.detail || {};
        if (d.action !== action) return;
        done = true;
        clearTimeout(timeout);
        document.removeEventListener("spwt-maintenance-otp-ready", handler);
        if (!clean(d.otp) || !clean(d.otpRequestToken)) reject(new Error("OTP token missing. Request OTP again."));
        else resolve(d);
      }

      document.addEventListener("spwt-maintenance-otp-ready", handler);
      if (typeof window.SPWT_REQUEST_MAINTENANCE_OTP !== "function") {
        done = true;
        clearTimeout(timeout);
        document.removeEventListener("spwt-maintenance-otp-ready", handler);
        reject(new Error("OTP UI not loaded. Reopen Admin window."));
        return;
      }
      show("restoreBackupResult", "Sending OTP to Admin recovery email...");
      window.SPWT_REQUEST_MAINTENANCE_OTP(action).catch(reject);
    });
  }

  function ensureBox() {
    const grid = document.querySelector("#tabMaintenance .maintenance-grid");
    if (!grid || document.getElementById("restoreBackupBox")) return;
    const box = document.createElement("div");
    box.className = "maintenance-box";
    box.id = "restoreBackupBox";
    box.innerHTML = `
      <div class="maintenance-title">6. Restore DB Backup</div>
      <div class="small-hint">Restore records from a local backup JSON in the backups folder. A safety backup is created before restore.</div>
      <button class="btn grey" id="loadBackupFilesBtn" type="button">Load Backup Files</button>
      <div class="field" style="margin-top:8px;">
        <label>Select Backup File</label>
        <select id="restoreBackupFileSelect" class="admin-select" style="width:100%;"><option value="">Click Load Backup Files</option></select>
      </div>
      <div class="small-hint danger-note">Restore mode replaces collections available in selected backup.</div>
      <label class="confirm-label">Type RESTORE here to confirm</label>
      <input id="restoreBackupConfirmText" class="admin-input confirm-input" placeholder="RESTORE" autocomplete="off" />
      <button class="btn red" id="restoreBackupBtn" type="button">Restore Selected Backup</button>
      <div id="restoreBackupResult"></div>
    `;
    grid.appendChild(box);
  }

  async function loadFiles(btn) {
    try {
      if (btn) btn.disabled = true;
      show("restoreBackupResult", "Loading backup files...");
      const data = await post("/api/maintenance/backups/list", {});
      const files = Array.isArray(data.files) ? data.files : [];
      const select = document.getElementById("restoreBackupFileSelect");
      if (select) {
        select.innerHTML = `<option value="">Select backup file</option>` + files.map(f => {
          const label = `${f.fileName} | ${f.createdAt || f.modifiedAt || ""} | ${Math.round((Number(f.sizeBytes)||0)/1024)} KB`;
          return `<option value="${esc(f.fileName)}">${esc(label)}</option>`;
        }).join("");
      }
      if (!files.length) show("restoreBackupResult", `No backup files found in ${data.folder || "backups folder"}.`, "error");
      else {
        const firstCounts = files[0]?.counts || {};
        const html = `<div style="margin-top:10px;font-weight:900;color:#15803d;">Loaded ${files.length} backup file(s). Latest selected by default.</div>${renderCounts(firstCounts)}`;
        const el = document.getElementById("restoreBackupResult");
        if (el) el.innerHTML = html;
        if (select && files[0]) select.value = files[0].fileName;
      }
    } catch (err) {
      show("restoreBackupResult", err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function restore(btn) {
    try {
      const fileName = clean(document.getElementById("restoreBackupFileSelect")?.value);
      const confirmText = clean(document.getElementById("restoreBackupConfirmText")?.value);
      if (!fileName) throw new Error("Select backup file first.");
      if (confirmText !== "RESTORE") throw new Error("Type RESTORE in the confirmation box first.");
      if (btn) btn.disabled = true;
      const otp = await waitOtp("restore_backup");
      show("restoreBackupResult", "OTP accepted. Restoring backup... please wait.");
      const data = await post("/api/maintenance/restore-backup", { fileName, mode: "replace", otpRequestToken: otp.otpRequestToken, otp: otp.otp });
      const restoredCounts = Object.fromEntries((data.restored || []).map(x => [x.collection, x.created]));
      const el = document.getElementById("restoreBackupResult");
      if (el) {
        el.innerHTML = `<div style="margin-top:10px;font-weight:900;color:#15803d;">Backup restored successfully from ${esc(data.restoredFrom)}.</div><div class="small-hint">Safety backup before restore: <b>${esc(data.safetyBackupBeforeRestore)}</b></div>${renderCounts(restoredCounts)}`;
      }
      document.getElementById("restoreBackupConfirmText").value = "";
      window.SPWT_CLOSE_MAINTENANCE_OTP?.();
    } catch (err) {
      show("restoreBackupResult", err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wire() {
    ensureBox();
    const loadBtn = document.getElementById("loadBackupFilesBtn");
    const restoreBtn = document.getElementById("restoreBackupBtn");
    if (loadBtn && !loadBtn.__restoreWired) {
      loadBtn.__restoreWired = true;
      loadBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); loadFiles(loadBtn); }, true);
    }
    if (restoreBtn && !restoreBtn.__restoreWired) {
      restoreBtn.__restoreWired = true;
      restoreBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); restore(restoreBtn); }, true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(wire, 800));
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.('[data-tab="tabMaintenance"]')) setTimeout(wire, 300);
    setTimeout(wire, 120);
  }, true);
  setInterval(() => {
    const tab = document.getElementById("tabMaintenance");
    if (tab && !tab.classList.contains("hidden")) wire();
  }, 1500);
})();
