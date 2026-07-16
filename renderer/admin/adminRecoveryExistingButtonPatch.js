// renderer/admin/adminRecoveryExistingButtonPatch.js
// Fixes Forgot PIN button when admin.html already contains #forgotPinBtn.
// Centralizes fast focus behavior for Forgot PIN, OTP entry, and return-to-login.
(function () {
  let pendingPinFocus = false;

  function $(id) { return document.getElementById(id); }

  function isVisible(el) {
    return !!el && !el.classList.contains("hidden") && el.offsetParent !== null;
  }

  function focusNow(id, selectText = false) {
    const el = $(id);
    if (!isVisible(el) && id !== "adminPinInput") return false;
    try {
      el.focus({ preventScroll: true });
      if (selectText && typeof el.select === "function") el.select();
      return document.activeElement === el;
    } catch (err) {
      return false;
    }
  }

  function focusSoon(id, selectText = false) {
    if (focusNow(id, selectText)) return;
    requestAnimationFrame(() => {
      if (focusNow(id, selectText)) return;
      requestAnimationFrame(() => focusNow(id, selectText));
    });
  }

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

    focusSoon("sendRecoveryOtpBtn");
  }

  function recoveryOverlayClosed() {
    const overlay = $("pinRecoveryOverlay");
    if (!overlay) return false;
    return overlay.classList.contains("hidden") || !overlay.classList.contains("show");
  }

  function focusAdminPinAfterReset() {
    if (!pendingPinFocus || !recoveryOverlayClosed()) return;

    const pinInput = $("adminPinInput");
    if (!pinInput) return;

    pendingPinFocus = false;
    pinInput.value = "";
    pinInput.scrollIntoView({ behavior: "instant", block: "center" });
    focusSoon("adminPinInput", true);
  }

  function markPinFocusPending() {
    pendingPinFocus = true;
  }

  function focusOtpWhenStepVisible() {
    const step2 = $("pinRecoveryStep2");
    if (isVisible(step2)) focusSoon("recoveryOtpInput", true);
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

  function wireOtpFocus() {
    ["sendRecoveryOtpBtn", "resendRecoveryOtpBtn"].forEach((id) => {
      const btn = $(id);
      if (!btn || btn.__spwtOtpFocusWired) return;
      btn.__spwtOtpFocusWired = true;
      btn.addEventListener("click", () => {
        const step2 = $("pinRecoveryStep2");
        if (isVisible(step2)) focusSoon("recoveryOtpInput", true);
      }, true);
    });

    const step2 = $("pinRecoveryStep2");
    if (step2 && !step2.__spwtOtpFocusObserved) {
      step2.__spwtOtpFocusObserved = true;
      new MutationObserver(focusOtpWhenStepVisible).observe(step2, { attributes: true, attributeFilter: ["class"] });
    }
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

  function wireAll() {
    wireForgotPinButton();
    wireOtpFocus();
    wireResetFocus();
  }

  function wireWithRetry() {
    wireAll();
    [300, 900, 1800].forEach((ms) => setTimeout(wireAll, ms));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireWithRetry, { once: true });
  else wireWithRetry();
})();