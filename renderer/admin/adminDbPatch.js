// renderer/admin/adminDbPatch.js
// Patch over adminDb.js: reliable planned-absent employee loading from DB API,
// and save mode that deactivates removed admin records in PocketBase.
// Admin PIN login/update is handled only by adminPinDb.js.

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

  function getGlobalValue(name, fallback) {
    try {
      // eslint-disable-next-line no-eval
      const value = eval(name);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function getAdminHeaders() {
    const tokenHeaders = window.SPWT_ADMIN_TOKEN_HEADER ? window.SPWT_ADMIN_TOKEN_HEADER() : {};
    return {
      "Content-Type": "application/json",
      ...tokenHeaders
    };
  }

  function readInputList(selector) {
    return Array.from(document.querySelectorAll(selector))
      .map((input) => String(input.value || "").trim())
      .filter(Boolean);
  }

  function readLossReasonsFromScreen(fallback) {
    const values = readInputList("#lossReasonsList [data-loss-idx]");
    return values.length ? values : fallback;
  }

  function readRootAreasFromScreen(fallback) {
    const values = readInputList("#rootAreasList [data-root-idx]");
    return values.length ? values : fallback;
  }

  function safeClone(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value == null ? fallback : value));
    } catch (err) {
      return fallback;
    }
  }

  function syncVisibleListsToGlobals(payload) {
    const lossReasonsFromScreen = readLossReasonsFromScreen(payload.lossReasons || []);
    const rootAreasFromScreen = readRootAreasFromScreen(payload.rootAreas || []);

    payload.lossReasons = lossReasonsFromScreen;
    payload.rootAreas = rootAreasFromScreen;

    try {
      // Keep app.js globals updated so entry dropdowns refresh correctly after reload/open.
      // eslint-disable-next-line no-eval
      eval("lossReasons = " + JSON.stringify(lossReasonsFromScreen));
      // eslint-disable-next-line no-eval
      eval("rootAreas = " + JSON.stringify(rootAreasFromScreen));
      // eslint-disable-next-line no-eval
      eval("if (adminOverrides) { adminOverrides.lossReasons = " + JSON.stringify(lossReasonsFromScreen) + "; adminOverrides.rootAreas = " + JSON.stringify(rootAreasFromScreen) + "; }");
    } catch (err) {
      console.warn("Could not sync visible admin lists to globals", err);
    }

    return payload;
  }

  function buildPayload() {
    const adminOverrides = getGlobalValue("adminOverrides", {}) || {};

    // Important: Admin screen edits are applied to adminOverrides, not always to runtime globals.
    // So save adminOverrides first. Runtime globals are only fallback for older screens.
    const payload = {
      ...safeClone(adminOverrides, {}),
      machines: safeClone(adminOverrides.machines || getGlobalValue("machines", []), []),
      employees: safeClone(adminOverrides.employees || getGlobalValue("employees", []), []),
      shifts: safeClone(adminOverrides.shifts || getGlobalValue("shifts", []), []),
      machineTypes: safeClone(adminOverrides.machineTypes || getGlobalValue("machineTypes", []), []),
      workCatalogByType: safeClone(adminOverrides.workCatalogByType || getGlobalValue("workCatalogByType", {}), {}),
      mainWorks: safeClone(adminOverrides.mainWorks || getGlobalValue("mainWorks", []), []),
      subWorks: safeClone(adminOverrides.subWorks || getGlobalValue("subWorksMap", {}), {}),
      lossReasons: safeClone(adminOverrides.lossReasons || getGlobalValue("lossReasons", []), []),
      rootAreas: safeClone(adminOverrides.rootAreas || getGlobalValue("rootAreas", []), [])
    };

    return syncVisibleListsToGlobals(payload);
  }

  async function saveCurrentAdminStateToDb() {
    const btn = $("adminSaveBtn");
    const oldText = btn?.textContent || "Save to DB";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Syncing DB...";
      }

      const headers = getAdminHeaders();
      if (!headers["X-SPWT-Admin-Token"]) {
        throw new Error("Login session required. Please logout and login again.");
      }

      const payload = buildPayload();
      const res = await fetch(`${API_BASE_URL}/api/admin/save-master-data`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          syncMode: "deactivateMissing",
          data: payload
        })
      });

      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `Admin DB save failed ${res.status}`);

      const msg = body.data?.standardTimeProtected
        ? "Saved to DB ✅ Standard times protected (no Standard Time permission)."
        : `Saved to DB ✅ Mode: ${body.data?.mode || "sync"}`;

      showToast(msg, "success");
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
    return escapeHtml(value).replaceAll("`", "&#096;");
  }
})();
