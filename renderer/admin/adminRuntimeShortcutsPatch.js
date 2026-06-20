// renderer/admin/adminRuntimeShortcutsPatch.js
// Adds desktop/runtime shortcut controls to Admin > Database Transfer without changing the core transfer wizard.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 60000;

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
  function hasDbTransferPermission() {
    try {
      const user = window.SPWT_ADMIN_ACCESS?.getUser?.();
      if (!user) return true;
      return window.SPWT_ADMIN_ACCESS?.hasPermission?.("dbTransfer") === true;
    } catch {
      return false;
    }
  }

  function setRuntimeStatus(message, type = "") {
    const el = $("dbRuntimeStatusLine");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
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

  function ensureShortcutInfoBox() {
    const runtimeOutput = $("dbRuntimeOutput");
    const tab = $("tabDatabaseTransfer");
    if (!runtimeOutput && !tab) return null;

    let box = $("dbRuntimeShortcutInfo");
    if (box) return box;

    box = document.createElement("div");
    box.id = "dbRuntimeShortcutInfo";
    box.className = "card";
    box.style.cssText = "padding:12px;margin-top:12px;background:#f8fafc;border:1px solid #dbe4ef;border-radius:14px;";
    box.innerHTML = `
      <div class="section-title">Desktop Runtime Shortcuts</div>
      <div class="small-hint">Create shortcuts on the server PC desktop so SP WorkTrack can be started/stopped/restarted without terminal commands.</div>
    `;

    if (runtimeOutput) runtimeOutput.insertAdjacentElement("afterend", box);
    else tab.appendChild(box);
    return box;
  }

  function renderShortcutResult(data = {}) {
    const box = ensureShortcutInfoBox();
    if (!box) return;
    const rows = Array.isArray(data.shortcuts) ? data.shortcuts : [];
    box.innerHTML = `
      <div class="section-title">Desktop Runtime Shortcuts</div>
      <div class="small-hint"><b>Status:</b> ${esc(data.message || "Shortcut action completed.")}</div>
      <div class="small-hint"><b>Desktop:</b> ${esc(data.desktop || "Server PC desktop")}</div>
      <div class="small-hint"><b>Runtime folder:</b> ${esc(data.scripts?.runtimeDir || data.scripts?.runtimeDir || "runtime_scripts")}</div>
      ${rows.length ? `
        <div style="overflow:auto;margin-top:8px;">
          <table class="admin-table" style="width:100%;border-collapse:collapse;">
            <thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">Shortcut</th><th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">Path</th></tr></thead>
            <tbody>${rows.map(r => `<tr><td style="padding:8px;border-bottom:1px solid #eef2f8;">${esc(r.name)}</td><td style="padding:8px;border-bottom:1px solid #eef2f8;">${esc(r.path)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      ` : ""}
      <div class="small-hint" style="margin-top:8px;line-height:1.5;">
        Shortcuts created: Start SP WorkTrack, Stop SP WorkTrack, Restart SP WorkTrack, and Open SP WorkTrack.<br>
        If Node is stopped, use <b>Start SP WorkTrack</b> or <b>Restart SP WorkTrack</b> from the server PC desktop.
      </div>
    `;
  }

  async function createDesktopShortcuts() {
    if (!hasDbTransferPermission()) return alert("No permission: Database Transfer");
    const ok = confirm("Create Start / Stop / Restart / Open shortcuts on the server PC desktop?\n\nUse these shortcuts when running SP WorkTrack as an app without terminal commands.");
    if (!ok) return;

    const btn = $("dbRuntimeCreateShortcutsBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Creating Shortcuts..."; }
      setRuntimeStatus("Creating runtime desktop shortcuts on server PC...");
      const payload = await requestJson("/api/transfer/runtime/shortcuts/create", { method: "POST", timeoutMs: 120000 });
      renderShortcutResult(payload.data || {});
      setRuntimeStatus("Runtime desktop shortcuts created.", "success");
    } catch (err) {
      console.error("Create runtime shortcuts failed:", err);
      setRuntimeStatus("Shortcut creation failed: " + (err?.message || err), "error");
      alert("Create runtime shortcuts failed:\n\n" + (err?.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Create Desktop Shortcuts"; }
    }
  }

  async function openRuntimeFolder() {
    if (!hasDbTransferPermission()) return alert("No permission: Database Transfer");
    const btn = $("dbRuntimeOpenFolderBtn");
    try {
      if (btn) btn.disabled = true;
      setRuntimeStatus("Opening runtime folder on server PC...");
      const payload = await requestJson("/api/transfer/runtime/folder/open", { method: "POST" });
      setRuntimeStatus(payload.data?.message || "Runtime folder open command sent.", "success");
    } catch (err) {
      console.error("Open runtime folder failed:", err);
      setRuntimeStatus("Open folder failed: " + (err?.message || err), "error");
      alert("Open runtime folder failed:\n\n" + (err?.message || err));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function ensureButtons() {
    const removeBtn = $("dbRuntimeRemoveTasksBtn");
    const row = removeBtn?.parentElement || $("dbRuntimeCheckBtn")?.parentElement;
    if (!row) return;

    if (!$ ("dbRuntimeCreateShortcutsBtn")) {
      const btn = document.createElement("button");
      btn.className = "btn green";
      btn.id = "dbRuntimeCreateShortcutsBtn";
      btn.type = "button";
      btn.textContent = "Create Desktop Shortcuts";
      btn.title = "Creates Start / Stop / Restart / Open shortcuts on the server PC desktop.";
      row.appendChild(btn);
    }

    if (!$("dbRuntimeOpenFolderBtn")) {
      const btn = document.createElement("button");
      btn.className = "btn grey";
      btn.id = "dbRuntimeOpenFolderBtn";
      btn.type = "button";
      btn.textContent = "Open Runtime Folder";
      btn.title = "Opens runtime_scripts folder on the server PC.";
      row.appendChild(btn);
    }

    const shortcutBtn = $("dbRuntimeCreateShortcutsBtn");
    if (shortcutBtn && !shortcutBtn.__spwtShortcutWired) {
      shortcutBtn.__spwtShortcutWired = true;
      shortcutBtn.onclick = createDesktopShortcuts;
    }

    const folderBtn = $("dbRuntimeOpenFolderBtn");
    if (folderBtn && !folderBtn.__spwtFolderWired) {
      folderBtn.__spwtFolderWired = true;
      folderBtn.onclick = openRuntimeFolder;
    }

    const info = ensureShortcutInfoBox();
    if (info && !info.__spwtDefaultText) {
      info.__spwtDefaultText = true;
      info.innerHTML = `
        <div class="section-title">Desktop Runtime Shortcuts</div>
        <div class="small-hint">Use <b>Create Desktop Shortcuts</b> to add these shortcuts on the server PC desktop:</div>
        <div class="small-hint" style="line-height:1.6;margin-top:6px;">
          - Start SP WorkTrack<br>
          - Stop SP WorkTrack<br>
          - Restart SP WorkTrack<br>
          - Open SP WorkTrack
        </div>
        <div class="small-hint" style="margin-top:6px;">These shortcuts allow app-mode operation without opening terminal or typing <code>npm run server</code>.</div>
      `;
    }
  }

  function tick() {
    if ($("tabDatabaseTransfer") && !$("tabDatabaseTransfer").classList.contains("hidden")) ensureButtons();
  }

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.('[data-tab="tabDatabaseTransfer"]')) setTimeout(ensureButtons, 350);
    setTimeout(tick, 200);
  }, true);
  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 1200));
  setInterval(tick, 1600);
})();