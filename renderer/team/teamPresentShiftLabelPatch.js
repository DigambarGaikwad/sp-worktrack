// renderer/team/teamPresentShiftLabelPatch.js
// Re-labels present drilldown from hardcoded General Shift to actual fixed shift from API.
(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3032";
  const $ = (id) => document.getElementById(id);
  let latest = null;

  function clean(v) { return String(v ?? "").trim(); }
  function personKey(v) { return clean(v).replace(/^✅\s*/, "").toLowerCase(); }
  function apiParams() {
    return new URLSearchParams({
      period: $("periodFilter")?.value || "yesterday",
      shift: $("shiftFilter")?.value || "All",
      department: $("departmentFilter")?.value || "All",
      employee: $("employeeFilter")?.value || "All",
      year: $("yearFilter")?.value || "",
      month: $("monthFilter")?.value || ""
    });
  }

  async function refresh() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/dashboard/people?${apiParams().toString()}`);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) latest = body.data || null;
    } catch (err) {
      console.warn("Present shift label refresh failed", err);
    }
  }

  function applyShiftLabels() {
    const modal = $("absentDrilldownModal");
    if (!modal?.classList.contains("show")) return;
    const title = $("absentModalTitle")?.textContent || "";
    if (!/present/i.test(title)) return;

    const subtitle = $("absentModalSubtitle");
    if (subtitle) subtitle.textContent = "Fixed shift present employees and dates";

    const rows = Array.isArray(latest?.presentList) ? latest.presentList : [];
    const byName = new Map(rows.map((p) => [personKey(p.name || p.code), p]));

    modal.querySelectorAll(".absent-modal-emp").forEach((card) => {
      const nameText = card.querySelector(".absent-modal-name")?.textContent || "";
      const p = byName.get(personKey(nameText));
      if (!p) return;
      const meta = card.querySelector(".absent-modal-meta");
      if (meta) meta.textContent = `${clean(p.department || "-")} • ${clean(p.shift || "Fixed Shift")}`;
    });
  }

  function scheduleApply() {
    setTimeout(applyShiftLabels, 80);
    setTimeout(applyShiftLabels, 250);
  }

  function wire() {
    ["periodFilter", "shiftFilter", "departmentFilter", "employeeFilter", "yearFilter", "monthFilter", "refreshPeopleBtn"].forEach((id) => {
      $(id)?.addEventListener(id === "refreshPeopleBtn" ? "click" : "change", () => setTimeout(refresh, 250));
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest(".kpi-card") || e.target.closest(".absent-date-btn")) scheduleApply();
    });
    const host = $("absentDrilldownModal") || document.body;
    new MutationObserver(scheduleApply).observe(host, { childList: true, subtree: true, characterData: true });
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();
