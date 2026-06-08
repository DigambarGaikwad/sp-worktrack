// renderer/admin/adminLoginFocusFixPatch.js
// Safety patch: keep Admin login fields usable after logout, failed login, or user-access save.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  function $(id) { return document.getElementById(id); }

  function isVisible(el) {
    return !!el && !el.classList.contains("hidden") && el.offsetParent !== null;
  }

  function unlockLoginFields() {
    const loginBox = $("adminLoginBox");
    if (!isVisible(loginBox)) return;

    const ids = ["adminUserInput", "adminPinInput", "adminLoginBtn", "adminCancelBtn", "forgotPinBtn"];
    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.disabled = false;
      el.readOnly = false;
      el.style.pointerEvents = "auto";
      el.style.userSelect = "auto";
    });

    const loginBtn = $("adminLoginBtn");
    if (loginBtn && /checking|saving|syncing/i.test(loginBtn.textContent || "")) {
      loginBtn.textContent = "Login";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    [200, 600, 1200, 2500].forEach((ms) => setTimeout(unlockLoginFields, ms));
    setInterval(unlockLoginFields, 1000);
  });

  document.addEventListener("click", function (event) {
    if (event.target?.closest?.("#adminLoginBox")) setTimeout(unlockLoginFields, 0);
  }, true);
})();
