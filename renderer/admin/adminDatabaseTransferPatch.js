// renderer/admin/adminDatabaseTransferPatch.js
// Adds Database Transfer tab: check DB status, create transfer ZIP, download latest package.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 60000;
  const PERMISSION = "dbTransfer";
  const PERMISSION_LABEL = "Database Transfer";

  let latestPackage = null;
  let cachedUsers = [];
  let loadingUsers = false;

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
  function hasPermission(permission) {
    try { return window.SPWT_ADMIN_ACCESS?.hasPermission?.(permission) === true; }
    catch { return false; }
  }
  function currentUser() {
    try { return window.SPWT_ADMIN_ACCESS?.getUser?.() || null; }
    catch { return null; }
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

  function status(message, type = "") {
    const el = $("dbTransferStatusLine");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
  }

  function allowed() {
    const user = currentUser();
    if (!user) return true;
    return hasPermission(PERMISSION);
  }

  function ensureTab() {
    const panel = $("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return;

    if (!tabs.querySelector('[data-tab="tabDatabaseTransfer"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.setAttribute("data-tab", "tabDatabaseTransfer");
      btn.textContent = "Database Transfer";
      const maintenance = tabs.querySelector('[data-tab="tabMaintenance"]');
      if (maintenance?.nextSibling) tabs.insertBefore(btn, maintenance.nextSibling);
      else tabs.appendChild(btn);
    }

    if (!$("tabDatabaseTransfer")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabDatabaseTransfer";
      page.innerHTML = `
        <div class="section-title">Database Transfer</div>
        <div class="small-hint">Preparatory export package for moving SP WorkTrack database/config to a new server PC. Restore is handled separately and should not overwrite a running PocketBase database.</div>

        <div class="card admin-controls-card" style="margin-top:12px;">
          <div class="section-title">Transfer Package Wizard</div>
          <div class="small-hint">Use these buttons in sequence. No IP, link, or folder is assumed; the server detects current paths and package names.</div>

          <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px;">
            <button class="btn grey" id="dbTransferCheckBtn" type="button">1. Check Database Status</button>
            <button class="btn green" id="dbTransferCreateBtn" type="button">2. Create Transfer Package</button>
            <button class="btn grey" id="dbTransferDownloadBtn" type="button">3. Download Latest Package</button>
            <button class="btn grey" id="dbTransferCopyFolderBtn" type="button">Copy Transfer Folder Path</button>
            <button class="btn grey" id="dbTransferChecklistBtn" type="button">Print Transfer Checklist</button>
          </div>

          <div class="small-hint" id="dbTransferStatusLine" style="margin-top:10px;"></div>
          <div id="dbTransferOutput" style="margin-top:12px;"></div>
        </div>
      `;
      const footer = panel.querySelector("hr") || panel.lastElementChild;
      panel.insertBefore(page, footer);
    }

    wireButtons();
    applyPermission();
  }

  function switchToTransferTab() {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabDatabaseTransfer"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    $("tabDatabaseTransfer")?.classList.remove("hidden");
    checkStatus();
  }

  function wireButtons() {
    const checkBtn = $("dbTransferCheckBtn");
    const createBtn = $("dbTransferCreateBtn");
    const downloadBtn = $("dbTransferDownloadBtn");
    const copyBtn = $("dbTransferCopyFolderBtn");
    const checklistBtn = $("dbTransferChecklistBtn");

    if (checkBtn && !checkBtn.__wired) { checkBtn.__wired = true; checkBtn.onclick = checkStatus; }
    if (createBtn && !createBtn.__wired) { createBtn.__wired = true; createBtn.onclick = createPackage; }
    if (downloadBtn && !downloadBtn.__wired) { downloadBtn.__wired = true; downloadBtn.onclick = downloadLatest; }
    if (copyBtn && !copyBtn.__wired) { copyBtn.__wired = true; copyBtn.onclick = copyFolderPath; }
    if (checklistBtn && !checklistBtn.__wired) { checklistBtn.__wired = true; checklistBtn.onclick = printChecklist; }
  }

  function table(headers, rows) {
    return `<div style="overflow:auto;"><table class="admin-table" style="width:100%;border-collapse:collapse;">
      <thead><tr>${headers.map(h => `<th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td style="padding:8px;border-bottom:1px solid #eef2f8;vertical-align:top;">${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function renderStatus(data) {
    latestPackage = data.latestPackage || null;
    const host = $("dbTransferOutput");
    if (!host) return;

    const componentRows = (data.components || []).map(item => [
      esc(item.relPath),
      item.exists ? "✅ Found" : (item.required ? "❌ Missing" : "Not present"),
      esc(item.size || "0 B"),
      esc(item.note || "")
    ]);

    const countRows = (data.recordCounts || []).map(item => [
      esc(item.collection),
      item.ok ? esc(item.count) : "Unavailable",
      item.ok ? "OK" : esc(item.message || "Missing/unavailable")
    ]);

    host.innerHTML = `
      <div class="grid-2" style="gap:12px;">
        <div class="card" style="padding:12px;">
          <div class="section-title">Server / Folder Status</div>
          <div class="small-hint"><b>Server:</b> ${esc(data.server?.hostname || "-")}</div>
          <div class="small-hint"><b>Root:</b> ${esc(data.rootDir || "-")}</div>
          <div class="small-hint"><b>Transfer folder:</b> <span id="dbTransferFolderText">${esc(data.transferDir || "-")}</span></div>
          <div class="small-hint"><b>Total detected size:</b> ${esc(data.totalComponentSize || "-")}</div>
          <div class="small-hint"><b>Status:</b> ${data.ready ? "✅ Ready for package creation" : "❌ Required component missing"}</div>
        </div>
        <div class="card" style="padding:12px;">
          <div class="section-title">Latest Package</div>
          ${latestPackage ? `
            <div class="small-hint"><b>File:</b> ${esc(latestPackage.fileName)}</div>
            <div class="small-hint"><b>Size:</b> ${esc(latestPackage.size)}</div>
            <div class="small-hint"><b>Path:</b> <span id="dbTransferLatestPath">${esc(latestPackage.fullPath)}</span></div>
          ` : `<div class="small-hint">No transfer package created yet.</div>`}
        </div>
      </div>

      <div class="card" style="padding:12px;margin-top:12px;">
        <div class="section-title">Database Components</div>
        ${table(["Component", "Status", "Size", "Purpose"], componentRows)}
      </div>

      <div class="card" style="padding:12px;margin-top:12px;">
        <div class="section-title">Record Count Preview</div>
        <div class="small-hint">Counts are for transfer confidence only. Some optional collections may show unavailable if not created yet.</div>
        ${table(["Collection", "Records", "Status"], countRows)}
      </div>

      <div class="card" style="padding:12px;margin-top:12px;background:#fff7ed;border-color:#fed7aa;">
        <div class="section-title">Important Notes</div>
        ${(data.warnings || []).map(w => `<div class="small-hint">⚠ ${esc(w)}</div>`).join("")}
      </div>
    `;
  }

  async function checkStatus() {
    if (!allowed()) return alert(`No permission: ${PERMISSION_LABEL}`);
    try {
      status("Checking database transfer status...");
      const payload = await requestJson("/api/transfer/status", { method: "GET" });
      renderStatus(payload.data || {});
      status("Database status checked.", "success");
    } catch (err) {
      console.error(err);
      status("Status check failed: " + (err.message || err), "error");
      alert("Database transfer status failed:\n\n" + (err.message || err));
    }
  }

  async function createPackage() {
    if (!allowed()) return alert(`No permission: ${PERMISSION_LABEL}`);
    const ok = confirm("Create database transfer package now?\n\nFor final migration, stop new production entry before creating the last package. Package may contain .env secrets.");
    if (!ok) return;

    const btn = $("dbTransferCreateBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }
      status("Creating transfer package. Please wait...");
      const payload = await requestJson("/api/transfer/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Created from Admin Database Transfer tab" }),
        timeoutMs: 180000
      });
      latestPackage = payload.data || null;
      status(`Package created: ${latestPackage?.fileName || "Done"}`, "success");
      await checkStatus();
    } catch (err) {
      console.error(err);
      status("Package creation failed: " + (err.message || err), "error");
      alert("Transfer package creation failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "2. Create Transfer Package"; }
    }
  }

  async function downloadLatest() {
    if (!allowed()) return alert(`No permission: ${PERMISSION_LABEL}`);
    if (!latestPackage?.fileName) await checkStatus();
    if (!latestPackage?.fileName) return alert("No transfer package available. Create package first.");

    try {
      status("Downloading transfer package...");
      const headers = {};
      const t = token();
      if (t) headers["x-spwt-admin-token"] = t;
      const res = await fetch(`${API_BASE_URL}/api/transfer/package/download/${encodeURIComponent(latestPackage.fileName)}`, { headers });
      if (!res.ok) throw new Error(`Download failed ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = latestPackage.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      status("Download started.", "success");
    } catch (err) {
      console.error(err);
      status("Download failed: " + (err.message || err), "error");
      alert("Download failed:\n\n" + (err.message || err));
    }
  }

  async function copyFolderPath() {
    const text = $("dbTransferFolderText")?.textContent || "";
    if (!text) return alert("Run Check Database Status first.");
    try {
      await navigator.clipboard.writeText(text);
      status("Transfer folder path copied.", "success");
    } catch {
      prompt("Copy transfer folder path:", text);
    }
  }

  function printChecklist() {
    const folder = $("dbTransferFolderText")?.textContent || "Run Check Database Status first";
    const pkg = latestPackage?.fileName || "Create package first";
    const html = `<!doctype html><html><head><title>SP WorkTrack Transfer Checklist</title><style>body{font-family:Arial;padding:24px;line-height:1.5;}li{margin:8px 0;}code{background:#f1f5f9;padding:2px 5px;border-radius:4px;}</style></head><body>
      <h2>SP WorkTrack Database Transfer Checklist</h2>
      <p><b>Transfer folder:</b> ${esc(folder)}</p>
      <p><b>Latest package:</b> ${esc(pkg)}</p>
      <ol>
        <li>On old server PC, stop new production entry for final transfer.</li>
        <li>Create fresh transfer package from Admin &gt; Database Transfer.</li>
        <li>Copy ZIP to external drive or secure shared location.</li>
        <li>On new server PC, install SP WorkTrack runtime.</li>
        <li>Stop PocketBase before restoring <code>pb_data</code>.</li>
        <li>Restore package contents using restore wizard/procedure.</li>
        <li>Start PocketBase and Node server.</li>
        <li>Open Admin and verify login, employees, machines, planned absences, production reports.</li>
      </ol>
    </body></html>`;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return alert("Popup blocked. Allow popups for SP WorkTrack.");
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }

  async function loadUsersForAccess() {
    if (loadingUsers || !hasPermission("userAccess")) return;
    loadingUsers = true;
    try {
      const payload = await requestJson("/api/admin/access-users", { method: "GET" });
      cachedUsers = Array.isArray(payload.data?.users) ? payload.data.users : [];
      injectAccessPermission();
    } catch (err) {
      console.warn("Database Transfer permission load skipped:", err);
    } finally {
      loadingUsers = false;
    }
  }

  function injectAccessPermission() {
    const rows = Array.from(document.querySelectorAll("#accessUsersList tbody tr"));
    rows.forEach((row, idx) => {
      const cell = row.children[4];
      if (!cell || cell.querySelector('[data-spwt-extra-perm="dbTransfer"]')) return;
      const perms = Array.isArray(cachedUsers[idx]?.permissions) ? cachedUsers[idx].permissions : [];
      const box = cell.querySelector(".spwt-extra-permissions") || cell;
      const label = document.createElement("label");
      label.className = "spwt-permission-check";
      label.title = PERMISSION_LABEL;
      label.style.marginLeft = "8px";
      label.innerHTML = `<input type="checkbox" data-spwt-extra-perm="dbTransfer" ${perms.includes("dbTransfer") ? "checked" : ""} />${PERMISSION_LABEL}`;
      box.appendChild(label);
    });
  }

  function applyPermission() {
    const tab = document.querySelector('[data-tab="tabDatabaseTransfer"]');
    const page = $("tabDatabaseTransfer");
    const isAllowed = allowed();
    if (tab) tab.style.display = isAllowed ? "" : "none";
    if (page && !isAllowed) page.classList.add("hidden");
  }

  function tick() {
    ensureTab();
    applyPermission();
    if ($("tabUsersAccess") && hasPermission("userAccess")) {
      if (!cachedUsers.length) loadUsersForAccess();
      injectAccessPermission();
    }
  }

  document.addEventListener("click", (event) => {
    const tab = event.target?.closest?.('[data-tab="tabDatabaseTransfer"]');
    if (tab) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!allowed()) return alert(`No permission: ${PERMISSION_LABEL}`);
      setTimeout(switchToTransferTab, 0);
      return;
    }
    if (event.target?.closest?.('[data-tab="tabUsersAccess"], #adminLoginBtn, #addAccessUserBtn')) {
      setTimeout(() => { loadUsersForAccess(); tick(); }, 400);
    } else {
      setTimeout(tick, 150);
    }
  }, true);

  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 900));
  setInterval(tick, 2000);
})();