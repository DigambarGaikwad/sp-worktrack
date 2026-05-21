// renderer/adminControlsPatch.js
// Lightweight patch for Admin Controls tab.
// Keeps renderer/app.js stable and only wires rule-control UI.

(function () {
  const DEFAULT_CONTROLS = {
    overrunReasonEnabled: true,
    overrunReasonLimitPct: 120,
    bookingExtraReasonEnabled: true
  };

  let adminControls = { ...DEFAULT_CONTROLS };
  let controlsLoaded = false;
  let controlsSaving = false;

  function apiBaseUrl() {
    return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  }

  function normalizeControls(raw) {
    const pct = Number(raw?.overrunReasonLimitPct);
    return {
      overrunReasonEnabled: raw?.overrunReasonEnabled !== false,
      overrunReasonLimitPct: Number.isFinite(pct) ? Math.min(300, Math.max(100, pct)) : 120,
      bookingExtraReasonEnabled: raw?.bookingExtraReasonEnabled !== false
    };
  }

  function status(message, type = "") {
    const el = document.getElementById("adminControlsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#166534" : "";
  }

  async function loadAdminControls(force = false) {
    if (controlsLoaded && !force) return adminControls;

    try {
      const res = await fetch(`${apiBaseUrl()}/api/admin/controls`);
      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.message || `API error ${res.status}`);
      }

      adminControls = normalizeControls(payload.data);
      controlsLoaded = true;
      window.SPWT_ADMIN_CONTROLS = adminControls;
      return adminControls;
    } catch (err) {
      console.warn("Admin controls load failed. Using defaults.", err);
      adminControls = { ...DEFAULT_CONTROLS };
      window.SPWT_ADMIN_CONTROLS = adminControls;
      return adminControls;
    }
  }

  function fillControlsForm() {
    const overrunEnabled = document.getElementById("overrunReasonEnabled");
    const overrunPct = document.getElementById("overrunReasonLimitPct");
    const bookingExtra = document.getElementById("bookingExtraReasonEnabled");

    if (overrunEnabled) overrunEnabled.checked = adminControls.overrunReasonEnabled !== false;
    if (overrunPct) overrunPct.value = String(Number(adminControls.overrunReasonLimitPct || 120));
    if (bookingExtra) bookingExtra.checked = adminControls.bookingExtraReasonEnabled !== false;
  }

  async function renderAdminControls() {
    status("Loading controls...");
    await loadAdminControls(true);
    fillControlsForm();
    status("Current limit: " + adminControls.overrunReasonLimitPct + "%");
  }

  function readControlsForm() {
    const overrunEnabled = document.getElementById("overrunReasonEnabled");
    const overrunPct = document.getElementById("overrunReasonLimitPct");
    const bookingExtra = document.getElementById("bookingExtraReasonEnabled");

    return normalizeControls({
      overrunReasonEnabled: overrunEnabled ? overrunEnabled.checked : true,
      overrunReasonLimitPct: overrunPct ? Number(overrunPct.value || 120) : 120,
      bookingExtraReasonEnabled: bookingExtra ? bookingExtra.checked : true
    });
  }

  function getAdminToken() {
    // This will be used when frontend RBAC login is connected.
    // Current super-admin/local PIN flow can still save until strict frontend login is added.
    return window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || "";
  }

  async function saveAdminControls() {
    if (controlsSaving) return;
    controlsSaving = true;

    const btn = document.getElementById("saveAdminControlsBtn");
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving...";
      }
      status("Saving...");

      const body = readControlsForm();
      const token = getAdminToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers["x-spwt-admin-token"] = token;

      const res = await fetch(`${apiBaseUrl()}/api/admin/controls`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.message || `API error ${res.status}`);
      }

      adminControls = normalizeControls(payload.data);
      controlsLoaded = true;
      window.SPWT_ADMIN_CONTROLS = adminControls;
      fillControlsForm();
      status("Saved. Overrun limit is now " + adminControls.overrunReasonLimitPct + "%", "success");
    } catch (err) {
      console.error("Admin controls save failed:", err);
      status("Save failed: " + (err?.message || err), "error");
      alert("Admin Controls save failed: " + (err?.message || err));
    } finally {
      controlsSaving = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save Admin Controls";
      }
    }
  }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtControlsPatched) return;

    const patched = function (tabId) {
      const result = original.apply(this, arguments);
      if (tabId === "tabControls") renderAdminControls();
      return result;
    };
    patched.__spwtControlsPatched = true;
    window.switchAdminTab = patched;
  }

  function patchStatic120Texts() {
    // Frontend validation still shows 120 in a few messages until full RBAC/front-end refactor.
    // This keeps visible label updated for user guidance.
    const pct = Number(adminControls.overrunReasonLimitPct || 120);
    document.querySelectorAll(".efficiencyReasonField label").forEach((label) => {
      label.textContent = `Reason for Low Efficiency (Required when Actual Time > ${pct}% of Standard Time)`;
    });
  }

  async function init() {
    await loadAdminControls(false);
    patchSwitchAdminTab();

    const saveBtn = document.getElementById("saveAdminControlsBtn");
    if (saveBtn && !saveBtn.__spwtWired) {
      saveBtn.__spwtWired = true;
      saveBtn.onclick = saveAdminControls;
    }

    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabControls"]')) {
        setTimeout(renderAdminControls, 0);
      }
    });

    document.addEventListener("input", () => patchStatic120Texts(), true);
    document.addEventListener("change", () => patchStatic120Texts(), true);
    patchStatic120Texts();
  }

  window.SPWT_ADMIN_CONTROLS = adminControls;
  window.SPWT_LOAD_ADMIN_CONTROLS = loadAdminControls;
  window.SPWT_RENDER_ADMIN_CONTROLS = renderAdminControls;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
