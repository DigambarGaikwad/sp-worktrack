// renderer/admin/adminPinDb.js
// DB Admin PIN helper.
// Handles only PIN change from the Admin page. Login/logout is handled by adminAccessUi.js.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;
  const $ = (id) => document.getElementById(id);

  let wireAttempts = 0;
  let savingPin = false;

  document.addEventListener("DOMContentLoaded", function () {
    scheduleWirePinSave();
  });

  function scheduleWirePinSave() {
    wireAttempts += 1;
    const wired = wireDbPinSaveOnly();
    if (!wired && wireAttempts < 12) {
      setTimeout(scheduleWirePinSave, 250);
    }
  }

  function wireDbPinSaveOnly() {
    const savePinBtn = $("savePinBtn");
    if (!savePinBtn) return false;
    if (savePinBtn.__spwtPinDbWired) return true;

    savePinBtn.__spwtPinDbWired = true;
    savePinBtn.type = "button";
    savePinBtn.onclick = dbSaveAdminPin;
    savePinBtn.textContent = "Save PIN to DB";
    savePinBtn.title = "Update Admin PIN in PocketBase DB";

    [$("newPin1"), $("newPin2")].forEach((input) => {
      if (!input || input.__spwtPinEnterWired) return;
      input.__spwtPinEnterWired = true;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          dbSaveAdminPin();
        }
      });
    });

    return true;
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

  function getAdminHeaders() {
    const tokenHeaders = window.SPWT_ADMIN_TOKEN_HEADER ? window.SPWT_ADMIN_TOKEN_HEADER() : {};
    return {
      "Content-Type": "application/json",
      ...tokenHeaders
    };
  }

  async function postJson(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.message || `Request failed with status ${res.status}`);
      }
      return payload;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timeout. Check server is running.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function syncLocalAdminPin(pin) {
    try {
      if (typeof adminOverrides !== "undefined" && adminOverrides) {
        adminOverrides.admin = adminOverrides.admin || {};
        adminOverrides.admin.pin = pin;
      }
    } catch (err) {
      console.warn("Could not sync local admin PIN cache", err);
    }
  }

  async function dbSaveAdminPin() {
    if (savingPin) return;

    const p1 = ($("newPin1")?.value || "").trim();
    const p2 = ($("newPin2")?.value || "").trim();

    if (!p1 || !p2) {
      alert("Enter and confirm new PIN.");
      $("newPin1")?.focus();
      return;
    }

    if (p1 !== p2) {
      alert("PIN confirmation does not match.");
      $("newPin2")?.focus();
      return;
    }

    if (p1.length < 4) {
      alert("PIN must be at least 4 characters.");
      $("newPin1")?.focus();
      return;
    }

    try {
      setPinBusy(true);
      await postJson("/api/admin/pin", { newPin: p1 });

      syncLocalAdminPin(p1);

      if ($("newPin1")) $("newPin1").value = "";
      if ($("newPin2")) $("newPin2").value = "";

      alert("Admin PIN updated in DB. Use the new PIN for next login.");
    } catch (err) {
      console.error(err);
      alert("PIN update failed:\n\n" + (err.message || err));
      $("newPin1")?.focus();
    } finally {
      setPinBusy(false);
    }
  }
})();
