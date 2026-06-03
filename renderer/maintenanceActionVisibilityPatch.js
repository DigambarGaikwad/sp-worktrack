// renderer/maintenanceActionVisibilityPatch.js
// Extra safety patch: shows Maintenance API action progress/errors inside the same card and requires OTP for destructive actions.

(function () {
  const REQUEST_TIMEOUT_MS = 45000;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function host(id) { return document.getElementById(id); }

  function showBox(id, message, type = "info") {
    const el = host(id);
    if (!el) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#0b3f73";
    el.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function renderCounts(id, data, title = "Result") {
    const el = host(id);
    if (!el) return;
    const counts = data?.counts || data?.collections || {};
    const rows = Object.entries(counts).map(([name, count]) => `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:900;">${esc(count)}</td></tr>`).join("");
    el.innerHTML = `<div style="margin-top:10px;font-weight:900;color:#15803d;">${esc(title)}</div>${rows ? `<table><thead><tr><th>Collection</th><th style="text-align:right;">Count</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="small-hint">No count data returned.</div>`}`;
  }

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
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}. Restart backend server and try again.`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timed out. Check backend/PocketBase and try again.");
      if (/failed to fetch/i.test(String(err?.message || err))) throw new Error("Cannot reach backend server. Restart npm run server and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function readClearPayload() {
    return { fromDate: clean(host("clearFromDate")?.value), toDate: clean(host("clearToDate")?.value) };
  }

  function readEmpPayload() {
    return { empCode: clean(host("deleteEmpCode")?.value), fromDate: clean(host("deleteEmpFromDate")?.value), toDate: clean(host("deleteEmpToDate")?.value) };
  }

  function waitForOtp(action, resultBoxId) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        document.removeEventListener("spwt-maintenance-otp-ready", handler);
        reject(new Error("OTP verification timed out. Please try again."));
      }, 10 * 60 * 1000);

      function handler(e) {
        const detail = e.detail || {};
        if (detail.action !== action) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener("spwt-maintenance-otp-ready", handler);
        if (!clean(detail.otp)) reject(new Error("Enter OTP first."));
        else resolve(detail);
      }

      document.addEventListener("spwt-maintenance-otp-ready", handler);
      if (typeof window.SPWT_REQUEST_MAINTENANCE_OTP !== "function") {
        done = true;
        clearTimeout(timer);
        document.removeEventListener("spwt-maintenance-otp-ready", handler);
        reject(new Error("OTP UI is not loaded. Reopen Admin window after pulling latest code."));
        return;
      }
      showBox(resultBoxId, "Sending OTP to Admin recovery email...");
      window.SPWT_REQUEST_MAINTENANCE_OTP(action).catch(reject);
    });
  }

  async function runWithBox(resultBoxId, button, action) {
    if (button?.disabled) return;
    try {
      if (button) button.disabled = true;
      await action();
    } catch (err) {
      showBox(resultBoxId, err?.message || String(err), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function interceptMaintenanceClicks(e) {
    const btn = e.target?.closest?.("button");
    if (!btn || !document.getElementById("tabMaintenance") || document.getElementById("tabMaintenance").classList.contains("hidden")) return;

    if (btn.id === "previewClearTransactionsBtn") {
      e.preventDefault(); e.stopImmediatePropagation();
      runWithBox("clearTransactionsResult", btn, async () => {
        showBox("clearTransactionsResult", "Previewing transaction data...");
        const data = await requestJson("/api/maintenance/clear-transactions/preview", readClearPayload());
        renderCounts("clearTransactionsResult", data, `Preview complete. Total records: ${data.total || 0}`);
      });
      return;
    }

    if (btn.id === "confirmClearTransactionsBtn") {
      e.preventDefault(); e.stopImmediatePropagation();
      runWithBox("clearTransactionsResult", btn, async () => {
        const confirmText = clean(host("clearConfirmText")?.value);
        if (confirmText !== "CLEAR") throw new Error("Type CLEAR in the confirmation box first.");
        const otp = await waitForOtp("clear_transactions", "clearTransactionsResult");
        showBox("clearTransactionsResult", "OTP accepted. Clearing transaction data... please wait.");
        const data = await requestJson("/api/maintenance/clear-transactions/confirm", { ...readClearPayload(), confirmText, otpRequestToken: otp.otpRequestToken, otp: otp.otp });
        const deletedCounts = Object.fromEntries((data.deleted || []).map(x => [x.collection, x.deleted]));
        renderCounts("clearTransactionsResult", { counts: deletedCounts }, "Transaction data cleared successfully.");
        if (host("clearConfirmText")) host("clearConfirmText").value = "";
        window.SPWT_CLOSE_MAINTENANCE_OTP?.();
      });
      return;
    }

    if (btn.id === "previewDeleteEmployeeBtn") {
      e.preventDefault(); e.stopImmediatePropagation();
      runWithBox("deleteEmployeeResult", btn, async () => {
        showBox("deleteEmployeeResult", "Previewing employee entries...");
        const data = await requestJson("/api/maintenance/employee-delete/preview", readEmpPayload());
        renderCounts("deleteEmployeeResult", data, `Preview complete. Total records: ${data.total || 0}`);
      });
      return;
    }

    if (btn.id === "confirmDeleteEmployeeBtn") {
      e.preventDefault(); e.stopImmediatePropagation();
      runWithBox("deleteEmployeeResult", btn, async () => {
        const confirmText = clean(host("deleteEmpConfirmText")?.value);
        if (confirmText !== "DELETE") throw new Error("Type DELETE in the confirmation box first.");
        const otp = await waitForOtp("employee_delete", "deleteEmployeeResult");
        showBox("deleteEmployeeResult", "OTP accepted. Deleting employee entries and rebuilding booking status... please wait.");
        const data = await requestJson("/api/maintenance/employee-delete/confirm", { ...readEmpPayload(), confirmText, otpRequestToken: otp.otpRequestToken, otp: otp.otp });
        const deletedCounts = Object.fromEntries((data.deleted || []).map(x => [x.collection, x.deleted]));
        renderCounts("deleteEmployeeResult", { counts: deletedCounts }, `Employee entries deleted. Booking status rebuilt: ${data.bookingRebuild?.rebuilt || 0}`);
        if (host("deleteEmpConfirmText")) host("deleteEmpConfirmText").value = "";
        window.SPWT_CLOSE_MAINTENANCE_OTP?.();
      });
    }
  }

  document.addEventListener("click", interceptMaintenanceClicks, true);
})();
