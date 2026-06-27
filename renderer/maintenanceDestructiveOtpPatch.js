// renderer/maintenanceDestructiveOtpPatch.js
// Adds OTP guard to remaining Maintenance destructive buttons without rewriting older UI patches.

(function () {
  if (window.__SPWT_MAINTENANCE_DESTRUCTIVE_OTP_PATCH__) return;
  window.__SPWT_MAINTENANCE_DESTRUCTIVE_OTP_PATCH__ = true;

  const REQUEST_TIMEOUT_MS = 60000;
  const ACTION_EMPTY_DB = "empty_db";
  const ACTION_DELETE_BACKUP = "delete_backup_file";

  function apiBaseUrl() {
    return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function setText(id, message, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || "";
    el.style.color = ok === false ? "#b91c1c" : ok === true ? "#15803d" : "#64748b";
    el.style.fontWeight = "900";
  }

  function showHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html || "";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[ch]));
  }

  async function postJson(path, body = {}) {
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
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestOtp(action, statusId) {
    if (typeof window.SPWT_REQUEST_MAINTENANCE_OTP !== "function") {
      throw new Error("Maintenance OTP UI is not loaded. Restart app and try again.");
    }
    setText(statusId, "Sending Maintenance OTP...", null);
    await window.SPWT_REQUEST_MAINTENANCE_OTP(action);
    setText(statusId, "OTP sent. Enter OTP and click Verify & Continue.", true);
  }

  function renderEmptyResult(data) {
    const counts = data?.counts || {};
    const changed = data?.deleted || [];
    const rows = changed.length
      ? changed.map(x => `<tr><td>${esc(x.collection)}</td><td style="text-align:right;font-weight:900;">${esc(x.deleted)}</td></tr>`).join("")
      : Object.entries(counts).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:900;">${esc(v)}</td></tr>`).join("");

    showHtml("emptyDbResult", `
      <div class="small-hint" style="margin-top:8px;font-weight:900;color:#b91c1c;">Total records: ${esc(data?.deletedTotal ?? data?.total ?? 0)}</div>
      <table><thead><tr><th>Collection</th><th style="text-align:right;">Count</th></tr></thead><tbody>${rows}</tbody></table>
    `);
  }

  function renderBackupOptions(files = []) {
    const select = document.getElementById("restoreBackupFileSelect");
    if (!select) return;
    select.innerHTML = `<option value="">Select backup file</option>` + files.map(f => {
      const label = `${f.fileName} | ${f.createdAt || f.modifiedAt || ""} | ${Math.round((Number(f.sizeBytes) || 0) / 1024)} KB`;
      return `<option value="${esc(f.fileName)}">${esc(label)}</option>`;
    }).join("");
    if (files[0]) select.value = files[0].fileName;
  }

  async function runEmptyDb(detail) {
    const confirmText = clean(document.getElementById("emptyDbConfirmText")?.value);
    const requestToken = clean(detail.otpRequestToken || detail.requestToken);
    const otp = clean(detail.otp);
    const btn = document.getElementById("confirmEmptyDbBtn");

    if (confirmText !== "EMPTY_DB") return setText("emptyDbStatus", "Type EMPTY_DB first.", false);
    if (!requestToken || !otp) return setText("emptyDbStatus", "Maintenance OTP details missing. Request OTP again.", false);

    try {
      if (btn) btn.disabled = true;
      setText("emptyDbStatus", "OTP accepted. Completing action...", null);
      const data = await postJson("/api/maintenance/empty-db/confirm", { confirmText, action: ACTION_EMPTY_DB, otpRequestToken: requestToken, requestToken, otp });
      window.SPWT_CLOSE_MAINTENANCE_OTP?.();
      renderEmptyResult(data);
      const input = document.getElementById("emptyDbConfirmText");
      if (input) input.value = "";
      setText("emptyDbStatus", "Action completed successfully.", true);
    } catch (err) {
      setText("emptyDbStatus", err?.message || String(err), false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runBackupDelete(detail) {
    const fileName = clean(document.getElementById("restoreBackupFileSelect")?.value);
    const confirmText = clean(document.getElementById("deleteBackupConfirmText")?.value);
    const requestToken = clean(detail.otpRequestToken || detail.requestToken);
    const otp = clean(detail.otp);
    const btn = document.getElementById("deleteBackupFileBtn");

    if (!fileName) return showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">Select backup file first.</div>`);
    if (confirmText !== "DELETE_BACKUP") return showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">Type DELETE_BACKUP first.</div>`);
    if (!requestToken || !otp) return showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">Maintenance OTP details missing. Request OTP again.</div>`);

    try {
      if (btn) btn.disabled = true;
      showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#0b3f73;">OTP accepted. Completing action...</div>`);
      const data = await postJson("/api/maintenance/backups/delete", { fileName, confirmText, action: ACTION_DELETE_BACKUP, otpRequestToken: requestToken, requestToken, otp });
      window.SPWT_CLOSE_MAINTENANCE_OTP?.();
      const input = document.getElementById("deleteBackupConfirmText");
      if (input) input.value = "";
      renderBackupOptions(Array.isArray(data.remaining) ? data.remaining : []);
      showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#15803d;">Deleted backup file: ${esc(data.deletedFile)}</div>`);
    } catch (err) {
      showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">${esc(err?.message || String(err))}</div>`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener("click", async (event) => {
    const emptyBtn = event.target?.closest?.("#confirmEmptyDbBtn");
    if (emptyBtn) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const confirmText = clean(document.getElementById("emptyDbConfirmText")?.value);
      if (confirmText !== "EMPTY_DB") return setText("emptyDbStatus", "Type EMPTY_DB first.", false);
      try { await requestOtp(ACTION_EMPTY_DB, "emptyDbStatus"); }
      catch (err) { setText("emptyDbStatus", err?.message || String(err), false); }
      return;
    }

    const deleteBackupBtn = event.target?.closest?.("#deleteBackupFileBtn");
    if (deleteBackupBtn) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const fileName = clean(document.getElementById("restoreBackupFileSelect")?.value);
      const confirmText = clean(document.getElementById("deleteBackupConfirmText")?.value);
      if (!fileName) return showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">Select backup file first.</div>`);
      if (confirmText !== "DELETE_BACKUP") return showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">Type DELETE_BACKUP first.</div>`);
      if (!confirm(`Delete this backup file after OTP verification?\n\n${fileName}`)) return;
      try { await requestOtp(ACTION_DELETE_BACKUP, "restoreBackupResult"); }
      catch (err) { showHtml("restoreBackupResult", `<div style="margin-top:10px;font-weight:900;color:#b91c1c;">${esc(err?.message || String(err))}</div>`); }
    }
  }, true);

  document.addEventListener("spwt-maintenance-otp-ready", (event) => {
    const detail = event?.detail || {};
    if (detail.action === ACTION_EMPTY_DB) runEmptyDb(detail);
    if (detail.action === ACTION_DELETE_BACKUP) runBackupDelete(detail);
  });
})();
