// renderer/admin/adminDatabaseRestorePatch.js
// Adds restore preview/apply UI to Admin > Database Transfer.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 180000;
  const PERMISSION = "dbTransfer";
  const RESTORE_CONFIRM_TOKEN = "RESTORE_DB";

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
  function allowed() {
    try {
      const user = window.SPWT_ADMIN_ACCESS?.getUser?.();
      if (!user) return true;
      return window.SPWT_ADMIN_ACCESS?.hasPermission?.(PERMISSION) === true;
    } catch {
      return true;
    }
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
      const headers = { ...(options.headers || {}) };
      const t = token();
      if (t) headers["x-spwt-admin-token"] = t;
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function setStatus(message, type = "") {
    const el = $("dbRestoreStatusLine");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
  }

  function miniTable(headers, rows) {
    return `<div style="overflow:auto;"><table class="admin-table" style="width:100%;border-collapse:collapse;">
      <thead><tr>${headers.map(h => `<th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td style="padding:8px;border-bottom:1px solid #eef2f8;vertical-align:top;">${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function ensureRestoreCard() {
    const page = $("tabDatabaseTransfer");
    if (!page || $("dbTransferRestoreCard")) return;

    const card = document.createElement("div");
    card.className = "card admin-controls-card";
    card.id = "dbTransferRestoreCard";
    card.style.marginTop = "12px";
    card.innerHTML = `
      <div class="section-title">Restore Transfer Package</div>
      <div class="small-hint">Use this on the new server PC after copying a transfer ZIP into the transfer_packages folder. It validates the ZIP first and restores only after confirmation.</div>

      <div class="grid-2" style="gap:12px;margin-top:12px;">
        <div class="field">
          <label>Transfer Package</label>
          <select id="dbRestorePackageSelect" class="admin-select"></select>
          <div class="small-hint">Latest package is selected automatically. Package content is checked before restore.</div>
        </div>
        <div class="field">
          <label>Safety Confirmation</label>
          <input id="dbRestoreConfirmInput" class="admin-input" type="text" placeholder="Type RESTORE_DB only before actual restore" />
          <div class="small-hint">Actual restore is blocked unless this exact text is typed.</div>
        </div>
      </div>

      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn grey" id="dbRestoreRefreshBtn" type="button">Refresh Packages</button>
        <button class="btn grey" id="dbRestorePreviewBtn" type="button">Preview / Validate Package</button>
        <label class="quality-recheck-line small-hint" style="align-items:center;gap:6px;margin:0 8px 0 0;"><input id="dbRestoreStopPbCheck" type="checkbox" checked /> Stop PocketBase before restore</label>
        <button class="btn red" id="dbRestoreApplyBtn" type="button">Restore Selected Package</button>
      </div>

      <div class="small-hint" id="dbRestoreStatusLine" style="margin-top:10px;"></div>
      <div id="dbRestoreOutput" style="margin-top:12px;"></div>

      <div class="card" style="padding:12px;margin-top:12px;background:#fff7ed;border-color:#fed7aa;">
        <div class="section-title">Restore safety rules</div>
        <div class="small-hint">- Restore replaces current <b>pb_data</b>, <b>pb_migrations</b>, and <b>.env</b>.</div>
        <div class="small-hint">- A pre-restore backup folder is created first inside <b>transfer_packages/pre_restore_backups</b>.</div>
        <div class="small-hint">- PocketBase must be stopped before replacing database files.</div>
        <div class="small-hint">- After restore, start PocketBase and restart Node/SP WorkTrack server.</div>
      </div>
    `;

    const firstCard = page.querySelector(".admin-controls-card");
    if (firstCard?.nextSibling) page.insertBefore(card, firstCard.nextSibling);
    else page.appendChild(card);

    wireRestoreButtons();
    refreshPackages(false);
  }

  function wireRestoreButtons() {
    const bindings = [
      ["dbRestoreRefreshBtn", () => refreshPackages(true)],
      ["dbRestorePreviewBtn", previewPackage],
      ["dbRestoreApplyBtn", restorePackage]
    ];
    bindings.forEach(([id, handler]) => {
      const btn = $(id);
      if (btn && !btn.__spwtRestoreWired) {
        btn.__spwtRestoreWired = true;
        btn.onclick = handler;
      }
    });
  }

  function selectedPackage() {
    return $("dbRestorePackageSelect")?.value || "";
  }

  async function refreshPackages(showStatus) {
    if (!allowed()) return;
    try {
      if (showStatus) setStatus("Refreshing transfer package list...");
      const payload = await requestJson("/api/transfer/packages", { method: "GET", timeoutMs: 60000 });
      const packages = Array.isArray(payload.data) ? payload.data : [];
      const select = $("dbRestorePackageSelect");
      if (select) {
        select.innerHTML = packages.length
          ? packages.map(pkg => `<option value="${esc(pkg.fileName)}">${esc(pkg.fileName)} (${esc(pkg.size || "")})</option>`).join("")
          : `<option value="">No transfer package found</option>`;
      }
      if (showStatus) setStatus(packages.length ? `Found ${packages.length} transfer package(s).` : "No transfer package found.", packages.length ? "success" : "error");
    } catch (err) {
      console.error(err);
      setStatus("Package refresh failed: " + (err.message || err), "error");
    }
  }

  function renderPreview(data) {
    const host = $("dbRestoreOutput");
    if (!host) return;

    const componentRows = (data.components || []).map(item => [
      esc(item.relPath || item.key),
      item.exists ? "Found" : (item.required ? "Missing" : "Not present"),
      esc(item.size || "0 B"),
      esc(item.note || "")
    ]);

    const counts = Array.isArray(data.manifest?.recordCounts) ? data.manifest.recordCounts : [];
    const countRows = counts.slice(0, 16).map(item => [
      esc(item.collection || ""),
      item.count == null ? "-" : esc(item.count),
      item.ok === false ? esc(item.message || "Unavailable") : "OK"
    ]);

    host.innerHTML = `
      <div class="grid-2" style="gap:12px;">
        <div class="card" style="padding:12px;">
          <div class="section-title">Restore Preview</div>
          <div class="small-hint"><b>Package:</b> ${esc(data.fileName || "-")}</div>
          <div class="small-hint"><b>Status:</b> ${data.ok ? "Ready for restore" : "Not ready - required item missing"}</div>
          <div class="small-hint"><b>Created:</b> ${esc(data.manifest?.createdAt || "-")}</div>
          <div class="small-hint"><b>Source server:</b> ${esc(data.manifest?.createdOnServer?.hostname || "-")}</div>
        </div>
        <div class="card" style="padding:12px;background:#eef6ff;border-color:#bfdbfe;">
          <div class="section-title">Restore behavior</div>
          ${(data.warnings || []).map(w => `<div class="small-hint">- ${esc(w)}</div>`).join("")}
        </div>
      </div>
      <div class="card" style="padding:12px;margin-top:12px;">
        <div class="section-title">Package Components</div>
        ${miniTable(["Component", "Status", "Size", "Note"], componentRows)}
      </div>
      ${countRows.length ? `<div class="card" style="padding:12px;margin-top:12px;"><div class="section-title">Manifest Record Count Preview</div>${miniTable(["Collection", "Records", "Status"], countRows)}</div>` : ""}
    `;
  }

  function renderRestoreDone(data) {
    const host = $("dbRestoreOutput");
    if (!host) return;

    const rows = (data.restored || []).map(item => [
      esc(item.key),
      item.restored ? "Restored" : "Skipped",
      esc(item.target || "")
    ]);

    host.innerHTML = `
      <div class="card" style="padding:12px;background:#ecfdf5;border-color:#bbf7d0;">
        <div class="section-title">Restore Completed</div>
        <div class="small-hint"><b>Package:</b> ${esc(data.fileName || "-")}</div>
        <div class="small-hint"><b>Pre-restore backup:</b> ${esc(data.preRestoreBackupDir || "-")}</div>
        <div class="small-hint"><b>Next:</b> Start PocketBase, restart Node/SP WorkTrack server, then verify Admin data.</div>
      </div>
      <div class="card" style="padding:12px;margin-top:12px;">
        <div class="section-title">Restored Components</div>
        ${miniTable(["Component", "Status", "Target"], rows)}
      </div>
      <div class="card" style="padding:12px;margin-top:12px;background:#eef6ff;border-color:#bfdbfe;">
        <div class="section-title">After restore checklist</div>
        ${(data.warnings || []).map(w => `<div class="small-hint">- ${esc(w)}</div>`).join("")}
      </div>
    `;
  }

  async function previewPackage() {
    if (!allowed()) return alert("No permission: Database Transfer");
    const fileName = selectedPackage();
    if (!fileName) return alert("Select a transfer package first.");

    try {
      setStatus("Validating transfer package...");
      const payload = await requestJson(`/api/transfer/restore/preview/${encodeURIComponent(fileName)}`, { method: "GET" });
      renderPreview(payload.data || {});
      setStatus(payload.data?.ok ? "Package validation passed." : "Package validation failed.", payload.data?.ok ? "success" : "error");
    } catch (err) {
      console.error(err);
      setStatus("Preview failed: " + (err.message || err), "error");
      alert("Restore preview failed:\n\n" + (err.message || err));
    }
  }

  async function restorePackage() {
    if (!allowed()) return alert("No permission: Database Transfer");
    const fileName = selectedPackage();
    if (!fileName) return alert("Select a transfer package first.");

    const confirmText = String($("dbRestoreConfirmInput")?.value || "").trim();
    if (confirmText !== RESTORE_CONFIRM_TOKEN) {
      return alert(`Type ${RESTORE_CONFIRM_TOKEN} in Safety Confirmation before actual restore.`);
    }

    const ok = confirm(
      "Restore this transfer package now?\n\n" +
      "This will replace current pb_data, pb_migrations, and .env.\n" +
      "A pre-restore backup folder will be created first.\n\n" +
      "Continue only if this is the target/test server PC."
    );
    if (!ok) return;

    const btn = $("dbRestoreApplyBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Restoring..."; }
      setStatus("Restoring package. Please wait...");
      const payload = await requestJson(`/api/transfer/restore/${encodeURIComponent(fileName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmToken: confirmText,
          stopPocketBase: $("dbRestoreStopPbCheck")?.checked !== false
        }),
        timeoutMs: REQUEST_TIMEOUT_MS
      });
      renderRestoreDone(payload.data || {});
      setStatus("Restore completed. Start PocketBase and restart Node.", "success");
    } catch (err) {
      console.error(err);
      setStatus("Restore failed: " + (err.message || err), "error");
      alert("Restore failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Restore Selected Package"; }
    }
  }

  function tick() {
    ensureRestoreCard();
    wireRestoreButtons();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 1200));
  document.addEventListener("click", event => {
    if (event.target?.closest?.('[data-tab="tabDatabaseTransfer"]')) setTimeout(tick, 250);
  }, true);
  setInterval(tick, 2000);
})();
