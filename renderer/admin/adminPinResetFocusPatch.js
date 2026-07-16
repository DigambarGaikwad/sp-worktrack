// renderer/admin/adminPinResetFocusPatch.js
// After successful Forgot PIN reset, return cursor to the Admin PIN input.
(function () {
  let pendingFocusUntil = 0;

  function $(id) { return document.getElementById(id); }

  function overlayClosed() {
    const overlay = $("pinRecoveryOverlay");
    if (!overlay) return false;
    return overlay.classList.contains("hidden") || !overlay.classList.contains("show");
  }

  function focusAdminPin() {
    const pin = $("adminPinInput");
    if (!pin) return false;
    pin.value = "";
    pin.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      pin.focus();
      pin.select?.();
    }, 80);
    return true;
  }

  function tryFocus() {
    if (!pendingFocusUntil || Date.now() > pendingFocusUntil) return;
    if (overlayClosed() && focusAdminPin()) pendingFocusUntil = 0;
  }

  function markPendingFocus() {
    pendingFocusUntil = Date.now() + 15000;
    [250, 700, 1200, 2000, 3500, 6000].forEach((ms) => setTimeout(tryFocus, ms));
  }

  function wireResetButton() {
    const btn = $("resetPinWithOtpBtn");
    if (btn && !btn.__spwtPinResetFocusWired) {
      btn.__spwtPinResetFocusWired = true;
      btn.addEventListener("click", markPendingFocus, true);
    }

    const overlay = $("pinRecoveryOverlay");
    if (overlay && !overlay.__spwtPinResetFocusObserved) {
      overlay.__spwtPinResetFocusObserved = true;
      new MutationObserver(tryFocus).observe(overlay, { attributes: true, attributeFilter: ["class"] });
    }
  }

  function wireWithRetry() {
    wireResetButton();
    setTimeout(wireResetButton, 600);
    setTimeout(wireResetButton, 1500);
    setTimeout(wireResetButton, 3000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireWithRetry, { once: true });
  else wireWithRetry();
})();
