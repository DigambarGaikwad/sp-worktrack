// renderer/admin/adminDbPatch.js
// Patch over adminDb.js: reliable planned-absent employee loading from DB API,
// save mode that deactivates removed admin records in PocketBase,
// and DB-only Admin PIN login/update.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const $ = (id) => document.getElementById(id);

  let dbEmployees = [];

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(initAdminDbPatch, 1200);
  });

  async function initAdminDbPatch() {
    await loadEmployeesFromDb();
    populatePlannedAbsentEmployeeSelectFromDb();
    patchSaveButton();
    patchPlannedAbsentTabClick();
    patchDbPinButtons();
  }

  async function loadEmployeesFromDb() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/master-data`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `Master data load failed ${res.status}`);

      dbEmployees = Array.isArray(body.data?.employees) ? body.data.employees : [];
    } catch (err) {
      console.warn("DB employee load for planned absent failed:", err);
      dbEmployees = [];
    }
  }

  function populatePlannedAbsentEmployeeSelectFromDb() {
    const select = $("plannedAbsentEmployee");
    if (!select) return;

    const current = select.value;
    const employees = dbEmployees
      .filter((e) => e && e.active !== false)
      .map((e) => ({
        empCode: String(e.empId || e.emp_code || e.code || "").trim(),
        empName: String(e.name || e.full_name || e.emp_name || "").trim(),
        department: String(e.department || "").trim()
      }))
      .filter((e) => e.empCode || e.empName)
      .sort((a, b) => (a.empName || a.empCode).localeCompare(b.empName || b.empCode));

    select.innerHTML = `<option value="">Select Employee</option>` + employees.map((e) => {
      const value = `${escapeAttr(e.empCode)}|${escapeAttr(e.empName)}|${escapeAttr(e.department)}`;
      const label = `${e.empCode ? e.empCode + " - " : ""}${e.empName || "Unknown"}${e.department ? " (" + e.department + ")" : ""}`;
      return `<option value="${value}">${escapeHtml(label)}</option>`;
    }).join("");

    if (current) select.value = current;
  }

  function patchPlannedAbsentTabClick() {
    const tab = document.querySelector('[data-tab="tabPlannedAbsent"]');
    if (!tab) return;

    tab.addEventListener("click", async function () {
      await loadEmployeesFromDb();
      populatePlannedAbsentEmployeeSelectFromDb();
    });
  }

  function patchSaveButton() {
    const btn = $("adminSaveBtn");
    if (!btn) return;

    btn.textContent = "Save to DB";
    btn.title = "Save current admin masters to DB and mark deleted items inactive";
    btn.onclick = saveCurrentAdminStateToDb;
  }

  function patchDbPinButtons() {
    const loginBtn = $("adminLoginBtn");
    const savePinBtn = $("savePinBtn");
    const logoutBtn = $("adminLogoutBtn");

    if (loginBtn) {
      loginBtn.onclick = dbAdminLogin;
      loginBtn.title = "Login using Admin PIN stored in PocketBase DB";
    }

    if (savePinBtn) {
      savePinBtn.onclick = dbSaveAdminPin;
      savePinBtn.textContent = "Save PIN to DB";
      savePinBtn.title = "Update Admin PIN in PocketBase DB";
    }

    if (logoutBtn) {
      logoutBtn.onclick = dbAdminLogout;
    }
  }

  async function postJson(path, body) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.message || `Request failed with status ${res.status}`);
    }
    return payload;
  }

  async function dbAdminLogin() {
    const pin = ($("adminPinInput")?.value || "").trim();
    if (!pin) {
      alert("Enter Admin PIN.");
      return;
    }

    try {
      const payload = await postJson("/api/admin/pin/verify", { pin });
      if (!payload.valid) {
        alert("Wrong Admin PIN.");
        return;
      }

      const loginBox = $("adminLoginBox");
      const panel = $("adminPanel");
      if (loginBox) loginBox.classList.add("hidden");
      if (panel) panel.classList.remove("hidden");
      if ($("adminPinInput")) $("adminPinInput").value = "";

      showToast("Admin login successful ✅", "success");
    } catch (err) {
      console.error(err);
      alert("Admin login failed:\n\n" + (err.message || err));
    }
  }

  async function dbSaveAdminPin() {
    const p1 = ($("newPin1")?.value || "").trim();
    const p2 = ($("newPin2")?.value || "").trim();

    if (!p1 || !p2) {
      alert("Enter and confirm new PIN.");
      return;
    }
    if (p1 !== p2) {
      alert("PIN confirmation does not match.");
      return;
    }
    if (p1.length < 4) {
      alert("PIN must be at least 4 characters.");
      return;
    }

    try {
      await postJson("/api/admin/pin/update", { newPin: p1 });
      if ($("newPin1")) $("newPin1").value = "";
      if ($("newPin2")) $("newPin2").value = "";
      showToast("Admin PIN updated in DB ✅", "success");
      alert("Admin PIN updated in DB. Use the new PIN for next login.");
    } catch (err) {
      console.error(err);
      alert("PIN update failed:\n\n" + (err.message || err));
    }
  }

  function dbAdminLogout() {
    const loginBox = $("adminLoginBox");
    const panel = $("adminPanel");
    if (loginBox) loginBox.classList.remove("hidden");
    if (panel) panel.classList.add("hidden");
    showToast("Logged out", "success");
  }

  function getGlobalValue(name, fallback) {
    try {
      // eslint-disable-next-line no-eval
      const value = eval(name);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function buildPayload() {
    const adminOverrides = getGlobalValue("adminOverrides", {}) || {};
    return {
      ...adminOverrides,
      machines: getGlobalValue("machines", adminOverrides.machines || []) || [],
      employees: getGlobalValue("employees", adminOverrides.employees || []) || [],
      shifts: getGlobalValue("shifts", adminOverrides.shifts || []) || [],
      machineTypes: getGlobalValue("machineTypes", adminOverrides.machineTypes || []) || [],
      workCatalogByType: getGlobalValue("workCatalogByType", adminOverrides.workCatalogByType || {}) || {},
      mainWorks: getGlobalValue("mainWorks", adminOverrides.mainWorks || []) || [],
      subWorks: getGlobalValue("subWorksMap", adminOverrides.subWorks || {}) || {},
      lossReasons: getGlobalValue("lossReasons", adminOverrides.lossReasons || []) || [],
      rootAreas: getGlobalValue("rootAreas", adminOverrides.rootAreas || []) || []
    };
  }

  async function saveCurrentAdminStateToDb() {
    const btn = $("adminSaveBtn");
    const oldText = btn?.textContent || "Save to DB";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Syncing DB...";
      }

      const payload = buildPayload();
      const res = await fetch(`${API_BASE_URL}/api/admin/save-master-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncMode: "deactivateMissing",
          data: payload
        })
      });

      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `Admin DB save failed ${res.status}`);

      showToast(`Saved to DB ✅ Mode: ${body.data?.mode || "sync"}`, "success");
      console.log("Admin DB sync result:", body.data);

      await loadEmployeesFromDb();
      populatePlannedAbsentEmployeeSelectFromDb();
    } catch (err) {
      console.error(err);
      showToast(err.message || String(err), "error");
      alert("Admin DB save failed:\n\n" + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
  }

  function showToast(message, type) {
    let toast = $("adminDbToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "adminDbToast";
      toast.className = "admin-db-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `admin-db-toast show ${type || ""}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 3500);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
