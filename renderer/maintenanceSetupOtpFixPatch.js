// renderer/maintenanceSetupOtpFixPatch.js
// Overrides Clear Setup Data click so OTP token is always passed correctly.

(function () {
  const REQUEST_TIMEOUT_MS = 45000;
  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(v) { return String(v ?? "").trim(); }
  function esc(v) { return clean(v).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function box(msg, type) {
    const el = document.getElementById("clearSetupResult");
    if (!el) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#0b3f73";
    el.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(msg)}</div>`;
  }
  async function post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(body || {}) });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } finally { clearTimeout(timer); }
  }
  function render(data) {
    const counts = Object.fromEntries((data.deleted || []).map(x => [x.collection, x.deleted]));
    const rows = Object.entries(counts).map(([k,v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:900;">${esc(v)}</td></tr>`).join("");
    document.getElementById("clearSetupResult").innerHTML = `<div style="margin-top:10px;font-weight:900;color:#15803d;">Setup/master data cleared successfully.</div><table><thead><tr><th>Collection</th><th style="text-align:right;">Deleted</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function waitOtp(action) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => { if (!done) { done = true; document.removeEventListener("spwt-maintenance-otp-ready", handler); reject(new Error("OTP timed out. Try again.")); } }, 600000);
      function handler(e) {
        const d = e.detail || {};
        if (d.action !== action) return;
        done = true; clearTimeout(timeout); document.removeEventListener("spwt-maintenance-otp-ready", handler);
        if (!clean(d.otp) || !clean(d.otpRequestToken)) reject(new Error("OTP token missing. Request OTP again."));
        else resolve(d);
      }
      document.addEventListener("spwt-maintenance-otp-ready", handler);
      if (typeof window.SPWT_REQUEST_MAINTENANCE_OTP !== "function") { reject(new Error("OTP UI not loaded. Reopen Admin window.")); return; }
      box("Sending OTP to Admin recovery email...");
      window.SPWT_REQUEST_MAINTENANCE_OTP(action).catch(reject);
    });
  }
  document.addEventListener("click", function(e) {
    const btn = e.target?.closest?.("#confirmClearSetupBtn");
    if (!btn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    (async () => {
      try {
        const confirmText = clean(document.getElementById("clearSetupConfirmText")?.value);
        if (confirmText !== "MASTER") throw new Error("Type MASTER in the confirmation box first.");
        btn.disabled = true;
        const otp = await waitOtp("clear_setup");
        box("OTP accepted. Clearing setup/master data... please wait.");
        const data = await post("/api/maintenance/clear-setup/confirm", { confirmText, otpRequestToken: otp.otpRequestToken, otp: otp.otp });
        render(data);
        document.getElementById("clearSetupConfirmText").value = "";
        window.SPWT_CLOSE_MAINTENANCE_OTP?.();
      } catch (err) { box(err?.message || String(err), "error"); }
      finally { btn.disabled = false; }
    })();
  }, true);
})();
