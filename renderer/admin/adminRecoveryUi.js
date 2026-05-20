// renderer/admin/adminRecoveryUi.js
// Admin PIN recovery frontend.
// Adds Forgot PIN flow, OTP popup/reset, and recovery email setting in Change PIN tab.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  let resetToken = "";
  let maskedEmail = "";

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(initRecoveryUi, 1200);
    setTimeout(initRecoveryUi, 2500);
  });

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function tokenHeader() {
    try {
      const token = window.SPWT_ADMIN_ACCESS?.getToken?.() || "";
      return token ? { "X-SPWT-Admin-Token": token } : {};
    } catch (err) {
      return {};
    }
  }

  async function getJson(path) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: tokenHeader()
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
    return payload;
  }

  async function postJson(path, body, withToken = false) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(withToken ? tokenHeader() : {})
      },
      body: JSON.stringify(body || {})
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
    return payload;
  }

  function initRecoveryUi() {
    addForgotPinButton();
    addRecoveryModal();
    addRecoveryEmailField();
    loadRecoveryPublicHint();
    loadRecoveryEmailForAdmin();
  }

  function addForgotPinButton() {
    const loginBox = $("adminLoginBox");
    const loginBtn = $("adminLoginBtn");
    if (!loginBox || !loginBtn || $("forgotPinBtn")) return;

    const btn = document.createElement("button");
    btn.id = "forgotPinBtn";
    btn.type = "button";
    btn.className = "btn grey";
    btn.textContent = "Forgot PIN?";
    btn.onclick = openRecoveryModal;

    loginBtn.parentElement?.appendChild(btn);
  }

  function addRecoveryModal() {
    if ($("pinRecoveryOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "pinRecoveryOverlay";
    overlay.className = "hidden";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
      <div style="width:min(560px,96vw);background:white;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.25);overflow:hidden;">
        <div style="padding:18px 22px;border-bottom:1px solid #e5edf7;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:22px;font-weight:800;">Forgot Admin PIN</div>
            <div id="pinRecoveryHint" class="small-hint">Recovery email status loading...</div>
          </div>
          <button type="button" class="btn grey" id="closePinRecoveryBtn">Close</button>
        </div>
        <div style="padding:22px;">
          <div id="pinRecoveryStep1">
            <p class="small-hint">A 6-digit OTP will be sent to the configured recovery email.</p>
            <button type="button" class="btn green" id="sendRecoveryOtpBtn">Send OTP</button>
          </div>

          <div id="pinRecoveryStep2" class="hidden" style="margin-top:14px;">
            <div class="grid-2">
              <div class="field">
                <label>OTP</label>
                <input id="recoveryOtpInput" placeholder="6 digit OTP" maxlength="6" />
              </div>
              <div class="field">
                <label>New Admin PIN</label>
                <input id="recoveryNewPinInput" type="password" placeholder="New PIN" />
              </div>
            </div>
            <div class="field">
              <label>Confirm New PIN</label>
              <input id="recoveryConfirmPinInput" type="password" placeholder="Confirm New PIN" />
            </div>
            <div class="row" style="margin-top:12px;">
              <button type="button" class="btn green" id="resetPinWithOtpBtn">Reset PIN</button>
              <button type="button" class="btn grey" id="resendRecoveryOtpBtn">Resend OTP</button>
            </div>
            <div id="pinRecoveryMessage" class="small-hint" style="margin-top:10px;"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    $("closePinRecoveryBtn").onclick = closeRecoveryModal;
    $("sendRecoveryOtpBtn").onclick = requestOtp;
    $("resendRecoveryOtpBtn").onclick = requestOtp;
    $("resetPinWithOtpBtn").onclick = resetPinWithOtp;
  }

  function addRecoveryEmailField() {
    const tabPin = $("tabPin");
    if (!tabPin || $("adminRecoveryEmail")) return;

    const block = document.createElement("div");
    block.className = "card";
    block.style.marginTop = "18px";
    block.innerHTML = `
      <div class="section-title">Recovery Email</div>
      <div class="small-hint">Used for Forgot PIN OTP recovery. Keep this email accessible to Super Admin.</div>
      <div class="grid-2" style="margin-top:10px;">
        <div class="field">
          <label>Recovery Email</label>
          <input id="adminRecoveryEmail" type="email" placeholder="admin@example.com" />
        </div>
        <div class="field">
          <label>Status</label>
          <input id="adminRecoveryEmailStatus" readonly value="Not loaded" />
        </div>
      </div>
      <div class="row" style="margin-top:12px;">
        <button type="button" class="btn green" id="saveRecoveryEmailBtn">Save Recovery Email</button>
        <button type="button" class="btn grey" id="sendRecoveryTestOtpBtn">Send Test OTP</button>
      </div>
    `;

    tabPin.appendChild(block);

    $("saveRecoveryEmailBtn").onclick = saveRecoveryEmail;
    $("sendRecoveryTestOtpBtn").onclick = requestOtp;
  }

  async function loadRecoveryPublicHint() {
    const hint = $("pinRecoveryHint");
    try {
      const payload = await getJson("/api/admin/pin/recovery/public");
      maskedEmail = payload.data?.maskedEmail || "";
      if (hint) {
        hint.textContent = payload.data?.configured
          ? `OTP will be sent to ${maskedEmail}`
          : "Recovery email is not configured. Login and add recovery email first.";
      }
    } catch (err) {
      if (hint) hint.textContent = "Recovery status not available.";
    }
  }

  async function loadRecoveryEmailForAdmin() {
    const emailInput = $("adminRecoveryEmail");
    const status = $("adminRecoveryEmailStatus");
    if (!emailInput || !window.SPWT_ADMIN_ACCESS?.getToken?.()) return;

    try {
      const payload = await getJson("/api/admin/pin/recovery");
      emailInput.value = payload.data?.email || "";
      if (status) status.value = payload.data?.configured ? `Configured (${payload.data.maskedEmail})` : "Not configured";
    } catch (err) {
      if (status) status.value = err.message || "Could not load";
    }
  }

  async function saveRecoveryEmail() {
    const email = ($("adminRecoveryEmail")?.value || "").trim();
    const status = $("adminRecoveryEmailStatus");

    try {
      const payload = await postJson("/api/admin/pin/recovery", { email }, true);
      if (status) status.value = payload.data?.configured ? `Configured (${payload.data.maskedEmail})` : "Not configured";
      await loadRecoveryPublicHint();
      alert("Recovery email saved.");
    } catch (err) {
      alert("Recovery email save failed:\n\n" + (err.message || err));
    }
  }

  function openRecoveryModal() {
    $("pinRecoveryOverlay")?.classList.remove("hidden");
    $("pinRecoveryStep1")?.classList.remove("hidden");
    $("pinRecoveryStep2")?.classList.add("hidden");
    $("pinRecoveryMessage").textContent = "";
    loadRecoveryPublicHint();
  }

  function closeRecoveryModal() {
    $("pinRecoveryOverlay")?.classList.add("hidden");
  }

  async function requestOtp() {
    const msg = $("pinRecoveryMessage");
    try {
      const payload = await postJson("/api/admin/pin/forgot/request-otp", {});
      resetToken = payload.data?.resetToken || "";
      maskedEmail = payload.data?.maskedEmail || maskedEmail;
      $("pinRecoveryStep2")?.classList.remove("hidden");
      if (msg) msg.textContent = `OTP sent to ${maskedEmail}. Valid for ${payload.data?.expiresInMinutes || 10} minutes.`;
      alert(`OTP sent to ${maskedEmail}`);
    } catch (err) {
      alert("OTP send failed:\n\n" + (err.message || err));
    }
  }

  async function resetPinWithOtp() {
    const otp = ($("recoveryOtpInput")?.value || "").trim();
    const p1 = ($("recoveryNewPinInput")?.value || "").trim();
    const p2 = ($("recoveryConfirmPinInput")?.value || "").trim();

    if (!resetToken) {
      alert("Please send OTP first.");
      return;
    }
    if (!otp) {
      alert("Enter OTP.");
      return;
    }
    if (!p1 || !p2) {
      alert("Enter and confirm new PIN.");
      return;
    }
    if (p1 !== p2) {
      alert("PIN confirmation does not match.");
      return;
    }
    if (p1.length < 4) {
      alert("PIN must be at least 4 characters.");
      return;
    }

    try {
      await postJson("/api/admin/pin/forgot/reset", { resetToken, otp, newPin: p1 });
      alert("Admin PIN reset successful. Login with new PIN.");
      closeRecoveryModal();
      const pinInput = $("adminPinInput");
      if (pinInput) {
        pinInput.value = "";
        pinInput.focus();
      }
    } catch (err) {
      alert("PIN reset failed:\n\n" + (err.message || err));
    }
  }
})();
