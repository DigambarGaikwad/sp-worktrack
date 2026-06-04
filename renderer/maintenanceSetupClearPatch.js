// renderer/maintenanceSetupClearPatch.js
// Adds Maintenance option to clear setup/master data: employees, machines, work/subwork, booking/quality points.
// Uses Maintenance OTP gate before confirm.

(function () {
  const REQUEST_TIMEOUT_MS = 45000;
  const CLEAR_SETUP_ACTION = "clear_setup";

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
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}. Restart backend and try again.`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timed out. Check backend/PocketBase and try again.");
      if (/failed to fetch/i.test(String(err?.message || err))) throw new Error("Cannot reach backend server. Restart npm run server and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function renderCounts(id, data, title) {
    const host = document.getElementById(id);
    if (!host) return;
    const counts = data?.counts || data?.collections || {};
    const rows = Object.entries(counts).map(([name, count]) => `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:900;">${esc(count)}</td></tr>`).join("");
    host.innerHTML = `<div style="margin-top:10px;font-weight:900;color:#15803d;">${esc(title)}</div>${rows ? `<table><thead><tr><th>Collection</th><th style="text-align:right;">Count</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="small-hint">No count data returned.</div>`}`;
  }

  function showBox(id, message, type = "info") {
    const host = document.getElementById(id);
    if (!host) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#0b3f73";
    host.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function ensureSetupBox() {
    const grid = document.querySelector("#tabMaintenance .maintenance-grid");
    if (!grid || document.getElementById("clearSetupDataBox")) return;

    const box = document.createElement("div");
    box.className = "maintenance-box";
    box.id = "clearSetupDataBox";
    box.innerHTML = `
      <div class="maintenance-title">5. Clear Setup / Master Data</div>
      <div class="small-hint">Clears employees, machines, work/subwork, booking points and quality points.</div>
      <div class="small-hint danger-note">Keeps PIN, email recipients, admin controls, backup settings, shifts, loss reasons and root areas.</div>
      <button class="btn grey" id="previewClearSetupBtn" type="button">Preview Setup Count</button>
      <label class="confirm-label">Type MASTER here to confirm</label>
      <input id="clearSetupConfirmText" class="admin-input confirm-input" placeholder="MASTER" autocomplete="off" />
      <button class="btn red" id="confirmClearSetupBtn" type="button">Clear Setup Data</button>
      <div id="clearSetupResult"></div>
    `;
    grid.appendChild(box);
  }

  async function previewSetup(btn) {
    if (btn?.disabled) return;
    try {
      btn.disabled = true;
      showBox("clearSetupResult", "Previewing setup/master data...");
      const data = await requestJson("/api/maintenance/clear-setup/preview", {});
      renderCounts("clearSetupResult", data, `Preview complete. Total setup records: ${data.total || 0}`);
    } catch (err) {
      showBox("clearSetupResult", err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function clearSetupWithOtp(btn, otpPayload = {}) {
    if (btn?.disabled) return;
    try {
      const confirmText = clean(document.getElementById("clearSetupConfirmText")?.value);
      if (confirmText !== "MASTER") throw new Error("Type MASTER in the confirmation box first.");

      const requestToken = clean(otpPayload.otpRequestToken || otpPayload.requestToken);
      const otp = clean(otpPayload.otp);
      if (!requestToken || !otp) throw new Error("Maintenance OTP details missing. Request OTP again.");

      btn.disabled = true;
      showBox("clearSetupResult", "Clearing setup/master data... please wait.");
      const data = await requestJson("/api/maintenance/clear-setup/confirm", {
        confirmText,
        action: CLEAR_SETUP_ACTION,
        otpRequestToken: requestToken,
        requestToken,
        otp
      });

      window.SPWT_CLOSE_MAINTENANCE_OTP?.();
      const deletedCounts = Object.fromEntries((data.deleted || []).map(x => [x.collection, x.deleted]));
      renderCounts("clearSetupResult", { counts: deletedCounts }, "Setup/master data cleared successfully.");
      const input = document.getElementById("clearSetupConfirmText");
      if (input) input.value = "";
    } catch (err) {
      showBox("clearSetupResult", err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function clearSetup(btn) {
    if (btn?.disabled) return;
    try {
      const confirmText = clean(document.getElementById("clearSetupConfirmText")?.value);
      if (confirmText !== "MASTER") throw new Error("Type MASTER in the confirmation box first.");
      if (typeof window.SPWT_REQUEST_MAINTENANCE_OTP !== "function") throw new Error("Maintenance OTP UI is not loaded. Restart app and try again.");

      btn.disabled = true;
      showBox("clearSetupResult", "Sending Maintenance OTP...");
      await window.SPWT_REQUEST_MAINTENANCE_OTP(CLEAR_SETUP_ACTION);
      showBox("clearSetupResult", "OTP sent. Enter OTP and click Verify & Continue.");
    } catch (err) {
      showBox("clearSetupResult", err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireOtpListener() {
    if (document.__clearSetupOtpListenerWired) return;
    document.__clearSetupOtpListenerWired = true;
    document.addEventListener("spwt-maintenance-otp-ready", (event) => {
      const detail = event?.detail || {};
      if (detail.action !== CLEAR_SETUP_ACTION) return;
      const clearBtn = document.getElementById("confirmClearSetupBtn") || { disabled: false };
      clearSetupWithOtp(clearBtn, detail);
    });
  }

  function wire() {
    ensureSetupBox();
    wireOtpListener();
    const previewBtn = document.getElementById("previewClearSetupBtn");
    const clearBtn = document.getElementById("confirmClearSetupBtn");
    if (previewBtn && !previewBtn.__wired) {
      previewBtn.__wired = true;
      previewBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); previewSetup(previewBtn); }, true);
    }
    if (clearBtn && !clearBtn.__wired) {
      clearBtn.__wired = true;
      clearBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); clearSetup(clearBtn); }, true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(wire, 600));
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.('[data-tab="tabMaintenance"]')) setTimeout(wire, 300);
    setTimeout(wire, 100);
  }, true);
  setInterval(() => {
    const tab = document.getElementById("tabMaintenance");
    if (tab && !tab.classList.contains("hidden")) wire();
  }, 1500);
})();
