// renderer/admin/adminAccessUi.js
// DB-mode Admin RBAC UI.
// Handles username/PIN login, tab permission visibility, and Users & Access management.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;
  const MAX_INIT_ATTEMPTS = 12;
  const INIT_RETRY_MS = 250;
  const HIDDEN_LEGACY_PERMISSIONS = new Set(["workStandards"]);

  const PERMISSION_LABELS = {
    machines: "Machines",
    employees: "Employees",
    shifts: "Shifts",
    lossReasons: "Loss Reasons",
    rootAreas: "Root Areas",
    workCatalog: "Work & Sub Work",
    standardTime: "Standard Time",
    adminControls: "Admin Controls",
    workStandards: "Work & Sub Work / Standards",
    plannedAbsence: "Planned Absence",
    skillMatrix: "Skill Matrix",
    pin: "Change Admin PIN",
    userAccess: "Users & Access"
  };

  const TAB_PERMISSION = {
    tabMachines: "machines",
    tabEmployees: "employees",
    tabShifts: "shifts",
    tabLossReasons: "lossReasons",
    tabRootAreas: "rootAreas",
    tabWork: "workCatalog",
    tabControls: "adminControls",
    tabPin: "pin",
    tabUsersAccess: "userAccess"
  };

  let accessState = { token: "", user: null, permissions: [], roleTemplates: {}, users: [] };
  let loginBusy = false;
  let savingUsers = false;
  let initAttempts = 0;
  let loginGuardWired = false;

  document.addEventListener("DOMContentLoaded", scheduleInit);

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) { return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function apiData(payload) { return payload?.data ?? payload ?? {}; }

  function scheduleInit() { initAttempts += 1; const ready = initAccessUi(); if (!ready && initAttempts < MAX_INIT_ATTEMPTS) setTimeout(scheduleInit, INIT_RETRY_MS); }

  function expandLegacyPermissions(perms) { const set = new Set(Array.isArray(perms) ? perms : []); if (set.has("workStandards")) { set.add("workCatalog"); set.add("standardTime"); } return Array.from(set); }
  function visiblePermissions(list) { const expanded = expandLegacyPermissions(Array.isArray(list) ? list : []); const set = new Set(expanded); HIDDEN_LEGACY_PERMISSIONS.forEach((p) => set.delete(p)); if (expanded.includes("workStandards")) { set.add("workCatalog"); set.add("standardTime"); } return Array.from(set).filter((p) => PERMISSION_LABELS[p]); }
  function hasPermission(permission) { const user = accessState.user || {}; if (user.role === "super_admin") return true; if (Array.isArray(user.permissions) && user.permissions.includes("all")) return true; return expandLegacyPermissions(user.permissions).includes(permission); }

  function initAccessUi() {
    const hasLogin = !!$("adminLoginBox") && !!$("adminPinInput");
    const hasPanel = !!$("adminPanel");
    if (!hasLogin || !hasPanel) return false;
    enhanceLoginBox(); ensureUsersAccessTab(); wireAdminLogin(); wireAdminLoginGuard(); wireAdminLogout(); wireTokenHeaderProvider(); wireTabPermissionGate(); exposeAccessState(); forceLoginUnlocked(); return true;
  }

  function exposeAccessState() {
    window.SPWT_ADMIN_ACCESS = { getToken: () => accessState.token, getUser: () => accessState.user, hasPermission, refreshPermissionUi: () => { applyPermissionUi(); notifyPermissionUiChanged(); } };
  }
  function notifyPermissionUiChanged() { try { window.SPWT_APPLY_STANDARD_TIME_LOCK?.(); } catch (err) { console.warn(err); } try { window.SPWT_RENDER_ADMIN_CONTROLS?.(); } catch (err) {} }
  function setLoginStatus(message, type = "") { const box = $("adminLoginStatus"); if (!box) return; box.textContent = message || ""; box.classList.remove("spwt-login-error", "spwt-login-success"); if (type === "error") box.classList.add("spwt-login-error"); if (type === "success") box.classList.add("spwt-login-success"); }

  function forceLoginUnlocked() { loginBusy = false; const userInput = $("adminUserInput"); const pinInput = $("adminPinInput"); const loginBtn = $("adminLoginBtn"); const cancelBtn = $("adminCancelBtn"); if (userInput) userInput.disabled = false; if (pinInput) pinInput.disabled = false; if (cancelBtn) cancelBtn.disabled = false; if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = "Login"; loginBtn.type = "button"; } }
  function setLoginBusy(isBusy) { loginBusy = !!isBusy; const userInput = $("adminUserInput"); const pinInput = $("adminPinInput"); const loginBtn = $("adminLoginBtn"); const cancelBtn = $("adminCancelBtn"); if (userInput) userInput.disabled = loginBusy; if (pinInput) pinInput.disabled = loginBusy; if (cancelBtn) cancelBtn.disabled = loginBusy; if (loginBtn) { loginBtn.disabled = loginBusy; loginBtn.textContent = loginBusy ? "Checking..." : "Login"; loginBtn.type = "button"; } }

  function resetLoginAfterFailure(message) {
    accessState.token = ""; accessState.user = null;
    if (typeof isAdminLoggedIn !== "undefined") isAdminLoggedIn = false;
    setLoginStatus(message || "Wrong username or PIN.", "error");
    const pinInput = $("adminPinInput"); if (pinInput) pinInput.value = "";
    forceLoginUnlocked(); setTimeout(forceLoginUnlocked, 0); setTimeout(forceLoginUnlocked, 150);
    setTimeout(() => { const input = $("adminPinInput"); if (input) { input.disabled = false; input.focus(); } }, 180);
  }

  function enhanceLoginBox() {
    const loginBox = $("adminLoginBox"); const pinInput = $("adminPinInput"); if (!loginBox || !pinInput) return;
    if (!$("adminUserInput")) { const userField = document.createElement("div"); userField.className = "field"; userField.innerHTML = `<label>User Name</label><input id="adminUserInput" type="text" placeholder="admin / supervisor / engineer" value="admin" autocomplete="username" />`; pinInput.closest(".field")?.before(userField); }
    pinInput.setAttribute("autocomplete", "current-password");
    if (!$("adminLoginStatus")) { const statusBox = document.createElement("div"); statusBox.id = "adminLoginStatus"; statusBox.className = "small-hint spwt-login-status"; loginBox.appendChild(statusBox); }
    const hint = loginBox.querySelector(".small-hint:not(#adminLoginStatus)"); if (hint) hint.textContent = "Login with username + PIN. Default super admin username is admin.";
    [$("adminUserInput"), pinInput].forEach((input) => { if (!input || input.__spwtEnterLoginWired) return; input.__spwtEnterLoginWired = true; input.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); doAdminLogin(); } }, true); });
  }

  function ensureUsersAccessTab() {
    const tabs = document.querySelector("#adminPanel .tabs");
    if (tabs && !document.querySelector('[data-tab="tabUsersAccess"]')) { const btn = document.createElement("button"); btn.type = "button"; btn.className = "tab"; btn.setAttribute("data-tab", "tabUsersAccess"); btn.textContent = "Users & Access"; tabs.appendChild(btn); }
    const panel = $("adminPanel");
    if (panel && !$("tabUsersAccess")) { const page = document.createElement("div"); page.className = "tab-page hidden"; page.id = "tabUsersAccess"; page.innerHTML = `<div class="row-between"><div><div class="section-title">Users & Access</div><div class="small-hint">Super Admin can create users, reset PIN and decide edit permissions.</div></div><button type="button" class="btn orange" id="addAccessUserBtn">+ Add User</button></div><div id="accessUsersList" class="list spwt-access-list"></div><div class="row spwt-access-actions"><button type="button" class="btn green" id="saveAccessUsersBtn">Save Users & Access</button></div>`; const hr = panel.querySelector("hr"); if (hr) panel.insertBefore(page, hr); else panel.appendChild(page); }
    wireAccessActionButtons();
  }

  function wireAccessActionButtons() { const addBtn = $("addAccessUserBtn"); if (addBtn && !addBtn.__spwtAccessAddWired) { addBtn.__spwtAccessAddWired = true; addBtn.onclick = addAccessUser; } const saveBtn = $("saveAccessUsersBtn"); if (saveBtn && !saveBtn.__spwtAccessSaveWired) { saveBtn.__spwtAccessSaveWired = true; saveBtn.onclick = saveAccessUsers; } }
  function wireAdminLogin() { const loginBtn = $("adminLoginBtn"); if (!loginBtn) return; loginBtn.__spwtAccessLoginWired = true; loginBtn.type = "button"; loginBtn.onclick = doAdminLogin; }
  function wireAdminLoginGuard() { if (loginGuardWired) return; loginGuardWired = true; document.addEventListener("click", function (event) { const loginBtn = event.target?.closest?.("#adminLoginBtn"); if (!loginBtn) return; event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); doAdminLogin(); }, true); }

  async function doAdminLogin() {
    if (loginBusy) return;
    const username = ($("adminUserInput")?.value || "admin").trim() || "admin";
    const pin = ($("adminPinInput")?.value || "").trim();
    if (!pin) { forceLoginUnlocked(); setLoginStatus("Enter PIN.", "error"); $("adminPinInput")?.focus(); return; }
    setLoginBusy(true); setLoginStatus("Checking login...", "");
    try {
      const payload = await postJson("/api/admin/access/login", { username, pin });
      const data = apiData(payload);
      if (!data.valid) { resetLoginAfterFailure("Wrong username or PIN."); return; }
      accessState.token = data.token || "";
      accessState.user = data.user || null;
      if (accessState.user) accessState.user.permissions = expandLegacyPermissions(accessState.user.permissions);
      if (typeof adminOverrides !== "undefined" && adminOverrides) { adminOverrides.admin = adminOverrides.admin || {}; adminOverrides.admin.pin = pin; }
      if (typeof isAdminLoggedIn !== "undefined") isAdminLoggedIn = true;
      setLoginStatus("Login successful.", "success");
      $("adminLoginBox")?.classList.add("hidden");
      $("adminPanel")?.classList.remove("hidden");
      forceLoginUnlocked(); applyPermissionUi();
      await loadAccessUsersIfAllowed().catch((err) => { console.warn("Users & Access load skipped:", err); });
      switchToFirstAllowedTab(); notifyPermissionUiChanged();
    } catch (err) { console.error(err); resetLoginAfterFailure("Login failed: " + (err.message || err)); }
  }

  function wireAdminLogout() { const logoutBtn = $("adminLogoutBtn"); if (!logoutBtn || logoutBtn.__spwtAccessLogoutWired) return; logoutBtn.__spwtAccessLogoutWired = true; logoutBtn.type = "button"; logoutBtn.onclick = function () { accessState.token = ""; accessState.user = null; if (typeof isAdminLoggedIn !== "undefined") isAdminLoggedIn = false; $("adminPanel")?.classList.add("hidden"); $("adminLoginBox")?.classList.remove("hidden"); forceLoginUnlocked(); setLoginStatus("Logged out.", ""); notifyPermissionUiChanged(); const pinInput = $("adminPinInput"); if (pinInput) { pinInput.value = ""; pinInput.focus(); } }; }
  function wireTokenHeaderProvider() { window.SPWT_ADMIN_TOKEN_HEADER = function () { return accessState.token ? { "X-SPWT-Admin-Token": accessState.token } : {}; }; }
  function showAdminTab(tabId) { document.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); document.querySelector(`.tab[data-tab="${tabId}"]`)?.classList.add("active"); document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden")); $(tabId)?.classList.remove("hidden"); if (tabId === "tabUsersAccess") renderAccessUsers(); else if (typeof switchAdminTab === "function") switchAdminTab(tabId); notifyPermissionUiChanged(); }
  function wireTabPermissionGate() { if (document.__spwtAdminAccessTabGateWired) return; document.__spwtAdminAccessTabGateWired = true; document.addEventListener("click", function (event) { const tab = event.target?.closest?.(".tab[data-tab]"); if (!tab) return; const tabId = tab.getAttribute("data-tab"); const permission = TAB_PERMISSION[tabId]; if (permission && accessState.user && !hasPermission(permission)) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); alert(`No permission: ${PERMISSION_LABELS[permission] || permission}`); return; } if (tabId === "tabUsersAccess") { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); showAdminTab("tabUsersAccess"); } }, true); }
  function applyPermissionUi() { Object.entries(TAB_PERMISSION).forEach(([tabId, permission]) => { const tab = document.querySelector(`.tab[data-tab="${tabId}"]`); const page = $(tabId); const allowed = hasPermission(permission); if (tab) tab.style.display = allowed ? "" : "none"; if (page && !allowed) page.classList.add("hidden"); }); const saveBtn = $("adminSaveBtn"); if (saveBtn) saveBtn.title = "Save allowed admin changes to DB"; }
  function switchToFirstAllowedTab() { const first = Object.entries(TAB_PERMISSION).find(([, permission]) => hasPermission(permission)); showAdminTab(first?.[0] || "tabMachines"); }

  async function loadAccessUsersIfAllowed() {
    if (!hasPermission("userAccess")) return;
    const payload = await fetchJson("/api/admin/access-users");
    const data = apiData(payload);
    accessState.permissions = visiblePermissions(data.permissions || []);
    accessState.roleTemplates = data.roleTemplates || {};
    accessState.users = (data.users || []).map((u) => ({ ...u, permissions: expandLegacyPermissions(u.permissions) }));
    renderAccessUsers();
  }

  function addAccessUser() { if (!hasPermission("userAccess")) return alert("No permission: Users & Access"); accessState.users.push({ username: "newuser", displayName: "New User", role: "supervisor", permissions: expandLegacyPermissions(accessState.roleTemplates?.supervisor || ["machines", "employees", "workCatalog"]), active: true, pin: "" }); renderAccessUsers(); }
  function renderAccessUsers() { const host = $("accessUsersList"); if (!host) return; const permissions = accessState.permissions.length ? accessState.permissions : visiblePermissions(Object.keys(PERMISSION_LABELS)); const users = accessState.users || []; host.innerHTML = `<table class="admin-table spwt-access-table"><thead><tr><th>Username</th><th>Display Name</th><th>Role</th><th>Reset PIN</th><th>Permissions</th><th>Active</th><th>Action</th></tr></thead><tbody>${users.map((u, idx) => renderUserRow(u, idx, permissions)).join("")}</tbody></table><div class="small-hint spwt-access-hint">Existing PINs are stored securely as hash. Admin can reset PIN, not read old PIN.</div>`; wireAccessUserInputs(); wireAccessActionButtons(); }
  function renderUserRow(user, idx, permissions) { const role = user.role || "supervisor"; const roleOptions = ["supervisor", "engineer", "admin"].map((r) => `<option value="${r}" ${r === role ? "selected" : ""}>${r}</option>`).join(""); const userPerms = expandLegacyPermissions(user.permissions); const permissionChecks = permissions.map((p) => `<label class="spwt-permission-check"><input type="checkbox" data-au-idx="${idx}" data-au-perm="${escapeHtml(p)}" ${userPerms.includes(p) ? "checked" : ""} />${escapeHtml(PERMISSION_LABELS[p] || p)}</label>`).join(""); return `<tr><td><input class="admin-input" data-au-idx="${idx}" data-au-field="username" value="${escapeHtml(user.username || "")}" placeholder="username" /></td><td><input class="admin-input" data-au-idx="${idx}" data-au-field="displayName" value="${escapeHtml(user.displayName || "")}" placeholder="Display Name" /></td><td><select class="admin-select" data-au-idx="${idx}" data-au-field="role">${roleOptions}</select></td><td><input class="admin-input" data-au-idx="${idx}" data-au-field="pin" value="" placeholder="New PIN" type="password" /></td><td>${permissionChecks}</td><td><select class="admin-select" data-au-idx="${idx}" data-au-field="active"><option value="true" ${user.active !== false ? "selected" : ""}>Yes</option><option value="false" ${user.active === false ? "selected" : ""}>No</option></select></td><td><button type="button" class="btn grey" data-au-del="${idx}">Delete</button></td></tr>`; }

  function wireAccessUserInputs() { document.querySelectorAll("[data-au-field]").forEach((el) => { el.onchange = el.oninput = function () { const idx = Number(el.getAttribute("data-au-idx")); const field = el.getAttribute("data-au-field"); const user = accessState.users[idx]; if (!user) return; if (field === "active") user.active = el.value === "true"; else if (field === "role") { user.role = el.value; if (!Array.isArray(user.permissions) || user.permissions.length === 0) { user.permissions = expandLegacyPermissions(accessState.roleTemplates?.[el.value] || []); renderAccessUsers(); } } else user[field] = el.value.trim(); }; }); document.querySelectorAll("[data-au-perm]").forEach((el) => { el.onchange = function () { const idx = Number(el.getAttribute("data-au-idx")); const perm = el.getAttribute("data-au-perm"); const user = accessState.users[idx]; if (!user) return; user.permissions = expandLegacyPermissions(user.permissions); if (el.checked && !user.permissions.includes(perm)) user.permissions.push(perm); if (!el.checked) user.permissions = user.permissions.filter((p) => p !== perm && p !== "workStandards"); }; }); document.querySelectorAll("[data-au-del]").forEach((btn) => { btn.onclick = function () { const idx = Number(btn.getAttribute("data-au-del")); accessState.users.splice(idx, 1); renderAccessUsers(); }; }); }
  function setUsersSaveBusy(isBusy) { savingUsers = !!isBusy; const btn = $("saveAccessUsersBtn"); if (btn) { btn.disabled = savingUsers; btn.textContent = savingUsers ? "Saving..." : "Save Users & Access"; } }
  async function saveAccessUsers() { if (savingUsers) return; if (!hasPermission("userAccess")) return alert("No permission: Users & Access"); try { setUsersSaveBusy(true); const users = (accessState.users || []).map((u) => ({ username: (u.username || "").trim(), displayName: (u.displayName || "").trim(), role: u.role || "supervisor", permissions: expandLegacyPermissions(u.permissions).filter((p) => !HIDDEN_LEGACY_PERMISSIONS.has(p)), active: u.active !== false, pin: (u.pin || "").trim() })).filter((u) => u.username); const payload = await postJson("/api/admin/access-users", { users }); const data = apiData(payload); accessState.users = (data || []).map((u) => ({ ...u, permissions: expandLegacyPermissions(u.permissions) })); renderAccessUsers(); alert("Users & Access saved."); } catch (err) { console.error(err); alert("Users & Access save failed:\n\n" + (err.message || err)); } finally { setUsersSaveBusy(false); } }

  async function requestJson(path, options = {}) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); try { const res = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal }); const payload = await res.json().catch(() => null); if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`); return payload; } catch (err) { if (err?.name === "AbortError") throw new Error("Request timeout. Check server is running."); throw err; } finally { clearTimeout(timer); } }
  async function fetchJson(path) { return requestJson(path, { method: "GET", headers: { ...(accessState.token ? { "X-SPWT-Admin-Token": accessState.token } : {}) } }); }
  async function postJson(path, body) { return requestJson(path, { method: "POST", headers: { "Content-Type": "application/json", ...(accessState.token ? { "X-SPWT-Admin-Token": accessState.token } : {}) }, body: JSON.stringify(body || {}) }); }
})();
