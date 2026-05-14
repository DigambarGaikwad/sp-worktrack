// renderer/admin/adminPinDb.js
// DB Admin PIN helper.
// IMPORTANT: Admin login/logout must stay with original app.js flow.
// This file only saves the changed PIN to PocketBase DB.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(wireDbPinSaveOnly, 1200);
  });

  function wireDbPinSaveOnly() {
    const savePinBtn = $("savePinBtn");

    if (savePinBtn) {
      savePinBtn.onclick = dbSaveAdminPin;
      savePinBtn.textContent = "Save PIN to DB";
      savePinBtn.title = "Update Admin PIN in PocketBase DB";
    }
  }

  async function postJson(path, body) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.message || `Request failed with status ${res.status}`);
    }
    return payload;
  }

  async function dbSaveAdminPin() {
    const p1 = ($("newPin1")?.value || "").trim();
    const p2 = ($("newPin2")?.value || "").trim();

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
      await postJson("/api/admin/pin/update", { newPin: p1 });

      if (typeof adminOverrides !== "undefined" && adminOverrides) {
        adminOverrides.admin = adminOverrides.admin || {};
        adminOverrides.admin.pin = p1;
      }

      if ($("newPin1")) $("newPin1").value = "";
      if ($("newPin2")) $("newPin2").value = "";

      alert("Admin PIN updated in DB. Use the new PIN for next login.");
    } catch (err) {
      console.error(err);
      alert("PIN update failed:\n\n" + (err.message || err));
    }
  }
})();
