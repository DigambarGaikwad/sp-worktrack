// renderer/admin/adminRecoveryExistingButtonPatch.js
// Fixes Forgot PIN button when admin.html already contains #forgotPinBtn.
// Also returns cursor to Enter Admin PIN after successful OTP reset.
(function () {
  let pendingPinFocusUntil = 0;

  function $(id) { return document.getElementById(id); }

  function openRecoveryModal() {
    const overlay = $("pinRecoveryOverlay");
    if (!overlay) {
      alert("Forgot PIN screen is not ready yet. Please wait a moment and try again.");
      return;
    }

    overlay.classList.remove("hidden");
    requestAnimationFrame(() => overlay.classList.add("show"));

    $("pinRecoveryStep1")?.classList.remove("hidden");
    $("pinRecoveryStep2")?.classList.add("hidden");

    const message = $("pinRecoveryMessage");
    if (message) {
      message.className = "small-hint";
      message.textContent = "";
    }

    setTimeout(() => $("sendRecoveryOtpBtn")?.focus(), 120);
  }

  function recoveryOverlayClosed() {
    const overlay = $("pinRecoveryOverlay");
    if (!overlay) return false;
    return overlay.classList.contains("hidden") || !overlay.classList.contains("show");
  }

  function focusAdminPinAfterReset() {
    if (!pendingPinFocusUntil || Date.now() > pendingPinFocusUntil) return;
    if (!recoveryOverlayClosed()) return;

    const pinInput = $("adminPinInput");
    if (!pinInput) return;

    pendingPinFocusUntil = 0;
    pinInput.value = "";
    pinInput.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      pinInput.focus();
      pinInput.select?.();
    }, 80);
  }

  function markPinFocusPending() {
    pendingPinFocusUntil = Date.now() + 15000;
    [250, 700, 1200, 2000, 3500, 6000, 9000].forEach((ms) => setTimeout(focusAdminPinAfterReset, ms));
  }

  function wireForgotPinButton() {
    const btn = $("forgotPinBtn");
    if (!btn || btn.__spwtForgotPinWired) return;
    btn.__spwtForgotPinWired = true;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openRecoveryModal();
    }, true);
  }

  function wireResetFocus() {
    const resetBtn = $("resetPinWithOtpBtn");
    if (resetBtn && !resetBtn.__spwtResetFocusWired) {
      resetBtn.__spwtResetFocusWired = true;
      resetBtn.addEventListener("click", markPinFocusPending, true);
    }

    const overlay = $("pinRecoveryOverlay");
    if (overlay && !overlay.__spwtResetFocusObserved) {
      overlay.__spwtResetFocusObserved = true;
      new MutationObserver(focusAdminPinAfterReset).observe(overlay, { attributes: true, attributeFilter: ["class"] });
    }
  }

  function wireWithRetry() {
    wireForgotPinButton();
    wireResetFocus();
    [500, 1500, 3000].forEach((ms) => setTimeout(() => {
      wireForgotPinButton();
      wireResetFocus();
    }, ms));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireWithRetry, { once: true });
  else wireWithRetry();
})();
