// renderer/admin/adminCoreStabilityPatch.js
// Small DB-mode stability patch for dynamic Admin tabs.
// - normalizes planned absence list API shape for older Admin UI code
// - protects Change PIN button from being overwritten by legacy handlers

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;
  const $ = (id) => document.getElementById(id);
  let savingPin = false;

  function getToken() {
    try { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
    catch { return ""; }
  }

  function withTimeout() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return { controller, done: () => clearTimeout(timer) };
  }

  function normalizePlannedAbsenceFetch() {
    if (window.__spwtPlannedAbsenceFetchNormalized) return;
    if (typeof window.fetch !== "function") return;

    const nativeFetch = window.fetch.bind(window);
    window.__spwtPlannedAbsenceFetchNormalized = true;

    window.fetch = async function spwtFetch(input, init = {}) {
      const res = await nativeFetch(input, init);

      try {
        const url = typeof input === "string" ? input : String(input?.url || "");
        const method = String(init?.method || input?.method || "GET").toUpperCase();
        if (method !== "GET" || !url.includes("/api/admin/planned-absences")) return res;

        const payload = await res.clone().json().catch(() => null);
        if (!payload?.ok || Array.isArray(payload.items)) return res;

        const items = Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(payload.data?.items)
            ? payload.data.items
            : [];

        const headers = new Headers(res.headers);
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(JSON.stringify({ ...payload, items }), {
          status: res.status,
          statusText: res.statusText,
          headers
        });
      } catch (err) {
        console.warn("Planned absence response normalization skipped:", err);
        return res;
      }
    };
  }

  function setPinBusy(isBusy) {
    savingPin = !!isBusy;
    const btn = $("savePinBtn");
    const p1 = $("newPin1");
    const p2 = $("newPin2");

    if (btn) {
      btn.disabled = savingPin;
      btn.textContent = savingPin ? "Saving..." : "Save PIN to DB";
    }
    if (p1) p1.disabled = savingPin;
    if (p2) p2.disabled = savingPin;
  }

  async function savePinToDb(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    if (savingPin) return;

    const p1 = ($("newPin1")?.value || "").trim();
    const p2 = ($("newPin2")?.value || "").trim();

    if (!p1 || !p2) return alert("Enter and confirm new PIN.");
    if (p1 !== p2) return alert("PIN confirmation does not match.");
    if (p1.length < 4) return alert("PIN must be at least 4 characters.");

    const token = getToken();
    if (!token) return alert("Login session required. Please logout and login again.");

    const { controller, done } = withTimeout();
    try {
      setPinBusy(true);
      const res = await fetch(`${API_BASE_URL}/api/admin/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SPWT-Admin-Token": token
        },
        body: JSON.stringify({ newPin: p1 }),
        signal: controller.signal
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `PIN update failed ${res.status}`);

      if ($("newPin1")) $("newPin1").value = "";
      if ($("newPin2")) $("newPin2").value = "";
      alert("Admin PIN updated in DB. Use the new PIN for next login.");
    } catch (err) {
      console.error("Admin PIN update failed:", err);
      alert("PIN update failed:\n\n" + (err?.name === "AbortError" ? "Request timeout. Check server is running." : (err?.message || err)));
    } finally {
      done();
      setPinBusy(false);
    }
  }

  function wirePinButton() {
    const btn = $("savePinBtn");
    if (!btn) return;

    btn.type = "button";
    btn.textContent = savingPin ? "Saving..." : "Save PIN to DB";
    btn.title = "Update Admin PIN in PocketBase DB";
    btn.onclick = savePinToDb;

    if (!btn.__spwtStablePinCaptureWired) {
      btn.__spwtStablePinCaptureWired = true;
      btn.addEventListener("click", savePinToDb, true);
    }
  }

  normalizePlannedAbsenceFetch();

  document.addEventListener("DOMContentLoaded", () => {
    wirePinButton();
    [250, 800, 1500, 3000].forEach((ms) => setTimeout(wirePinButton, ms));
  });

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.('[data-tab="tabPin"], #savePinBtn')) {
      setTimeout(wirePinButton, 0);
      setTimeout(wirePinButton, 200);
    }
  }, true);
})();
