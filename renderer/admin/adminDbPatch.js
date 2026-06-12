// renderer/admin/adminDbPatch.js
// DB admin master-data save patch.
// Saves current admin master data to PocketBase with login token and deactivateMissing sync mode.
// Important: app.js wires adminSaveBtn after async loadData(), so this patch uses a capture-phase
// click guard and late re-patching to prevent legacy local save from overriding DB save.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_INIT_ATTEMPTS = 16;
  const INIT_RETRY_MS = 250;
  const $ = (id) => document.getElementById(id);

  let initAttempts = 0;
  let dbSaveBusy = false;

  const MASTER_SAVE_TABS = new Set([
    "tabMachines",
    "tabEmployees",
    "tabShifts",
    "tabWork",
    "tabLossReasons",
    "tabRootAreas"
  ]);

  function getActiveAdminTabId() {
    return document.querySelector(".tab.active[data-tab]")?.dataset?.tab || "";
  }

  function updateDbSaveVisibility() {
    const btn = $("adminSaveBtn");
    if (!btn) return false;

    const visible = MASTER_SAVE_TABS.has(getActiveAdminTabId());
    const holder = btn.closest(".admin-save-row, .admin-actions, .section-actions, .footer-actions") || btn.parentElement;

    if (holder) holder.style.display = visible ? "" : "none";
    else btn.style.display = visible ? "" : "none";

    return visible;
  }

  document.addEventListener("DOMContentLoaded", scheduleInit);

  function scheduleInit() {
    initAttempts += 1;
    const wired = patchSaveButton();
    updateDbSaveVisibility();
    if (!wired && initAttempts < MAX_INIT_ATTEMPTS) setTimeout(scheduleInit, INIT_RETRY_MS);

    if (wired && !document.__spwtDbSaveLatePatchScheduled) {
      document.__spwtDbSaveLatePatchScheduled = true;
      [500, 1200, 2500, 5000].forEach((ms) => setTimeout(patchSaveButton, ms));
    }
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal });
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

  function patchSaveButton() {
    const btn = $("adminSaveBtn");
    if (!btn) return false;

    btn.type = "button";
    btn.textContent = dbSaveBusy ? "Syncing DB..." : "Save to DB";
    btn.title = "Save current admin masters to PocketBase DB";
    btn.onclick = saveCurrentAdminStateToDb;
    btn.__spwtDbSaveWired = true;
    updateDbSaveVisibility();

    if (!btn.__spwtDbSaveClickGuardWired) {
      btn.__spwtDbSaveClickGuardWired = true;
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        saveCurrentAdminStateToDb();
      }, true);
    }

    return true;
  }

  document.addEventListener("click", function (event) {
    if (event.target?.closest?.("[data-tab]")) {
      setTimeout(updateDbSaveVisibility, 0);
      setTimeout(updateDbSaveVisibility, 200);
    }
  }, true);
  function getGlobalValue(name, fallback) {
    try {
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
    return { "Content-Type": "application/json", ...tokenHeaders };
  }

  function readInputList(selector) {
    return Array.from(document.querySelectorAll(selector)).map((input) => String(input.value || "").trim()).filter(Boolean);
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
    if (dbSaveBusy) return;
    const btn = $("adminSaveBtn");
    const oldText = btn?.textContent || "Save to DB";

    try {
      dbSaveBusy = true;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Syncing DB...";
      }

      const headers = getAdminHeaders();
      if (!headers["X-SPWT-Admin-Token"]) {
        throw new Error("Login session required. Please logout and login again.");
      }

      const body = await requestJson("/api/admin/master-data", {
        method: "POST",
        headers,
        body: JSON.stringify({ syncMode: "deactivateMissing", data: buildPayload() })
      });

      const msg = body.data?.standardTimeProtected
        ? "Saved to DB ✅ Standard times protected (no Standard Time permission)."
        : `Saved to DB ✅ Mode: ${body.data?.mode || "sync"}`;

      showToast(msg, "success");
      console.log("Admin DB sync result:", body.data);
    } catch (err) {
      console.error(err);
      showToast(err.message || String(err), "error");
      alert("Admin DB save failed:\n\n" + (err.message || err));
    } finally {
      dbSaveBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText === "Syncing DB..." || oldText === "Save Changes" ? "Save to DB" : oldText;
        btn.onclick = saveCurrentAdminStateToDb;
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
})();

