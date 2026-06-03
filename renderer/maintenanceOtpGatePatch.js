// renderer/maintenanceOtpGatePatch.js
// Adds OTP gate for destructive Maintenance actions using Admin recovery email.

(function () {
  const REQUEST_TIMEOUT_MS = 45000;
  let otpState = { action: "", requestToken: "" };

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function requestJson(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body || {})
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("OTP request timed out. Check backend/PocketBase and try again.");
      if (/failed to fetch/i.test(String(err?.message || err))) throw new Error("Cannot reach backend server. Restart npm run server and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function ensureOtpBox() {
    if (document.getElementById("maintenanceOtpOverlay")) return;
    const style = document.createElement("style");
    style.id = "maintenanceOtpStyle";
    style.textContent = `
      .maintenance-otp-overlay{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:99999;display:none;align-items:center;justify-content:center;padding:18px;}
      .maintenance-otp-overlay.open{display:flex;}
      .maintenance-otp-card{width:min(460px,96vw);background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(15,23,42,.30);padding:18px;border:1px solid #dbe3ee;}
      .maintenance-otp-title{font-size:18px;font-weight:900;color:#172033;margin-bottom:6px;}
      .maintenance-otp-hint{font-size:13px;color:#64748b;margin-bottom:12px;line-height:1.45;}
      .maintenance-otp-input{width:100%;border:2px solid #0b3f73;border-radius:10px;min-height:40px;padding:8px 10px;font-weight:900;letter-spacing:2px;font-size:16px;outline:none;}
      .maintenance-otp-row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;}
      .maintenance-otp-status{font-size:12px;font-weight:800;margin-top:8px;color:#64748b;}
      .maintenance-otp-status.error{color:#b91c1c;}
      .maintenance-otp-status.success{color:#15803d;}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "maintenanceOtpOverlay";
    overlay.className = "maintenance-otp-overlay";
    overlay.innerHTML = `
      <div class="maintenance-otp-card">
        <div class="maintenance-otp-title">Maintenance OTP Verification</div>
        <div id="maintenanceOtpHint" class="maintenance-otp-hint">OTP will be sent to Admin recovery email.</div>
        <input id="maintenanceOtpInput" class="maintenance-otp-input" placeholder="Enter 6 digit OTP" maxlength="8" autocomplete="off" />
        <div id="maintenanceOtpStatus" class="maintenance-otp-status"></div>
        <div class="maintenance-otp-row">
          <button id="maintenanceOtpCancelBtn" class="btn grey" type="button">Cancel</button>
          <button id="maintenanceOtpResendBtn" class="btn grey" type="button">Resend OTP</button>
          <button id="maintenanceOtpContinueBtn" class="btn green" type="button">Verify & Continue</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("maintenanceOtpCancelBtn")?.addEventListener("click", closeOtpBox);
    document.getElementById("maintenanceOtpResendBtn")?.addEventListener("click", () => requestOtpForAction(otpState.action, true));
    document.getElementById("maintenanceOtpContinueBtn")?.addEventListener("click", () => {
      const input = document.getElementById("maintenanceOtpInput");
      const otp = clean(input?.value);
      const event = new CustomEvent("spwt-maintenance-otp-ready", { detail: { action: otpState.action, otpRequestToken: otpState.requestToken, otp } });
      document.dispatchEvent(event);
    });
  }

  function setOtpStatus(message, type = "") {
    const el = document.getElementById("maintenanceOtpStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = `maintenance-otp-status ${type || ""}`;
  }

  function openOtpBox(action, maskedEmail = "") {
    ensureOtpBox();
    document.getElementById("maintenanceOtpOverlay")?.classList.add("open");
    const hint = document.getElementById("maintenanceOtpHint");
    if (hint) hint.innerHTML = `OTP sent to Admin recovery email${maskedEmail ? `: <b>${esc(maskedEmail)}</b>` : ""}. Action: <b>${esc(action)}</b>`;
    const input = document.getElementById("maintenanceOtpInput");
    if (input) { input.value = ""; setTimeout(() => input.focus(), 80); }
  }

  function closeOtpBox() {
    document.getElementById("maintenanceOtpOverlay")?.classList.remove("open");
    setOtpStatus("");
  }

  async function requestOtpForAction(action, resend = false) {
    try {
      ensureOtpBox();
      otpState.action = action;
      setOtpStatus(resend ? "Resending OTP..." : "Sending OTP...");
      const data = await requestJson("/api/maintenance/otp/request", { action });
      otpState.requestToken = data.requestToken;
      openOtpBox(action, data.maskedEmail || "");
      setOtpStatus("OTP sent. Enter OTP and continue.", "success");
      return data;
    } catch (err) {
      openOtpBox(action, "");
      setOtpStatus(err?.message || String(err), "error");
      throw err;
    }
  }

  window.SPWT_REQUEST_MAINTENANCE_OTP = requestOtpForAction;
  window.SPWT_CLOSE_MAINTENANCE_OTP = closeOtpBox;
})();
