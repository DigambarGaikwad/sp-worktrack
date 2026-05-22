// renderer/dbModeEntryGuard.js
// DB mode entry-page guard.
// Prevents legacy in-page admin modal behavior from overriding the separate Admin page.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  function guardAdminNavigation() {
    document.querySelectorAll(".settings").forEach((btn) => {
      btn.onclick = function (event) {
        event.preventDefault();
        window.location.href = "renderer/admin/admin.html";
      };
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", guardAdminNavigation);
  } else {
    guardAdminNavigation();
  }
})();
