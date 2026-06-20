// renderer/admin/adminHeaderRestorePatch.js
// Keeps the shared app header visible on Admin pages even when legacy markup uses #appHeader.
(function () {
  function restoreAdminHeader() {
    if (!window.SPWT?.renderAppHeader) return;

    let mount = document.getElementById("spAppHeader") || document.getElementById("appHeader");
    if (!mount) {
      mount = document.createElement("div");
      document.body.insertAdjacentElement("afterbegin", mount);
    }

    mount.id = "spAppHeader";
    mount.style.display = "";
    mount.hidden = false;

    window.SPWT.renderAppHeader({
      title: "SP WorkTrack",
      subtitle: "Production & Performance Management System"
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreAdminHeader, { once: true });
  } else {
    restoreAdminHeader();
  }

  [300, 1000, 2500].forEach((ms) => setTimeout(restoreAdminHeader, ms));
})();
