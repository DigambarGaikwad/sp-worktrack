// renderer/admin/adminPermissionUiPatch.js
// UI-only permission lock for Admin Work & Sub Work screen.
// If user has Work & Sub Work but not Standard Time, standard time fields are disabled.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const MAX_INIT_ATTEMPTS = 12;
  const INIT_RETRY_MS = 250;

  let observerStarted = false;
  let applyTimer = null;
  let initAttempts = 0;

  document.addEventListener("DOMContentLoaded", scheduleInit);

  function getAccess() {
    return window.SPWT_ADMIN_ACCESS || null;
  }

  function hasPermission(permission) {
    try {
      return getAccess()?.hasPermission?.(permission) === true;
    } catch (err) {
      return false;
    }
  }

  function isLoggedIn() {
    try {
      return !!getAccess()?.getUser?.();
    } catch (err) {
      return false;
    }
  }

  function canEditStandardTime() {
    // Before login/access layer is available, do not lock fields.
    if (!isLoggedIn()) return true;
    return hasPermission("standardTime");
  }

  function scheduleInit() {
    initAttempts += 1;
    const ready = initStandardTimeUiLock();
    if (!ready && initAttempts < MAX_INIT_ATTEMPTS) {
      setTimeout(scheduleInit, INIT_RETRY_MS);
    }
  }

  function scheduleApply(delay = 80) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyStandardTimeUiLock, delay);
  }

  function lockInput(input, locked) {
    if (!input) return;
    input.readOnly = locked;
    input.disabled = locked;
    input.classList.toggle("spwt-standard-time-locked", locked);
    input.title = locked ? "Standard Time permission required" : "";
  }

  function getStandardTimeInputs(workPage) {
    return [
      ...workPage.querySelectorAll('[data-field="standardTime"]'),
      ...workPage.querySelectorAll('[data-bp-time]')
    ];
  }

  function applyStandardTimeUiLock() {
    const workPage = document.getElementById("tabWork");
    if (!workPage) return;

    const locked = !canEditStandardTime();
    getStandardTimeInputs(workPage).forEach((input) => lockInput(input, locked));
    updateHint(locked);
  }

  function updateHint(locked) {
    let hint = document.getElementById("standardTimePermissionHint");

    if (!locked) {
      if (hint) hint.style.display = "none";
      return;
    }

    if (!hint) {
      hint = document.createElement("div");
      hint.id = "standardTimePermissionHint";
      hint.className = "small-hint spwt-standard-time-lock-hint";
      hint.textContent = "Standard Time fields are locked. Standard Time permission is required to edit them.";

      const subHost = document.getElementById("subWorkList");
      subHost?.parentElement?.insertBefore(hint, subHost);
    }
    hint.style.display = "block";
  }

  function startObserver() {
    if (observerStarted) return true;

    const host = document.getElementById("tabWork");
    if (!host) return false;

    observerStarted = true;
    const observer = new MutationObserver(() => scheduleApply());
    observer.observe(host, { childList: true, subtree: true });
    return true;
  }

  function wireEventsOnce() {
    if (document.__spwtStandardTimeLockEventsWired) return;
    document.__spwtStandardTimeLockEventsWired = true;

    document.addEventListener("click", function (event) {
      if (event.target?.closest?.('[data-tab="tabWork"], #adminLoginBtn, #adminLogoutBtn')) {
        setTimeout(() => {
          startObserver();
          scheduleApply(0);
        }, 50);
      }
    }, true);

    document.addEventListener("change", function (event) {
      if (event.target?.closest?.("#accessUsersList")) {
        scheduleApply();
      }
    }, true);
  }

  function initStandardTimeUiLock() {
    wireEventsOnce();
    const observerReady = startObserver();
    scheduleApply(0);
    return observerReady || !!document.getElementById("adminPanel");
  }

  window.SPWT_APPLY_STANDARD_TIME_LOCK = applyStandardTimeUiLock;
})();
