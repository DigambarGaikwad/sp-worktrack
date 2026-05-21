// renderer/admin/adminRecoveryUi.js
// Admin PIN recovery frontend.
// Adds Forgot PIN flow, OTP popup/reset, and recovery email setting in Change PIN tab.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  let resetToken = "";
  let maskedEmail = "";
  let otpTimer = null;
  let otpSecondsLeft = 0;

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(initRecoveryUi, 1200);
    setTimeout(initRecoveryUi, 2500);
  });

  function $(id) {
    return document.getElementById(id);
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
    addRecoveryStyles();
    addForgotPinButton();
    addRecoveryModal();
    addRecoveryEmailField();
    loadRecoveryPublicHint();
    loadRecoveryEmailForAdmin();
  }

  function addRecoveryStyles() {
    if ($("spwtRecoveryStyles")) return;
    const style = document.createElement("style");
    style.id = "spwtRecoveryStyles";
    style.textContent = `
      #pinRecoveryOverlay {
        opacity: 0;
        pointer-events: none;
        transition: opacity .18s ease;
      }
      #pinRecoveryOverlay.show {
        opacity: 1;
        pointer-events: auto;
      }
      .pin-recovery-card {
        transform: translateY(8px) scale(.98);
        transition: transform .18s ease;
      }
      #pinRecoveryOverlay.show .pin-recovery-card {
        transform: translateY(0) scale(1);
      }
      .pin-recovery-input-wrap {
        position: relative;
      }
      .pin-recovery-eye {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        border: 0;
        background: #eef2f7;
        color: #334155;
        border-radius: 10px;
        padding: 6px 9px;
        cursor: pointer;
        font-weight: 800;
      }
      .pin-recovery-input-wrap input {
        padding-right: 54px !important;
      }
      .pin-recovery-success {
        color: #0f7a3b;
        background: #eafaf0;
        border: 1px solid #bdeccf;
        border-radius: 14px;
        padding: 10px 12px;
        font-weight: 800;
      }
      .pin-recovery-divider {
        height: 1px;
        background: #e5edf7;
        margin: 16px 0;
      }
      .pin-recovery-countdown {
        color: #7c2d12;
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 999px;
        padding: 6px 10px;
        font-weight: 800;
        display: inline-block;
        margin-top: 8px;
      }
    `;
    document.head.appendChild(style);
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
      <div class="card admin-page-card pin-recovery-card" style="width:min(540px,96vw);max-height:90vh;overflow:auto;margin:0;box-shadow:0 24px 70px rgba(15,23,42,.25);padding:0;">
        <div class="row-between" style="border-bottom:1px solid #e5edf7;padding:16px 18px;margin:0;">
          <div style="display:flex;gap:12px;align-items:center;">
            <div style="width:42px;height:42px;border-radius:14px;background:#eafaf0;display:flex;align-items:center;justify-content:center;font-size:22px;">🔐</div>
            <div>
              <div class="card-title" style="font-size:24px;line-height:1.1;">Forgot Admin PIN</div>
              <div id="pinRecoveryHint" class="small-hint" style="margin-top:4px;">Recovery email status loading...</div>
            </div>
          </div>
          <button type="button" class="btn grey" id="closePinRecoveryBtn" style="padding:10px 16px;">Close</button>
        </div>

        <div style="padding:18px;">
          <div id="pinRecoveryStep1" style="text-align:center;">
            <div class="small-hint">A 6-digit OTP will be sent to the configured recovery email.</div>
            <div class="row" style="margin-top:14px;justify-content:center;">
              <button type="button" class="btn green" id="sendRecoveryOtpBtn" style="min-width:130px;">Send OTP</button>
            </div>
          </div>

          <div id="pinRecoveryStep2" class="hidden">
            <div class="pin-recovery-divider"></div>
            <div class="grid-2">
              <div class="field">
                <label>OTP</label>
                <input class="admin-input" id="recoveryOtpInput" placeholder="6 digit OTP" maxlength="6" inputmode="numeric" />
              </div>
              <div class="field">
                <label>New Admin PIN</label>
                <div class="pin-recovery-input-wrap">
                  <input class="admin-input" id="recoveryNewPinInput" type="password" placeholder="New PIN" />
                  <button type="button" class="pin-recovery-eye" data-toggle-pin="recoveryNewPinInput">👁</button>
                </div>
              </div>
            </div>
            <div class="field">
              <label>Confirm New PIN</label>
              <div class="pin-recovery-input-wrap">
                <input class="admin-input" id="recoveryConfirmPinInput" type="password" placeholder="Confirm New PIN" />
                <button type="button" class="pin-recovery-eye" data-toggle-pin="recoveryConfirmPinInput">👁</button>
              </div>
            </div>
            <div class="row" style="margin-top:12px;justify-content:flex-start;">
              <button type="button" class="btn green" id="resetPinWithOtpBtn" style="min-width:125px;">Reset PIN</button>
              <button type="button" class="btn grey" id="resendRecoveryOtpBtn" style="min-width:120px;">Resend OTP</button>
            </div>
            <div id="otpCountdown" class="pin-recovery-countdown hidden"></div>
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

    overlay.querySelectorAll("[data-toggle-pin]").forEach((btn) => {
      btn.onclick = function () {
        const input = $(btn.getAttribute("data-toggle-pin"));
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
        btn.textContent = input.type === "password" ? "👁" : "🙈";
      };
    });
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
          <input class="admin-input" id="adminRecoveryEmail" type="email" placeholder="admin@example.com" />
        </div>
        <div class="field">
          <label>Status</label>
          <input class="admin-input" id="adminRecoveryEmailStatus" readonly value="Not loaded" />
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
    const overlay = $("pinRecoveryOverlay");
    overlay?.classList.remove("hidden");
    requestAnimationFrame(() => overlay?.classList.add("show"));
    $("pinRecoveryStep1")?.classList.remove("hidden");
    $("pinRecoveryStep2")?.classList.add("hidden");
    $("pinRecoveryMessage").textContent = "";
    stopCountdown();
    loadRecoveryPublicHint();
  }

  function closeRecoveryModal() {
    const overlay = $("pinRecoveryOverlay");
    overlay?.classList.remove("show");
    setTimeout(() => overlay?.classList.add("hidden"), 180);
    stopCountdown();
  }

  function startCountdown(minutes) {
    stopCountdown();
    otpSecondsLeft = Math.max(1, Number(minutes || 10) * 60);
    const el = $("otpCountdown");
    if (el) el.classList.remove("hidden");

    function tick() {
      const m = String(Math.floor(otpSecondsLeft / 60)).padStart(2, "0");
      const s = String(otpSecondsLeft % 60).padStart(2, "0");
      if (el) el.textContent = `OTP expires in ${m}:${s}`;
      otpSecondsLeft -= 1;
      if (otpSecondsLeft < 0) stopCountdown();
    }

    tick();
    otpTimer = setInterval(tick, 1000);
  }

  function stopCountdown() {
    if (otpTimer) clearInterval(otpTimer);
    otpTimer = null;
    const el = $("otpCountdown");
    if (el) el.classList.add("hidden");
  }

  async function requestOtp() {
    const msg = $("pinRecoveryMessage");
    try {
      const payload = await postJson("/api/admin/pin/forgot/request-otp", {});
      resetToken = payload.data?.resetToken || "";
      maskedEmail = payload.data?.maskedEmail || maskedEmail;
      $("pinRecoveryStep2")?.classList.remove("hidden");
      if (msg) {
        msg.className = "pin-recovery-success";
        msg.textContent = `✓ OTP sent to ${maskedEmail}.`;
      }
      startCountdown(payload.data?.expiresInMinutes || 10);
      setTimeout(() => $("recoveryOtpInput")?.focus(), 120);
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
