// renderer/teamScoreExplainPatch.js
// Displays score formula and per-employee score breakdown below Individual Performance Tracker.

(function () {
  let lastRules = null;
  let lastEmployees = [];

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function n(value) {
    const x = Number(value);
    return Number.isFinite(x) ? Number(x.toFixed(1)) : 0;
  }

  function row(label, value, type) {
    const color = type === "minus" ? "#b91c1c" : "#15803d";
    return `<div class="mini-metric"><div class="mini-label">${esc(label)}</div><div class="mini-value" style="color:${color};">${esc(value)}</div></div>`;
  }

  function ensureBox() {
    const grid = document.getElementById("employeePerformanceGrid");
    if (!grid) return null;
    let box = document.getElementById("scoreCalculationBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "scoreCalculationBox";
      box.className = "emp-card";
      box.style.marginTop = "14px";
      grid.insertAdjacentElement("afterend", box);
    }
    return box;
  }

  function render() {
    const box = ensureBox();
    if (!box || !lastRules) return;

    const r = lastRules;
    const first = Array.isArray(lastEmployees) ? lastEmployees.find(e => Number(e.score || 0) > 0) : null;
    const b = first?.scoreBreakdown?.details || {};

    box.innerHTML = `
      <div class="emp-head">
        <div>
          <div class="emp-name">How Score is Calculated</div>
          <div class="emp-dept">Admin controlled formula. Score = Positive marks - Penalties, limited between ${esc(r.minScore)} and ${esc(r.maxScore)}.</div>
        </div>
      </div>
      <div class="emp-metrics">
        ${row("Productivity", `max ${n(r.productivityWeight)} marks @ ${n(r.productivityCapPct)}%`, "plus")}
        ${row("Utilization", `max ${n(r.utilizationWeight)} marks @ ${n(r.utilizationCapPct)}%`, "plus")}
        ${row("Efficiency", `max ${n(r.efficiencyWeight)} marks @ ${n(r.efficiencyCapPct)}%`, "plus")}
        ${row("Attendance", `max ${n(r.attendanceWeight)} marks @ ${n(r.attendanceCapPct)}%`, "plus")}
        ${row("Unplanned Leave", `-${n(r.unplannedAbsentPenaltyPerDay)} / day`, "minus")}
        ${row("Planned Leave", `-${n(r.plannedAbsentPenaltyPerDay)} / day`, "minus")}
        ${row("Allowed Planned", `${n(r.plannedLeaveAllowedPerYear)} days / year`, "plus")}
        ${row("Extra Planned", `-${n(r.plannedExtraPenaltyPerDay)} / day`, "minus")}
        ${row("Rework", `-${n(r.reworkPenaltyPerHour)} / hour`, "minus")}
        ${row("Other Work", `-${n(r.otherWorkPenaltyPerHour)} / hour`, "minus")}
      </div>
      ${first ? `
        <div class="small-hint" style="margin-top:10px;font-weight:900;">Top employee breakdown: ${esc(first.name)} | Score ${esc(first.score)}</div>
        <div class="emp-metrics" style="margin-top:8px;">
          ${row("+ Prod", n(b.productivity), "plus")}
          ${row("+ Util", n(b.utilization), "plus")}
          ${row("+ Eff", n(b.efficiency), "plus")}
          ${row("+ Att", n(b.attendance), "plus")}
          ${row("- Rework", n(b.reworkPenalty), "minus")}
          ${row("- Other", n(b.otherWorkPenalty), "minus")}
          ${row("- Unplanned", n(b.unplannedAbsentPenalty), "minus")}
          ${row("- Planned", n(b.plannedAbsentPenalty), "minus")}
          ${row("- Extra Planned", n(b.plannedExtraPenalty), "minus")}
        </div>
      ` : `<div class="small-hint" style="margin-top:10px;">Employee-wise breakdown will appear when performance data is available.</div>`}
    `;
  }

  function patchFetch() {
    const original = window.fetch;
    if (original.__scoreExplainPatched) return;

    const patched = async function () {
      const res = await original.apply(this, arguments);
      try {
        const url = String(arguments[0] || "");
        if (url.includes("/api/dashboard/people")) {
          const clone = res.clone();
          clone.json().then(payload => {
            if (payload?.ok && payload?.data) {
              lastRules = payload.data.scoreRules || lastRules;
              lastEmployees = payload.data.employees || [];
              setTimeout(render, 120);
            }
          }).catch(() => {});
        }
      } catch (err) {}
      return res;
    };

    patched.__scoreExplainPatched = true;
    window.fetch = patched;
  }

  patchFetch();
  document.addEventListener("DOMContentLoaded", () => setTimeout(render, 1000));
  setInterval(render, 2000);
})();
