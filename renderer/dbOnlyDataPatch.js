// renderer/dbOnlyDataPatch.js
// DB edition helper: removes dependency on dummy /data JSON files.
// app.js still asks for legacy data JSON first; this patch returns empty data in DB mode.
// It also blocks adminOverrides JSON fallback when DB master-data API is not available.

(function () {
  const config = window.SPWT_CONFIG || {};
  if ((config.DATA_SOURCE || "db") !== "db") return;

  const originalFetch = window.fetch.bind(window);
  const emptyDataByFile = {
    "data/machines.json": [],
    "data/employees.json": [],
    "data/shifts.json": [],
    "data/mainWorks.json": [],
    "data/subWorks.json": {}
  };

  function normalizePath(input) {
    const text = String(input?.url || input || "");
    const marker = "/data/";
    if (text.startsWith("data/")) return text;
    const idx = text.indexOf(marker);
    return idx >= 0 ? `data/${text.slice(idx + marker.length)}` : text;
  }

  window.fetch = function (input, init) {
    const path = normalizePath(input);
    if (Object.prototype.hasOwnProperty.call(emptyDataByFile, path)) {
      return Promise.resolve(new Response(JSON.stringify(emptyDataByFile[path]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return originalFetch(input, init);
  };

  function blockLocalAdminFallback() {
    if (!window.api || window.api.__spwtDbOnlyFallbackBlocked) return;
    window.api.__spwtDbOnlyFallbackBlocked = true;
    window.api.getAdminOverrides = async function () {
      throw new Error("DB master data is required. Local data/adminOverrides.json fallback is disabled in DB edition.");
    };
    window.api.saveAdminOverrides = async function () {
      return { ok: false, error: "Local adminOverrides save is disabled in DB edition. Use Save to DB." };
    };
  }

  document.addEventListener("DOMContentLoaded", blockLocalAdminFallback, true);
  blockLocalAdminFallback();
})();
