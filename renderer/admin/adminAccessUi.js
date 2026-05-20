// renderer/admin/adminAccessUi.js
// Frontend RBAC layer for Admin page.
// Adds username + PIN login, Users & Access tab, role presets, permission checklist.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";

  const PERMISSION_LABELS = {
    machines: "Machines",
    employees: "Employees",
    shifts: "Shifts",
    lossReasons: "Loss Reasons",
    rootAreas: "Root Areas",
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
    tabWork: "workStandards",
    tabPin: "pin",
    tabUsersAccess: "userAccess"
  };

  let accessState = {
    token: "",
    user: null,
    permissions: [],
    roleTemplates: {},
    users: []
  };

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(initAccessUi, 800);
  });

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function hasPermission(permission) {
    const user = accessState.user || {};
    if (user.role === "super_admin") return true;
    if (Array.isArray(user.permissions) && user.permissions.includes("all")) return true;
    return Array.isArray(user.permissions) && user.permissions.includes(permission);
  }

  function initAccessUi() {
    enhanceLoginBox();
    ensureUsersAccessTab();
    patchAdminLogin();
    patchAdminLogout();
    patchSaveButtonWithToken();
    patchTabPermissionGate();
    exposeAccessState();
  }

  function exposeAccessState() {
    window.SPWT_ADMIN_ACCESS = {
      getToken: () => accessState.token,
      getUser: () => accessState.user,
      hasPermission
    };
  }

  function enhanceLoginBox() {
    const loginBox = $("adminLoginBox");
    const pinInput = $("adminPinInput");
    if (!loginBox || !pinInput || $("adminUserInput")) return;

    const userField = document.createElement("div");
    userField.className = "field";
    userField.innerHTML = `
      <label>User Name</label>
      <input id="adminUserInput" type="text" placeholder="admin / supervisor / engineer" value="admin" />
    `;

    pinInput.closest(".field")?.before(userField);

    const hint = loginBox.querySelector(".small-hint");
    if (hint) {
      hint.textContent = "Login with username + PIN. Default super admin username is admin.";
    }
  }

  function ensureUsersAccessTab() {
    const tabs = document.querySelector("#adminPanel .tabs");
    if (tabs && !document.querySelector('[data-tab="tabUsersAccess"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.setAttribute("data-tab", "tabUsersAccess");
      btn.textContent = "Users & Access";
      tabs.appendChild(btn);
    }

    const panel = $("adminPanel");
    if (panel && !$("tabUsersAccess")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabUsersAccess";
      page.innerHTML = `
        <div class="row-between">
          <div>
            <div class="section-title">Users & Access</div>
            <div class="small-hint">Super Admin can create users, reset PIN and decide edit permissions.</div>
          </div>
          <button type="button" class="btn orange" id="addAccessUserBtn">+ Add User</button>
        </div>
        <div id="accessUsersList" class="list" style="margin-top:12px;"></div>
        <div class="row" style="margin-top:12px; justify-content:flex-end;">
          <button type="button" class="btn green" id="saveAccessUsersBtn">Save Users & Access</button>
        </div>
      `;

      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }

    $("addAccessUserBtn")?.addEventListener("click", addAccessUser);
    $("saveAccessUsersBtn")?.addEventListener("click", saveAccessUsers);
  }

  function patchAdminLogin() {
    const loginBtn = $("adminLoginBtn");
    if (!loginBtn) return;

    loginBtn.onclick = async function () {
      const username = ($("adminUserInput")?.value || "admin").trim() || "admin";
      const pin = ($("adminPinInput")?.value || "").trim();

      if (!pin) {
        alert("Enter PIN.");
        return;
      }

      try {
        const payload = await postJson("/api/admin/access/login", { username, pin });
        if (!payload.valid) {
          alert("Wrong username or PIN.");
          return;
        }

        accessState.token = payload.token || "";
        accessState.user = payload.user || null;

        // Keep original app.js admin state alive.
        if (typeof adminOverrides !== "undefined" && adminOverrides) {
          adminOverrides.admin = adminOverrides.admin || {};
          adminOverrides.admin.pin = pin;
        }
        if (typeof isAdminLoggedIn !== "undefined") {
          isAdminLoggedIn = true;
        }

        $("adminLoginBox")?.classList.add("hidden");
        $("adminPanel")?.classList.remove("hidden");

        applyPermissionUi();
        await loadAccessUsersIfAllowed();
        switchToFirstAllowedTab();
      } catch (err) {
        console.error(err);
        alert("Login failed:\n\n" + (err.message || err));
      }
    };
  }

  function patchAdminLogout() {
    const logoutBtn = $("adminLogoutBtn");
    if (!logoutBtn) return;

    logoutBtn.onclick = function () {
      accessState.token = "";
      accessState.user = null;
      if (typeof isAdminLoggedIn !== "undefined") isAdminLoggedIn = false;
      $("adminPanel")?.classList.add("hidden");
      $("adminLoginBox")?.classList.remove("hidden");
    };
  }

  function patchSaveButtonWithToken() {
    // adminDbPatch.js owns actual save button. Here we only expose token through window.
    window.SPWT_ADMIN_TOKEN_HEADER = function () {
      return accessState.token ? { "X-SPWT-Admin-Token": accessState.token } : {};
    };
  }

  function patchTabPermissionGate() {
    document.addEventListener("click", function (event) {
      const tab = event.target?.closest?.(".tab[data-tab]");
      if (!tab) return;

      const tabId = tab.getAttribute("data-tab");
      const permission = TAB_PERMISSION[tabId];
      if (permission && accessState.user && !hasPermission(permission)) {
        event.preventDefault();
        event.stopPropagation();
        alert(`No permission: ${PERMISSION_LABELS[permission] || permission}`);
      }

      if (tabId === "tabUsersAccess" && hasPermission("userAccess")) {
        setTimeout(renderAccessUsers, 50);
      }
    }, true);
  }

  function applyPermissionUi() {
    Object.entries(TAB_PERMISSION).forEach(([tabId, permission]) => {
      const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
      const page = $(tabId);
      const allowed = hasPermission(permission);

      if (tab) tab.style.display = allowed ? "" : "none";
      if (page && !allowed) page.classList.add("hidden");
    });

    const saveBtn = $("adminSaveBtn");
    if (saveBtn) {
      saveBtn.title = "Save allowed admin changes to DB";
    }
  }

  function switchToFirstAllowedTab() {
    const first = Object.entries(TAB_PERMISSION).find(([, permission]) => hasPermission(permission));
    const tabId = first?.[0] || "tabMachines";

    if (typeof switchAdminTab === "function") switchAdminTab(tabId);
    if (tabId === "tabUsersAccess") renderAccessUsers();
  }

  async function loadAccessUsersIfAllowed() {
    if (!hasPermission("userAccess")) return;

    const payload = await fetchJson("/api/admin/access/users");
    accessState.permissions = payload.data?.permissions || [];
    accessState.roleTemplates = payload.data?.roleTemplates || {};
    accessState.users = payload.data?.users || [];
    renderAccessUsers();
  }

  function addAccessUser() {
    if (!hasPermission("userAccess")) {
      alert("No permission: Users & Access");
      return;
    }

    accessState.users.push({
      username: "newuser",
      displayName: "New User",
      role: "supervisor",
      permissions: accessState.roleTemplates?.supervisor || ["machines", "employees"],
      active: true,
      pin: ""
    });
    renderAccessUsers();
  }

  function renderAccessUsers() {
    const host = $("accessUsersList");
    if (!host) return;

    const permissions = accessState.permissions || Object.keys(PERMISSION_LABELS);
    const users = accessState.users || [];

    host.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th style="min-width:120px;">Username</th>
            <th style="min-width:150px;">Display Name</th>
            <th style="width:130px;">Role</th>
            <th style="width:120px;">Reset PIN</th>
            <th>Permissions</th>
            <th style="width:90px;">Active</th>
            <th style="width:90px;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((u, idx) => renderUserRow(u, idx, permissions)).join("")}
        </tbody>
      </table>
      <div class="small-hint" style="margin-top:8px;">
        Existing PINs are stored securely as hash. Admin can reset PIN, not read old PIN.
      </div>
    `;

    wireAccessUserInputs();
  }

  function renderUserRow(user, idx, permissions) {
    const role = user.role || "supervisor";
    const roleOptions = ["supervisor", "engineer", "admin"].map((r) =>
      `<option value="${r}" ${r === role ? "selected" : ""}>${r}</option>`
    ).join("");

    const permissionChecks = permissions.map((p) => {
      const checked = Array.isArray(user.permissions) && user.permissions.includes(p) ? "checked" : "";
      return `
        <label style="display:inline-flex; align-items:center; gap:4px; margin:3px 10px 3px 0; white-space:nowrap;">
          <input type="checkbox" data-au-idx="${idx}" data-au-perm="${escapeHtml(p)}" ${checked} />
          ${escapeHtml(PERMISSION_LABELS[p] || p)}
        </label>
      `;
    }).join("");

    return `
      <tr>
        <td><input class="admin-input" data-au-idx="${idx}" data-au-field="username" value="${escapeHtml(user.username || "")}" placeholder="username" /></td>
        <td><input class="admin-input" data-au-idx="${idx}" data-au-field="displayName" value="${escapeHtml(user.displayName || "")}" placeholder="Display Name" /></td>
        <td><select class="admin-select" data-au-idx="${idx}" data-au-field="role">${roleOptions}</select></td>
        <td><input class="admin-input" data-au-idx="${idx}" data-au-field="pin" value="" placeholder="New PIN" type="password" /></td>
        <td>${permissionChecks}</td>
        <td>
          <select class="admin-select" data-au-idx="${idx}" data-au-field="active">
            <option value="true" ${user.active !== false ? "selected" : ""}>Yes</option>
            <option value="false" ${user.active === false ? "selected" : ""}>No</option>
          </select>
        </td>
        <td><button type="button" class="btn grey" data-au-del="${idx}">Delete</button></td>
      </tr>
    `;
  }

  function wireAccessUserInputs() {
    document.querySelectorAll("[data-au-field]").forEach((el) => {
      el.onchange = el.oninput = function () {
        const idx = Number(el.getAttribute("data-au-idx"));
        const field = el.getAttribute("data-au-field");
        const user = accessState.users[idx];
        if (!user) return;

        if (field === "active") user.active = el.value === "true";
        else if (field === "role") {
          user.role = el.value;
          if (!Array.isArray(user.permissions) || user.permissions.length === 0) {
            user.permissions = accessState.roleTemplates?.[el.value] || [];
            renderAccessUsers();
          }
        } else {
          user[field] = el.value.trim();
        }
      };
    });

    document.querySelectorAll("[data-au-perm]").forEach((el) => {
      el.onchange = function () {
        const idx = Number(el.getAttribute("data-au-idx"));
        const perm = el.getAttribute("data-au-perm");
        const user = accessState.users[idx];
        if (!user) return;

        user.permissions = Array.isArray(user.permissions) ? user.permissions : [];
        if (el.checked && !user.permissions.includes(perm)) user.permissions.push(perm);
        if (!el.checked) user.permissions = user.permissions.filter((p) => p !== perm);
      };
    });

    document.querySelectorAll("[data-au-del]").forEach((btn) => {
      btn.onclick = function () {
        const idx = Number(btn.getAttribute("data-au-del"));
        accessState.users.splice(idx, 1);
        renderAccessUsers();
      };
    });
  }

  async function saveAccessUsers() {
    if (!hasPermission("userAccess")) {
      alert("No permission: Users & Access");
      return;
    }

    try {
      const users = (accessState.users || []).map((u) => ({
        username: (u.username || "").trim(),
        displayName: (u.displayName || "").trim(),
        role: u.role || "supervisor",
        permissions: Array.isArray(u.permissions) ? u.permissions : [],
        active: u.active !== false,
        pin: (u.pin || "").trim()
      })).filter((u) => u.username);

      const payload = await postJson("/api/admin/access/users", { users });
      accessState.users = payload.data || [];
      renderAccessUsers();
      alert("Users & Access saved.");
    } catch (err) {
      console.error(err);
      alert("Users & Access save failed:\n\n" + (err.message || err));
    }
  }

  async function fetchJson(path) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        ...(accessState.token ? { "X-SPWT-Admin-Token": accessState.token } : {})
      }
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
    return payload;
  }

  async function postJson(path, body) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessState.token ? { "X-SPWT-Admin-Token": accessState.token } : {})
      },
      body: JSON.stringify(body || {})
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
    return payload;
  }
})();
