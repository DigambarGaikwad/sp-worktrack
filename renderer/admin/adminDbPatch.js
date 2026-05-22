// renderer/admin/adminDbPatch.js
// DB admin save patch: saves current admin master data to PocketBase with login token.
// Cleanup: timeout-protected requests, simpler payload build, safer button wiring.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 15000;
  const $ = (id) => document.getElementById(id);

  let dbEmployees = [];
  let initAttempts = 0;

  document.addEventListener("DOMContentLoaded", function () {
    scheduleInit();
  });

  function scheduleInit() {
    initAttempts += 1;
    initAdminDbPatch();

    // Admin page loads app.js + several patches. Retry briefly until button/page exists.
    if (!$("adminSaveBtn") && initAttempts < 12) {
      setTimeout(scheduleInit, 250);
    }
  }

  async function initAdminDbPatch() {
    patchSaveButton();
    patchPlannedAbsentTabClick();
    await loadEmployeesFromDb();
    populatePlannedAbsentEmployeeSelectFromDb();
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        signal: controller.signal
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `Request failed ${res.status}`);
      return body;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timeout. Check server is running.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadEmployeesFromDb() {
    try {
      const body = await requestJson("/api/admin/master-data", { method: "GET" });
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
    if (!tab || tab.__spwtDbPatchWired) return;
    tab.__spwtDbPatchWired = true;

    tab.addEventListener("click", async function () {
      await loadEmployeesFromDb();
      populatePlannedAbsentEmployeeSelectFromDb();
    });
  }

  function patchSaveButton() {
    const btn = $("adminSaveBtn");
    if (!btn || btn.__spwtDbSaveWired) return;

    btn.__spwtDbSaveWired = true;
    btn.type = "button";
    btn.textContent = "Save to DB";
    btn.title = "Save current admin masters to DB and mark deleted items inactive";
    btn.onclick = saveCurrentAdminStateToDb;
  }

  function getGlobalValue(name, fallback) {
    try {
      // Required until app.js exposes admin state on window.
      // eslint-disable-next-line no-eval
      const value = eval(name);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function assignGlobalValue(name, value) {
    try {
      window.__spwtAdminDbPatchValue = value;
      // Required until app.js exposes admin state on window.
      // eslint-disable-next-line no-new-func
      Function(`${name} = window.__spwtAdminDbPatchValue`)();
    } catch (err) {
      console.warn(`Could not assign ${name}`, err);
    } finally {
      delete window.__spwtAdminDbPatchValue;
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

  function safeClone(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value == null ? fallback : value));
    } catch (err) {
      return fallback;
    }
  }

  function getScreenOrFallback(selector, fallback) {
    const values = readInputList(selector);
    return values.length ? values : safeClone(fallback, []);
  }

  function syncVisibleLists(payload) {
    const lossReasons = getScreenOrFallback("#lossReasonsList [data-loss-idx]", payload.lossReasons || []);
    const rootAreas = getScreenOrFallback("#rootAreasList [data-root-idx]", payload.rootAreas || []);

    payload.lossReasons = lossReasons;
    payload.rootAreas = rootAreas;

    const currentOverrides = getGlobalValue("adminOverrides", null);
    if (currentOverrides) {
      currentOverrides.lossReasons = lossReasons;
      currentOverrides.rootAreas = rootAreas;
    }

    assignGlobalValue("lossReasons", lossReasons);
    assignGlobalValue("rootAreas", rootAreas);

    return payload;
  }

  function buildPayload() {
    const adminOverrides = getGlobalValue("adminOverrides", {}) || {};

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

    return syncVisibleLists(payload);
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

      const body = await requestJson("/api/admin/save-master-data", {
        method: "POST",
        headers,
        body: JSON.stringify({
          syncMode: "deactivateMissing",
          data: buildPayload()
        })
      });

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
