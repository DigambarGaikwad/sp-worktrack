// renderer/admin/adminPermissionUiPatch.js
// UI-only permission lock for Admin Work & Sub Work screen.
// If user has Work & Sub Work but not Standard Time, standard time fields are disabled.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  let observerStarted = false;
  let applyTimer = null;

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(initStandardTimeUiLock, 900);
  });

  function hasPermission(permission) {
    try {
      return window.SPWT_ADMIN_ACCESS?.hasPermission?.(permission) === true;
    } catch (err) {
      return false;
    }
  }

  function isLoggedIn() {
    try {
      return !!window.SPWT_ADMIN_ACCESS?.getUser?.();
    } catch (err) {
      return false;
    }
  }

  function canEditStandardTime() {
    if (!isLoggedIn()) return true;
    return hasPermission("standardTime");
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyStandardTimeUiLock, 80);
  }

  function lockInput(input, locked) {
    if (!input) return;
    input.readOnly = locked;
    input.disabled = locked;
    input.classList.toggle("spwt-standard-time-locked", locked);
    input.title = locked
      ? "Standard Time permission required"
      : "";
  }

  function applyStandardTimeUiLock() {
    const locked = !canEditStandardTime();
    const workPage = document.getElementById("tabWork");
    if (!workPage) return;

    // Base Std Time fields
    workPage.querySelectorAll('[data-field="standardTime"]').forEach((input) => lockInput(input, locked));

    // Booking point Std Time fields
    workPage.querySelectorAll('[data-bp-time]').forEach((input) => lockInput(input, locked));

    let hint = document.getElementById("standardTimePermissionHint");
    if (locked) {
      if (!hint) {
        hint = document.createElement("div");
        hint.id = "standardTimePermissionHint";
        hint.className = "small-hint";
        hint.style.cssText = "margin:8px 0;color:#b45309;font-weight:600;";
        hint.textContent = "Standard Time fields are locked. Standard Time permission is required to edit them.";

        const subHost = document.getElementById("subWorkList");
        subHost?.parentElement?.insertBefore(hint, subHost);
      }
      hint.style.display = "block";
    } else if (hint) {
      hint.style.display = "none";
    }
  }

  function injectStyle() {
    if (document.getElementById("spwtStandardTimeLockStyle")) return;
    const style = document.createElement("style");
    style.id = "spwtStandardTimeLockStyle";
    style.textContent = `
      .spwt-standard-time-locked {
        background: #f3f4f6 !important;
        color: #6b7280 !important;
        cursor: not-allowed !important;
      }
    `;
    document.head.appendChild(style);
  }

  function startObserver() {
    if (observerStarted) return;
    const host = document.getElementById("tabWork");
    if (!host) return;
    observerStarted = true;

    const observer = new MutationObserver(scheduleApply);
    observer.observe(host, { childList: true, subtree: true });
  }

  function initStandardTimeUiLock() {
    injectStyle();
    startObserver();
    scheduleApply();

    document.addEventListener("click", function (event) {
      if (event.target?.closest?.('[data-tab="tabWork"]')) {
        setTimeout(() => {
          startObserver();
          scheduleApply();
        }, 100);
      }
    }, true);
  }

  window.SPWT_APPLY_STANDARD_TIME_LOCK = applyStandardTimeUiLock;
})();
