// renderer/adminControlsPatch.js
// Admin Controls tab + entry-screen rule sync.
// Cleaned: no timer loop, no CSS override. Uses debounced DOM/event updates.

(function () {
  const DEFAULT_CONTROLS = {
    overrunReasonEnabled: true,
    overrunReasonLimitPct: 120,
    bookingExtraReasonEnabled: true
  };

  const AUTO_REASON = "Not required - disabled by Admin Control";

  let adminControls = { ...DEFAULT_CONTROLS };
  let controlsLoaded = false;
  let controlsSaving = false;
  let applyTimer = null;
  let observerStarted = false;

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

  function getOverrunLimitPct() {
    return Number(adminControls.overrunReasonLimitPct || 120);
  }

  function isOverrunReasonEnabled() {
    return adminControls.overrunReasonEnabled !== false;
  }

  function isBookingExtraReasonEnabled() {
    return adminControls.bookingExtraReasonEnabled !== false;
  }

  function status(message, type = "") {
    const el = document.getElementById("adminControlsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#166534" : "";
  }

  function scheduleEntryControlApply(forSubmit = false) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => applyEntryControlsToScreen(forSubmit), forSubmit ? 0 : 60);
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
    } catch (err) {
      console.warn("Admin controls load failed. Using defaults.", err);
      adminControls = { ...DEFAULT_CONTROLS };
    }

    controlsLoaded = true;
    window.SPWT_ADMIN_CONTROLS = adminControls;
    scheduleEntryControlApply();
    return adminControls;
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
      scheduleEntryControlApply();
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

  function cardNeedsEfficiencyReason(card) {
    const standard = Number(card.querySelector(".standardTime")?.value || 0);
    const actual = Number(card.querySelector(".actualTime")?.value || 0);
    const workNature = card.querySelector(".typeSelect")?.value || "Normal";
    const limitPct = getOverrunLimitPct();
    return isOverrunReasonEnabled() && workNature === "Normal" && standard > 0 && actual > standard * (limitPct / 100);
  }

  function applyEfficiencyControlsToCard(card, forSubmit = false) {
    const field = card.querySelector(".efficiencyReasonField");
    const input = card.querySelector(".efficiencyReasonInput");
    const label = field?.querySelector("label");
    const pct = getOverrunLimitPct();

    if (label) {
      label.textContent = `Reason for Low Efficiency (Required when Actual Time > ${pct}% of Standard Time)`;
    }

    if (!isOverrunReasonEnabled()) {
      if (field) field.style.display = "none";
      if (input) {
        if (forSubmit) input.value = AUTO_REASON;
        else if (input.value === AUTO_REASON) input.value = "";
      }
      return;
    }

    const needs = cardNeedsEfficiencyReason(card);
    if (field) field.style.display = needs ? "flex" : "none";
    if (!needs && input && input.value === AUTO_REASON) input.value = "";
  }

  function applyBookingExtraControlsToCard(card, forSubmit = false) {
    const enabled = isBookingExtraReasonEnabled();

    card.querySelectorAll(".booking-point-row").forEach((row) => {
      const check = row.querySelector(".bpCheck");
      const book = row.querySelector(".bpBookTime");
      const reasonBox = row.querySelector(".bpOverReasonBox");
      const reasonInput = row.querySelector(".bpOverReason");
      const reasonHint = row.querySelector(".bpOverHint");
      if (!check || !book) return;

      const max = Number(book.dataset.max || check.dataset.remaining || check.dataset.time || 0);
      const val = Number(book.value || 0);
      const extra = Math.max(0, val - max);

      if (!enabled) {
        if (reasonBox) reasonBox.style.display = "none";
        if (reasonHint) reasonHint.textContent = "";
        if (reasonInput) {
          if (forSubmit && extra > 0) reasonInput.value = AUTO_REASON;
          else if (reasonInput.value === AUTO_REASON) reasonInput.value = "";
        }
        row.classList.remove("entry-error");
        return;
      }

      if (reasonBox) reasonBox.style.display = extra > 0 ? "block" : "none";
      if (reasonHint) {
        reasonHint.textContent = extra > 0
          ? `Extra ${extra} min beyond remaining ${max} min. Reason required.`
          : "";
      }
      if (extra <= 0 && reasonInput?.value === AUTO_REASON) reasonInput.value = "";
    });
  }

  function applyEntryControlsToScreen(forSubmit = false) {
    document.querySelectorAll(".work-card").forEach((card) => {
      applyEfficiencyControlsToCard(card, forSubmit);
      applyBookingExtraControlsToCard(card, forSubmit);
    });
  }

  function getDuplicateWorkKeysLocal(works) {
    const seen = new Map();
    const duplicates = [];
    (works || []).forEach((w, idx) => {
      const key = [
        String(w.machine || "").trim().toLowerCase(),
        String(w.department || "").trim().toLowerCase(),
        String(w.subWork || "").trim().toLowerCase(),
        String(w.type || "Normal").trim().toLowerCase(),
        String(w.description || "").trim().toLowerCase(),
        String(w.rootArea || "").trim().toLowerCase()
      ].join("|");

      if (!String(w.machine || "").trim() && !String(w.department || "").trim() && !String(w.subWork || "").trim()) return;
      if (seen.has(key)) duplicates.push({ first: seen.get(key) + 1, second: idx + 1 });
      else seen.set(key, idx);
    });
    return duplicates;
  }

  function validateBookingExtraForWork(work, workIndex) {
    const errs = [];
    const warnings = [];
    if (!Array.isArray(work.workCheckpoints) || work.workCheckpoints.length === 0) return { errs, warnings };

    work.workCheckpoints.forEach((bp) => {
      const point = String(bp.name || bp.point || "Booking Point").trim();
      const extra = Number(bp.extraMinutes || 0);
      const reason = String(bp.overbookingReason || bp.extraReason || bp.reason || "").trim();

      if (extra <= 0) return;

      if (!isBookingExtraReasonEnabled()) return;

      if (!reason) {
        errs.push(`Work ${workIndex}: ${point} has ${extra} min extra booking. Reason is required.`);
      } else {
        warnings.push(`Work ${workIndex}: ${point} has ${extra} min extra booking; reason will be saved in DB`);
      }
    });

    return { errs, warnings };
  }

  function validateEntryPayloadWithAdminControls(payload) {
    const errs = [];
    const warnings = [];
    const pct = getOverrunLimitPct();
    const overrunEnabled = isOverrunReasonEnabled();

    if (!payload.workDate) errs.push("Work Date is required");
    if (!payload.shiftId) errs.push("Shift is required");
    if (!payload.teamMemberId) errs.push("Team Member is required");

    try {
      // eslint-disable-next-line no-undef
      const sh = (shifts || []).find(s => String(s.id ?? s.name) === String(payload.shiftId));
      if (sh?.flexible === true && (!payload.flexibleShiftMinutes || Number(payload.flexibleShiftMinutes) <= 0)) {
        errs.push("Flexible Shift Minutes is required for flexible shift");
      }
    } catch (err) {
      // app.js/backend still protect shift logic
    }

    if (!payload.works || payload.works.length === 0) errs.push("Add at least 1 work entry");

    (payload.works || []).forEach((w, idx) => {
      const i = idx + 1;
      if (!w.machine) errs.push(`Work ${i}: Machine is required`);
      if (!w.department) errs.push(`Work ${i}: Department is required`);
      if (!w.subWork) errs.push(`Work ${i}: Sub Work is required`);
      if (!w.actualTime || Number(w.actualTime) <= 0) errs.push(`Work ${i}: Actual Time must be > 0`);

      const type = String(w.type || "Normal").toLowerCase();
      const standard = Number(w.standardTime || 0);
      const actual = Number(w.actualTime || 0);
      const reason = String(w.efficiencyReason || "").trim();
      const overLimit = type === "normal" && standard > 0 && actual > standard * (pct / 100);

      if (overrunEnabled && overLimit && !reason) {
        errs.push(`Work ${i}: Reason for low efficiency is required because Actual Time is more than ${pct}% of Standard Time`);
      }

      if ((type === "other" || type === "rework") && !String(w.description || "").trim()) {
        errs.push(`Work ${i}: Description required for Other/Rework`);
      }
      if (type === "rework" && !String(w.rootArea || "").trim()) {
        errs.push(`Work ${i}: Root Area is required for Rework`);
      }

      const bookingCheck = validateBookingExtraForWork(w, i);
      errs.push(...bookingCheck.errs);
      warnings.push(...bookingCheck.warnings);
    });

    if (overrunEnabled) {
      (payload.works || []).forEach((w, idx) => {
        const type = String(w.type || "Normal").toLowerCase();
        const overLimit = type === "normal" && Number(w.standardTime || 0) > 0 && Number(w.actualTime || 0) > Number(w.standardTime || 0) * (pct / 100);
        if (overLimit) warnings.push(`Work ${idx + 1}: Actual Time is more than ${pct}% of Standard Time; reason will be saved in DB`);
      });
    }

    getDuplicateWorkKeysLocal(payload.works).forEach(d => {
      warnings.push(`Duplicate-looking entry: Work ${d.second} looks same as Work ${d.first}`);
    });

    if (payload.summary?.shiftAvailable > 0 && payload.summary?.utilized > payload.summary?.shiftAvailable) {
      warnings.push(`Utilized time (${payload.summary.utilized} min) is more than shift available time (${payload.summary.shiftAvailable} min)`);
    }

    return { errs, warnings };
  }

  function focusBookingExtraReason() {
    if (!isBookingExtraReasonEnabled()) return false;

    for (const row of Array.from(document.querySelectorAll(".booking-point-row"))) {
      const check = row.querySelector(".bpCheck");
      const book = row.querySelector(".bpBookTime");
      const reasonBox = row.querySelector(".bpOverReasonBox");
      const reasonInput = row.querySelector(".bpOverReason");
      if (!check?.checked || !book || !reasonInput) continue;

      const max = Number(book.dataset.max || check.dataset.remaining || check.dataset.time || 0);
      const val = Number(book.value || 0);
      const extra = Math.max(0, val - max);
      if (extra > 0 && !reasonInput.value.trim()) {
        if (reasonBox) reasonBox.style.display = "block";
        row.classList.add("entry-error");
        reasonInput.focus();
        reasonInput.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      }
    }

    return false;
  }

  function focusFirstEntryErrorWithAdminControls() {
    const pct = getOverrunLimitPct();

    if (focusBookingExtraReason()) return true;

    if (isOverrunReasonEnabled()) {
      for (const card of Array.from(document.querySelectorAll(".work-card"))) {
        const std = Number(card.querySelector(".standardTime")?.value || 0);
        const act = Number(card.querySelector(".actualTime")?.value || 0);
        const type = card.querySelector(".typeSelect")?.value || "Normal";
        const reasonField = card.querySelector(".efficiencyReasonField");
        const reasonInput = card.querySelector(".efficiencyReasonInput");
        if (type === "Normal" && std > 0 && act > std * (pct / 100) && reasonInput && !reasonInput.value.trim()) {
          if (reasonField) reasonField.style.display = "flex";
          reasonInput.focus();
          reasonInput.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
      }
    }

    const firstInvalid = document.querySelector(".entry-error input, .entry-error select, .work-card input:invalid, .work-card select:invalid");
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    return false;
  }

  function patchEntryValidationFunctions() {
    try { validateEntryPayload = validateEntryPayloadWithAdminControls; } catch (err) { window.validateEntryPayload = validateEntryPayloadWithAdminControls; }
    try { focusFirstEntryError = focusFirstEntryErrorWithAdminControls; } catch (err) { window.focusFirstEntryError = focusFirstEntryErrorWithAdminControls; }
  }

  function beforeSubmitPatch() {
    patchEntryValidationFunctions();
    applyEntryControlsToScreen(true);
  }

  function initSubmitGuard() {
    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn && !submitBtn.__spwtControlsSubmitGuard) {
      submitBtn.__spwtControlsSubmitGuard = true;
      submitBtn.addEventListener("click", beforeSubmitPatch, true);
    }
  }

  function startWorkContainerObserver() {
    if (observerStarted) return;
    const host = document.getElementById("workContainer");
    if (!host) return;

    observerStarted = true;
    const observer = new MutationObserver(() => scheduleEntryControlApply());
    observer.observe(host, { childList: true, subtree: true });
  }

  async function init() {
    ensureAdminControlsTab();
    await loadAdminControls(false);
    patchSwitchAdminTab();
    patchEntryValidationFunctions();
    wireControlsButton();
    initSubmitGuard();
    startWorkContainerObserver();
    scheduleEntryControlApply();

    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabControls"]')) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(showControlsTabDirectly, 0);
      }
      setTimeout(wireControlsButton, 0);
      setTimeout(initSubmitGuard, 0);
      setTimeout(patchEntryValidationFunctions, 0);
      scheduleEntryControlApply();
    }, true);

    document.addEventListener("input", () => scheduleEntryControlApply(), false);
    document.addEventListener("change", () => scheduleEntryControlApply(), false);
  }

  window.SPWT_ADMIN_CONTROLS = adminControls;
  window.SPWT_LOAD_ADMIN_CONTROLS = loadAdminControls;
  window.SPWT_RENDER_ADMIN_CONTROLS = renderAdminControls;
  window.SPWT_APPLY_ENTRY_CONTROLS = applyEntryControlsToScreen;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
