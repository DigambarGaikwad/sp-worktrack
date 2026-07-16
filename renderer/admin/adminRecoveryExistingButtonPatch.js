// renderer/admin/adminRecoveryExistingButtonPatch.js
// Fixes Forgot PIN button when admin.html already contains #forgotPinBtn.
// adminRecoveryUi.js originally created/wired the button only when it did not already exist.
(function () {
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

  function wireWithRetry() {
    wireForgotPinButton();
    setTimeout(wireForgotPinButton, 500);
    setTimeout(wireForgotPinButton, 1500);
    setTimeout(wireForgotPinButton, 3000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireWithRetry, { once: true });
  else wireWithRetry();
})();
