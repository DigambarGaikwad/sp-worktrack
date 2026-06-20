// renderer/admin/adminExtendedAccessUiPatch.js
// Adds Users & Access controls for dynamic admin tabs and hides those tabs by permission.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;

  const EXTRA_PERMISSIONS = [
    { key: "backupControls", label: "Backup to Google Sheet", tabId: "tabBackupControls" },
    { key: "reportEmails", label: "Report Emails", tabId: "tabQualityReportEmails" },
    { key: "maintenance", label: "Maintenance", tabId: "tabMaintenance" },
    { key: "performanceComments", label: "Performance Comments", tabId: "tabPerformanceComments" },
    { key: "dbTransfer", label: "Database Transfer", tabId: "tabDatabaseTransfer" },
    { key: "systemInfo", label: "System Info", tabId: "tabSystemInfo" },
    { key: "systemConfig", label: "System Settings", tabId: "tabSystemConfig" }
  ];

  let cachedUsers = [];
  let loading = false;
  let observerStarted = false;

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || ""; }
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
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { ...(options.headers || {}) };
      const t = token();
      if (t) headers["X-SPWT-Admin-Token"] = t;
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadUsers() {
    if (loading || !hasPermission("userAccess")) return;
    loading = true;
    try {
      const payload = await requestJson("/api/admin/access-users", { method: "GET" });
      cachedUsers = Array.isArray(payload.data?.users) ? payload.data.users : [];
      injectExtraPermissionChecks();
    } catch (err) {
      console.warn("Extended Users & Access load skipped:", err);
    } finally {
      loading = false;
    }
  }

  function collectUsersFromDom() {
    const rows = Array.from(document.querySelectorAll("#accessUsersList tbody tr"));
    return rows.map((row, idx) => {
      const get = (field) => row.querySelector(`[data-au-field="${field}"]`);
      const permissions = Array.from(row.querySelectorAll('[data-au-perm]:checked, [data-spwt-extra-perm]:checked'))
        .map(el => el.getAttribute("data-au-perm") || el.getAttribute("data-spwt-extra-perm"))
        .filter(Boolean);
      return {
        username: (get("username")?.value || "").trim(),
        displayName: (get("displayName")?.value || "").trim(),
        role: get("role")?.value || cachedUsers[idx]?.role || "supervisor",
        pin: (get("pin")?.value || "").trim(),
        active: (get("active")?.value || "true") === "true",
        permissions: Array.from(new Set(permissions))
      };
    }).filter(user => user.username);
  }

  async function saveUsersWithExtendedPermissions() {
    if (!hasPermission("userAccess")) return alert("No permission: Users & Access");
    const btn = $("saveAccessUsersBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
      const users = collectUsersFromDom();
      const payload = await requestJson("/api/admin/access-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users })
      });
      cachedUsers = Array.isArray(payload.data) ? payload.data : [];
      alert("Users & Access saved.");
      setTimeout(() => { injectExtraPermissionChecks(); applyDynamicTabPermissions(); }, 250);
    } catch (err) {
      console.error(err);
      alert("Users & Access save failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save Users & Access"; }
    }
  }

  function injectExtraPermissionChecks() {
    const rows = Array.from(document.querySelectorAll("#accessUsersList tbody tr"));
    if (!rows.length) return;

    rows.forEach((row, idx) => {
      const cell = row.children[4];
      if (!cell || cell.querySelector(".spwt-extra-permissions")) return;

      const user = cachedUsers[idx] || {};
      const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
      const box = document.createElement("div");
      box.className = "spwt-extra-permissions";
      box.style.cssText = "margin-top:6px;padding-top:6px;border-top:1px dashed #dbe3ee;display:flex;gap:8px;flex-wrap:wrap;";
      box.innerHTML = EXTRA_PERMISSIONS.map((p) => `
        <label class="spwt-permission-check" title="${esc(p.label)}">
          <input type="checkbox" data-spwt-extra-perm="${esc(p.key)}" ${userPerms.includes(p.key) ? "checked" : ""} />${esc(p.label)}
        </label>`).join("");
      cell.appendChild(box);
    });

    wireSaveButton();
  }

  function wireSaveButton() {
    const btn = $("saveAccessUsersBtn");
    if (!btn || btn.__spwtExtendedAccessSaveWired) return;
    btn.__spwtExtendedAccessSaveWired = true;
    btn.onclick = saveUsersWithExtendedPermissions;
  }

  function allowedForTab(tabId) {
    const rule = EXTRA_PERMISSIONS.find(p => p.tabId === tabId);
    if (!rule) return true;
    const user = currentUser();
    if (!user) return true;
    return hasPermission(rule.key);
  }

  function applyDynamicTabPermissions() {
    const user = currentUser();
    if (!user) return;

    EXTRA_PERMISSIONS.forEach((p) => {
      const allowed = hasPermission(p.key);
      const tab = document.querySelector(`.tab[data-tab="${p.tabId}"]`);
      const page = $(p.tabId);
      if (tab) tab.style.display = allowed ? "" : "none";
      if (page && !allowed) page.classList.add("hidden");
    });
  }

  function wireTabBlocker() {
    if (document.__spwtExtendedAccessTabBlocker) return;
    document.__spwtExtendedAccessTabBlocker = true;
    document.addEventListener("click", (event) => {
      const tab = event.target?.closest?.(".tab[data-tab]");
      if (!tab) return;
      const tabId = tab.getAttribute("data-tab");
      const rule = EXTRA_PERMISSIONS.find(p => p.tabId === tabId);
      if (!rule || allowedForTab(tabId)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      alert(`No permission: ${rule.label}`);
    }, true);
  }

  function startObserver() {
    if (observerStarted) return;
    const panel = $("adminPanel");
    if (!panel) return;
    observerStarted = true;
    const observer = new MutationObserver(() => {
      injectExtraPermissionChecks();
      wireSaveButton();
      applyDynamicTabPermissions();
    });
    observer.observe(panel, { childList: true, subtree: true });
  }

  function tick() {
    startObserver();
    wireTabBlocker();
    wireSaveButton();
    applyDynamicTabPermissions();
    if ($("tabUsersAccess") && hasPermission("userAccess") && !cachedUsers.length) loadUsers();
    injectExtraPermissionChecks();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 700));
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.('[data-tab="tabUsersAccess"], #adminLoginBtn, #addAccessUserBtn')) {
      setTimeout(() => { loadUsers(); tick(); }, 300);
    } else {
      setTimeout(tick, 120);
    }
  }, true);
  setInterval(tick, 1500);
})();
