// renderer/adminControlsPatch.js
// Lightweight patch for Admin Controls tab.
// Injects tab/page if missing and wires rule-control UI.

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

  function ensureAdminControlsTab() {
    const panel = document.getElementById("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return;

    if (!tabs.querySelector('[data-tab="tabControls"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.setAttribute("data-tab", "tabControls");
      btn.textContent = "Admin Controls";

      const pinTab = tabs.querySelector('[data-tab="tabPin"]');
      if (pinTab) tabs.insertBefore(btn, pinTab);
      else tabs.appendChild(btn);
    }

    if (!document.getElementById("tabControls")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabControls";
      page.innerHTML = `
        <div class="section-title">Admin Controls</div>
        <div class="small-hint">Control production entry rules. Default overrun reason limit is 120%.</div>

        <div class="card" style="margin-top:12px; box-shadow:none; border:1px solid #e5e7eb;">
          <div class="grid-2">
            <div class="field">
              <label class="quality-recheck-line">
                <input type="checkbox" id="overrunReasonEnabled" />
                Enable overrun reason rule
              </label>
              <div class="small-hint">If enabled, reason is required when Actual Time crosses configured percentage of Standard Time.</div>
            </div>

            <div class="field">
              <label>Overrun Limit (%)</label>
              <input id="overrunReasonLimitPct" class="admin-input" type="number" min="100" max="300" step="1" placeholder="120" />
              <div class="small-hint">Example: 120 means Actual Time &gt; 120% of Standard Time requires reason.</div>
            </div>

            <div class="field">
              <label class="quality-recheck-line">
                <input type="checkbox" id="bookingExtraReasonEnabled" />
                Enable booking extra time reason
              </label>
              <div class="small-hint">If enabled, reason is required when booking point time is more than remaining standard time.</div>
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <button class="btn green" id="saveAdminControlsBtn">Save Admin Controls</button>
            <span class="small-hint" id="adminControlsStatus"></span>
          </div>
        </div>
      `;

      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }
  }

  async function loadAdminControls(force = false) {
    if (controlsLoaded && !force) return adminControls;

    try {
      const res = await fetch(`${apiBaseUrl()}/api/admin/controls`);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);

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
    ensureAdminControlsTab();
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
    if (window.SPWT_ADMIN_ACCESS?.getToken) return window.SPWT_ADMIN_ACCESS.getToken() || "";
    return window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || "";
  }

  async function saveAdminControls() {
    if (controlsSaving) return;
    controlsSaving = true;

    const btn = document.getElementById("saveAdminControlsBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
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
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);

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
      if (btn) { btn.disabled = false; btn.textContent = "Save Admin Controls"; }
    }
  }

  function showControlsTabDirectly() {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabControls"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    document.getElementById("tabControls")?.classList.remove("hidden");
    renderAdminControls();
  }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtControlsPatched) return;

    const patched = function (tabId) {
      if (tabId === "tabControls") {
        showControlsTabDirectly();
        return;
      }
      return original.apply(this, arguments);
    };
    patched.__spwtControlsPatched = true;
    window.switchAdminTab = patched;
  }

  function wireControlsButton() {
    const saveBtn = document.getElementById("saveAdminControlsBtn");
    if (saveBtn && !saveBtn.__spwtWired) {
      saveBtn.__spwtWired = true;
      saveBtn.onclick = saveAdminControls;
    }
  }

  function patchStatic120Texts() {
    const pct = Number(adminControls.overrunReasonLimitPct || 120);
    document.querySelectorAll(".efficiencyReasonField label").forEach((label) => {
      label.textContent = `Reason for Low Efficiency (Required when Actual Time > ${pct}% of Standard Time)`;
    });
  }

  async function init() {
    ensureAdminControlsTab();
    await loadAdminControls(false);
    patchSwitchAdminTab();
    wireControlsButton();

    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabControls"]')) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(showControlsTabDirectly, 0);
      }
      setTimeout(wireControlsButton, 0);
    }, true);

    document.addEventListener("input", () => patchStatic120Texts(), true);
    document.addEventListener("change", () => patchStatic120Texts(), true);
    patchStatic120Texts();
  }

  window.SPWT_ADMIN_CONTROLS = adminControls;
  window.SPWT_LOAD_ADMIN_CONTROLS = loadAdminControls;
  window.SPWT_RENDER_ADMIN_CONTROLS = renderAdminControls;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
