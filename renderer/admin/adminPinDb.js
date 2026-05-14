// renderer/admin/adminPinDb.js
// DB-only Admin PIN login/change override.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(wireDbPinButtons, 800);
  });

  function wireDbPinButtons() {
    const loginBtn = $("adminLoginBtn");
    const savePinBtn = $("savePinBtn");
    const logoutBtn = $("adminLogoutBtn");

    if (loginBtn) {
      loginBtn.onclick = dbAdminLogin;
      loginBtn.title = "Login using Admin PIN from PocketBase DB";
    }

    if (savePinBtn) {
      savePinBtn.onclick = dbSaveAdminPin;
      savePinBtn.title = "Update Admin PIN in PocketBase DB";
    }

    if (logoutBtn) {
      logoutBtn.onclick = dbAdminLogout;
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

  async function dbAdminLogin() {
    const pin = ($("adminPinInput")?.value || "").trim();

    if (!pin) {
      alert("Enter Admin PIN.");
      return;
    }

    try {
      const payload = await postJson("/api/admin/pin/verify", { pin });

      if (!payload.valid) {
        alert("Wrong Admin PIN.");
        return;
      }

      const loginBox = $("adminLoginBox");
      const panel = $("adminPanel");
      if (loginBox) loginBox.classList.add("hidden");
      if (panel) panel.classList.remove("hidden");
      if ($("adminPinInput")) $("adminPinInput").value = "";

      showToast("Admin login successful ✅", "success");
    } catch (err) {
      console.error(err);
      alert("Admin login failed:\n\n" + (err.message || err));
    }
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
      if ($("newPin1")) $("newPin1").value = "";
      if ($("newPin2")) $("newPin2").value = "";
      showToast("Admin PIN updated in DB ✅", "success");
      alert("Admin PIN updated in DB. Use the new PIN for next login.");
    } catch (err) {
      console.error(err);
      alert("PIN update failed:\n\n" + (err.message || err));
    }
  }

  function dbAdminLogout() {
    const loginBox = $("adminLoginBox");
    const panel = $("adminPanel");
    if (loginBox) loginBox.classList.remove("hidden");
    if (panel) panel.classList.add("hidden");
    showToast("Logged out", "success");
  }

  function showToast(message, type) {
    let toast = $("adminDbToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "adminDbToast";
      toast.className = "admin-db-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `admin-db-toast show ${type || ""}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 3500);
  }
})();
