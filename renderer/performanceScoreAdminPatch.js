// renderer/performanceScoreAdminPatch.js
// Adds admin-controlled Performance Score Rules inside Admin Controls.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;

  const FIELDS = [
    ["productivityWeight", "Productivity marks", 0, 100, 1],
    ["utilizationWeight", "Utilization marks", 0, 100, 1],
    ["efficiencyWeight", "Efficiency marks", 0, 100, 1],
    ["attendanceWeight", "Attendance marks", 0, 100, 1],
    ["productivityCapPct", "Productivity cap %", 1, 300, 1],
    ["utilizationCapPct", "Utilization cap %", 1, 300, 1],
    ["efficiencyCapPct", "Efficiency cap %", 1, 300, 1],
    ["attendanceCapPct", "Attendance cap %", 1, 100, 1],
    ["reworkPenaltyPerHour", "Rework penalty / hour", 0, 50, 0.1],
    ["otherWorkPenaltyPerHour", "Other work penalty / hour", 0, 50, 0.1],
    ["unplannedAbsentPenaltyPerDay", "Unplanned leave penalty / day", 0, 50, 0.1],
    ["plannedAbsentPenaltyPerDay", "Planned leave penalty / day", 0, 50, 0.1],
    ["plannedLeaveAllowedPerYear", "Planned leave allowed / year", 0, 366, 1],
    ["plannedExtraPenaltyPerDay", "Extra planned leave penalty / day", 0, 50, 0.1],
    ["minScore", "Minimum score", 0, 100, 1],
    ["maxScore", "Maximum score", 1, 150, 1]
  ];

  const DEFAULT_RULES = {
    productivityWeight: 45,
    utilizationWeight: 20,
    efficiencyWeight: 15,
    attendanceWeight: 20,
    productivityCapPct: 120,
    utilizationCapPct: 100,
    efficiencyCapPct: 120,
    attendanceCapPct: 100,
    reworkPenaltyPerHour: 1,
    otherWorkPenaltyPerHour: 0.3,
    unplannedAbsentPenaltyPerDay: 2,
    plannedAbsentPenaltyPerDay: 0,
    plannedLeaveAllowedPerYear: 12,
    plannedExtraPenaltyPerDay: 0.5,
    minScore: 0,
    maxScore: 100
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function numberValue(id, fallback) {
    const n = Number(document.getElementById(id)?.value);
    return Number.isFinite(n) ? n : fallback;
  }

  function getToken() {
    if (window.SPWT_ADMIN_ACCESS?.getToken) return window.SPWT_ADMIN_ACCESS.getToken() || "";
    return window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || "";
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function status(message, type = "") {
    const el = document.getElementById("scoreRulesStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = "900";
  }

  function ensureUi() {
    const controlsCard = document.querySelector("#tabControls .admin-controls-card") || document.getElementById("tabControls");
    if (!controlsCard || document.getElementById("scoreRulesBox")) return;

    const box = document.createElement("div");
    box.id = "scoreRulesBox";
    box.className = "card admin-controls-card";
    box.style.marginTop = "14px";
    box.innerHTML = `
      <div class="section-title">Performance Score Rules</div>
      <div class="small-hint">Control how score is calculated in People Dashboard. Positive marks increase score; penalties reduce score.</div>
      <div class="grid-2" style="margin-top:10px;">
        ${FIELDS.map(([id, label, min, max, step]) => `
          <div class="field">
            <label>${esc(label)}</label>
            <input id="scoreRule_${esc(id)}" class="admin-input" type="number" min="${min}" max="${max}" step="${step}" />
          </div>
        `).join("")}
      </div>
      <div class="small-hint" style="margin-top:8px;">
        Formula: Productivity + Utilization + Efficiency + Attendance - Rework - Other Work - Unplanned Leave - Planned Leave - Extra Planned Leave.
      </div>
      <div class="row admin-controls-actions">
        <button class="btn green" id="saveScoreRulesBtn" type="button">Save Score Rules</button>
        <button class="btn grey" id="resetScoreRulesBtn" type="button">Load Default</button>
        <span class="small-hint" id="scoreRulesStatus"></span>
      </div>
    `;

    controlsCard.insertAdjacentElement("afterend", box);
    document.getElementById("saveScoreRulesBtn")?.addEventListener("click", saveRules);
    document.getElementById("resetScoreRulesBtn")?.addEventListener("click", () => fillRules(DEFAULT_RULES));
    loadRules();
  }

  function fillRules(rules = {}) {
    FIELDS.forEach(([id]) => {
      const input = document.getElementById(`scoreRule_${id}`);
      if (input) input.value = String(rules[id] ?? DEFAULT_RULES[id] ?? 0);
    });
  }

  function readRules() {
    return Object.fromEntries(FIELDS.map(([id]) => [id, numberValue(`scoreRule_${id}`, DEFAULT_RULES[id])]));
  }

  async function loadRules() {
    try {
      status("Loading score rules...");
      const payload = await requestJson("/api/admin/controls", { method: "GET" });
      fillRules(payload.data?.performanceScoreRules || DEFAULT_RULES);
      status("Score rules loaded.", "success");
    } catch (err) {
      fillRules(DEFAULT_RULES);
      status("Using default score rules.", "error");
    }
  }

  async function saveRules() {
    try {
      status("Saving score rules...");
      const token = getToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers["x-spwt-admin-token"] = token;

      const current = await requestJson("/api/admin/controls", { method: "GET" }).catch(() => ({ data: {} }));
      const payload = await requestJson("/api/admin/controls", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...(current.data || {}), performanceScoreRules: readRules() })
      });

      fillRules(payload.data?.performanceScoreRules || readRules());
      status("Score rules saved.", "success");
    } catch (err) {
      status("Save failed: " + (err?.message || err), "error");
      alert("Score rules save failed: " + (err?.message || err));
    }
  }

  function wire() {
    ensureUi();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(wire, 900));
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.('[data-tab="tabControls"]')) setTimeout(wire, 300);
    setTimeout(wire, 120);
  }, true);
  setInterval(() => {
    const tab = document.getElementById("tabControls");
    if (tab && !tab.classList.contains("hidden")) wire();
  }, 1500);
})();
