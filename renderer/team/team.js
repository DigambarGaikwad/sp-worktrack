(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const WEBAPP_URL = CONFIG.SHEETS_WEBAPP_URL || "";
  const SECRET = CONFIG.SECRET || "DIGAMBAR";
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const DATA_SOURCE = CONFIG.DATA_SOURCE || "local";

  const $ = (id) => document.getElementById(id);

  const COLORS = {
    blue: "#2563eb",
    red: "#ef4444",
    teal: "#0f766e",
    purple: "#7c3aed",
    orange: "#f59e0b",
    green: "#16a34a",
    cyan: "#0891b2",
    slate: "#64748b",
    brown: "#b45309"
  };

  document.addEventListener("DOMContentLoaded", initPeopleDashboard);

  async function initPeopleDashboard() {
    wireEvents();
    showLoading();

    try {
      const payload = await fetchPeopleDashboard();
      renderDashboard(payload);
    } catch (err) {
      console.error(err);
      renderDashboard(DATA_SOURCE === "db" ? emptyPayload() : samplePayload());
      showOfflineNotice(err);
    }
  }

  function wireEvents() {
    ["periodFilter", "shiftFilter", "departmentFilter", "employeeFilter"].forEach(function (id) {
      $(id)?.addEventListener("change", reloadPeopleDashboard);
    });

    $("refreshPeopleBtn")?.addEventListener("click", reloadPeopleDashboard);
  }

  async function reloadPeopleDashboard() {
    showLoading();

    try {
      const payload = await fetchPeopleDashboard();
      renderDashboard(payload);
    } catch (err) {
      console.error(err);
      renderDashboard(DATA_SOURCE === "db" ? emptyPayload() : samplePayload());
      showOfflineNotice(err);
    }
  }

  async function fetchPeopleDashboard() {
    if (DATA_SOURCE === "db") return fetchPeopleDashboardFromDb();
    return fetchPeopleDashboardFromSheet();
  }

  async function fetchPeopleDashboardFromDb() {
    const params = new URLSearchParams({
      period: $("periodFilter")?.value || "today",
      shift: $("shiftFilter")?.value || "All",
      department: $("departmentFilter")?.value || "All",
      employee: $("employeeFilter")?.value || "All"
    });

    const res = await fetch(`${API_BASE_URL}/api/dashboard/people?${params.toString()}`);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `People Dashboard DB API failed with status ${res.status}`);
    return payload.data || {};
  }

  async function fetchPeopleDashboardFromSheet() {
    if (!WEBAPP_URL) throw new Error("Missing SHEETS_WEBAPP_URL in renderer/config.js");
    const body = { secret: SECRET, action: "getPeopleDashboard", period: $("periodFilter")?.value || "today", shift: $("shiftFilter")?.value || "All", department: $("departmentFilter")?.value || "All", employee: $("employeeFilter")?.value || "All", year: new Date().getFullYear() };
    const res = await fetch(WEBAPP_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data || data.ok === false) throw new Error(data && data.error ? data.error : "People Dashboard API failed");
    return data;
  }

  function showLoading() {
    setHtml("peopleKpiGrid", `<div class="people-loading">Loading people dashboard...</div>`);
    setHtml("recognitionGrid", "");
    setHtml("yesterdayAbsentList", "");
    setHtml("monthAbsentList", "");
    setHtml("employeePerformanceGrid", "");
    setHtml("departmentPerformanceGrid", "");
    setHtml("peopleInsightsGrid", "");
  }

  function renderDashboard(data) {
    data = normalizePayload(data);
    populateFilters(data);
    renderKpis(data.kpis);
    renderRecognition(data);
    renderAbsentLists(data);
    renderEmployees(data.employees);
    renderDepartments(data.departments);
    renderInsights(data.insights);
  }

  function populateFilters(data) {
    populateSelect("shiftFilter", "Shift", ["All"].concat(data.filterOptions.shifts || []));
    populateSelect("departmentFilter", "Department", ["All"].concat(data.filterOptions.departments || []));
    populateSelect("employeeFilter", "Employee", ["All"].concat(data.filterOptions.employees || []));
  }

  function populateSelect(id, label, values) {
    const el = $(id);
    if (!el) return;
    const current = el.value || "All";
    const unique = Array.from(new Set((values || []).filter(Boolean)));
    el.innerHTML = unique.map(function (v) {
      const text = v === "All" ? `${label}: All` : String(v);
      return `<option value="${escapeHtml(v)}">${escapeHtml(text)}</option>`;
    }).join("");
    if (unique.includes(current)) el.value = current;
  }

  function renderKpis(kpis) {
    const items = [
      ["Present", kpis.presentEmployees, "Employees available", COLORS.blue],
      ["Absent", kpis.absentEmployees, "Current period", COLORS.red],
      ["Planned Absent", kpis.plannedAbsentEmployees, `${Number(kpis.plannedAbsentDays || 0)} day(s)`, COLORS.green],
      ["Unplanned Absent", kpis.unplannedAbsentEmployees, `${Number(kpis.unplannedAbsentDays || 0)} day(s)`, COLORS.red],
      ["Absent % Range", fmtPct(kpis.absentPctCurrentMonth), "Selected month/year", COLORS.brown],
      ["Available Hours", fmtHours(kpis.availableHours), "Net shift capacity", COLORS.teal],
      ["Utilized Hours", fmtHours(kpis.utilizedHours), "Actual booked time", COLORS.purple],
      ["Std Output Hours", fmtHours(kpis.standardOutputHours), "Productive output", COLORS.orange],
      ["Productivity", fmtPct(kpis.productivityPct), "Std / Available", COLORS.green],
      ["Utilization", fmtPct(kpis.utilizationPct), "Actual / Available", COLORS.cyan],
      ["Rework Hours", fmtHours(kpis.reworkHours), "Rework consumption", COLORS.red],
      ["Other Work", fmtHours(kpis.otherWorkHours), "Support/non-production", COLORS.slate],
      ["Loss Hours", fmtHours(kpis.lossHours), "Major loss impact", COLORS.brown]
    ];

    setHtml("peopleKpiGrid", items.map(function (x) {
      return `<div class="kpi-card" style="--accent:${x[3]};"><div class="kpi-label">${escapeHtml(x[0])}</div><div class="kpi-value">${escapeHtml(x[1])}</div><div class="kpi-note">${escapeHtml(x[2])}</div></div>`;
    }).join(""));
  }

  function renderRecognition(data) {
    const topYesterday = data.topYesterday || null;
    const monthTop = Array.isArray(data.topMonth) ? data.topMonth.slice(0, 3) : [];
    const cards = [];
    cards.push(winnerCard({ icon: "TOP", label: "Top Performer Selected Period", name: topYesterday?.name || "No data", meta: topYesterday ? personMeta(topYesterday) : "No performance entry found for selected period.", badges: topYesterday ? badgeList(topYesterday) : [], type: "gold" }));
    const icons = ["1", "2", "3"];
    const labels = ["Top Performer Month", "2nd Performer Month", "3rd Performer Month"];
    const types = ["gold", "silver", "bronze"];
    for (let i = 0; i < 3; i++) {
      const p = monthTop[i];
      cards.push(winnerCard({ icon: icons[i], label: labels[i], name: p?.name || "No data", meta: p ? personMeta(p) : "No month-to-date performance data found.", badges: p ? badgeList(p) : [], type: types[i] }));
    }
    setHtml("recognitionGrid", cards.join(""));
  }

  function winnerCard(item) {
    return `<div class="winner-card ${escapeHtml(item.type || "")}"><div class="winner-icon">${escapeHtml(item.icon || "")}</div><div class="winner-label">${escapeHtml(item.label || "")}</div><div class="winner-name">${escapeHtml(item.name || "No data")}</div><div class="winner-meta">${escapeHtml(item.meta || "")}</div><div class="badge-row">${(item.badges || []).map(function (b) { return `<span class="badge ${b.type === "month" ? "month" : ""}">${escapeHtml(b.text)}</span>`; }).join("")}</div></div>`;
  }

  function renderAbsentLists(data) {
    const yList = data.yesterdayAbsent || [];
    const mList = data.monthAbsent || [];
    const planned = data.plannedAbsent || [];
    const unplanned = data.unplannedAbsent || [];

    setText("yesterdayAbsentCount", `${yList.length} Absent`);
    setHtml("yesterdayAbsentList", yList.length ? yList.map(function (a) { return absentRow(a.name, `${a.department || "-"} | ${a.shift || "-"}`, `${Number(a.days || 1)} Day(s)`); }).join("") : emptyAbsent("No absent employees found for selected period."));

    const rangeRows = [];
    if (planned.length) {
      rangeRows.push(`<div class="small-hint" style="font-weight:900;color:#15803d;margin:8px 0 4px;">Planned Absent</div>`);
      rangeRows.push(planned.map(function (a) { return absentRow(a.name, `${a.department || "-"} | Planned`, `${Number(a.days || 0)} Day(s)`, false); }).join(""));
    }
    if (unplanned.length) {
      rangeRows.push(`<div class="small-hint" style="font-weight:900;color:#b91c1c;margin:8px 0 4px;">Unplanned Absent</div>`);
      rangeRows.push(unplanned.map(function (a) { return absentRow(a.name, `${a.department || "-"} | Unplanned`, `${Number(a.days || 0)} Day(s)`, true); }).join(""));
    }
    if (!rangeRows.length && mList.length) {
      rangeRows.push(mList.map(function (a) { return absentRow(a.name, `${a.department || "-"} | Range absence`, `${Number(a.days || 0)} Day(s)`, Number(a.days || 0) <= 1); }).join(""));
    }
    setHtml("monthAbsentList", rangeRows.length ? rangeRows.join("") : emptyAbsent("No range absence found."));
  }

  function absentRow(name, meta, days, warning) {
    return `<div class="absent-row"><div><div class="absent-name">${escapeHtml(name || "-")}</div><div class="absent-meta">${escapeHtml(meta || "-")}</div></div><div class="absent-days ${warning ? "warning" : ""}">${escapeHtml(days || "-")}</div></div>`;
  }

  function emptyAbsent(text) { return `<div class="absent-row empty"><div><div class="absent-name">${escapeHtml(text)}</div></div><div class="absent-days warning">0</div></div>`; }

  function renderEmployees(employees) {
    employees = Array.isArray(employees) ? employees : [];
    if (!employees.length) { setHtml("employeePerformanceGrid", `<div class="emp-card empty">No employee performance data found.</div>`); return; }
    setHtml("employeePerformanceGrid", employees.map(function (p, idx) {
      return `<div class="emp-card"><div class="emp-head"><div style="display:flex; gap:12px;"><div class="rank">${idx + 1}</div><div><div class="emp-name">${escapeHtml(p.name || "-")}</div><div class="emp-dept">${escapeHtml(p.department || "-")}</div></div></div><div class="score-pill">Score ${escapeHtml(round(p.score || 0))}</div></div><div class="emp-metrics">${miniMetric("Period Prod", fmtPct(p.yesterdayProductivityPct))}${miniMetric("Month", fmtPct(p.monthProductivityPct))}${miniMetric("OT Hrs", fmtHours(p.overtimeHours))}${miniMetric("Absent", Number(p.absentDays || 0))}${miniMetric("Normal Prod", fmtPct(p.normalProductivityPct))}${miniMetric("OT Prod", fmtPct(p.overtimeProductivityPct))}${miniMetric("Efficiency", fmtPct(p.efficiencyPct))}${miniMetric("Rework", fmtHours(p.reworkHours))}${miniMetric("Other", fmtHours(p.otherWorkHours))}</div></div>`;
    }).join(""));
  }

  function miniMetric(label, value) { return `<div class="mini-metric"><div class="mini-label">${escapeHtml(label)}</div><div class="mini-value">${escapeHtml(value)}</div></div>`; }

  function renderDepartments(departments) {
    departments = Array.isArray(departments) ? departments : [];
    if (!departments.length) { setHtml("departmentPerformanceGrid", `<div class="dept-card empty">No department data found.</div>`); return; }
    const colors = [COLORS.green, COLORS.blue, COLORS.orange, COLORS.red, COLORS.cyan, COLORS.purple];
    setHtml("departmentPerformanceGrid", departments.map(function (d, i) {
      const pct = clamp(Number(d.productivityPct || 0), 0, 150);
      const barPct = clamp(pct, 0, 100);
      const color = colors[i % colors.length];
      return `<div class="dept-card" style="--accent:${color}; --pct:${barPct}%;"><div class="dept-name">${escapeHtml(d.department || "-")}</div><div class="dept-meta">${escapeHtml(Number(d.people || 0))} people | ${escapeHtml(fmtPct(pct))} productivity | ${escapeHtml(d.status || "Review")}</div><div class="progress-track"><div class="progress-fill"></div></div></div>`;
    }).join(""));
  }

  function renderInsights(insights) {
    insights = Array.isArray(insights) ? insights : [];
    if (!insights.length) insights = [{ icon: "INFO", title: "No Insights Yet", text: "Insights will appear after enough production and attendance data is available." }];
    setHtml("peopleInsightsGrid", insights.map(function (x) { return `<div class="insight-card"><div class="insight-icon">${escapeHtml(x.icon || "INFO")}</div><div class="insight-title">${escapeHtml(x.title || "-")}</div><div class="insight-text">${escapeHtml(x.text || "-")}</div></div>`; }).join(""));
  }

  function normalizePayload(data) {
    data = data || {};
    data.kpis = data.kpis || {};
    data.filterOptions = data.filterOptions || {};
    data.topMonth = Array.isArray(data.topMonth) ? data.topMonth : [];
    data.yesterdayAbsent = Array.isArray(data.yesterdayAbsent) ? data.yesterdayAbsent : [];
    data.monthAbsent = Array.isArray(data.monthAbsent) ? data.monthAbsent : [];
    data.plannedAbsent = Array.isArray(data.plannedAbsent) ? data.plannedAbsent : [];
    data.unplannedAbsent = Array.isArray(data.unplannedAbsent) ? data.unplannedAbsent : [];
    data.employees = Array.isArray(data.employees) ? data.employees : [];
    data.departments = Array.isArray(data.departments) ? data.departments : [];
    data.insights = Array.isArray(data.insights) ? data.insights : [];
    return data;
  }

  function showOfflineNotice(err) {
    renderInsights([{ icon: "WARN", title: "Backend Not Connected", text: (DATA_SOURCE === "db" ? "Showing empty dashboard. " : "Showing sample dashboard data. ") + "Reason: " + (err && err.message ? err.message : String(err)) }]);
  }

  function emptyPayload() {
    return { ok: true, filterOptions: { shifts: [], departments: [], employees: [] }, kpis: { presentEmployees: 0, absentEmployees: 0, plannedAbsentEmployees: 0, unplannedAbsentEmployees: 0, plannedAbsentDays: 0, unplannedAbsentDays: 0, absentPctCurrentMonth: 0, availableHours: 0, utilizedHours: 0, standardOutputHours: 0, productivityPct: 0, utilizationPct: 0, reworkHours: 0, otherWorkHours: 0, lossHours: 0 }, topYesterday: null, topMonth: [], yesterdayAbsent: [], monthAbsent: [], plannedAbsent: [], unplannedAbsent: [], employees: [], departments: [], insights: [] };
  }

  function samplePayload() {
    return { ok: true, filterOptions: { shifts: ["General", "Normal", "Overtime"], departments: ["Tubing", "Electrical"], employees: ["Amit Sharma"] }, kpis: { presentEmployees: 22, absentEmployees: 3, plannedAbsentEmployees: 1, unplannedAbsentEmployees: 2, plannedAbsentDays: 1, unplannedAbsentDays: 2, absentPctCurrentMonth: 4.5, availableHours: 176, utilizedHours: 151, standardOutputHours: 138, productivityPct: 78.4, utilizationPct: 85.8, reworkHours: 12.5, otherWorkHours: 8, lossHours: 5.5 }, topYesterday: null, topMonth: [], yesterdayAbsent: [], monthAbsent: [], plannedAbsent: [], unplannedAbsent: [], employees: [], departments: [], insights: [] };
  }

  function personMeta(p) {
    const parts = [];
    if (p.department) parts.push(p.department);
    if (p.yesterdayProductivityPct != null) parts.push("Period " + fmtPct(p.yesterdayProductivityPct));
    if (p.monthProductivityPct != null) parts.push("MTD " + fmtPct(p.monthProductivityPct));
    if (p.overtimeHours != null) parts.push("OT " + fmtHours(p.overtimeHours) + " hrs");
    if (p.efficiencyPct != null) parts.push("Efficiency " + fmtPct(p.efficiencyPct));
    if (p.absentDays != null) parts.push("Absent " + Number(p.absentDays || 0) + " days");
    return parts.join(" | ");
  }

  function badgeList(p) { return (p.badges || []).map(function (b) { const text = typeof b === "string" ? b : b.text; return { text: text || "", type: String(text || "").toLowerCase().includes("month") ? "month" : "" }; }); }
  function fmtPct(value) { const n = Number(value || 0); return round(n) + "%"; }
  function fmtHours(value) { const n = Number(value || 0); return Number.isInteger(n) ? String(n) : n.toFixed(1); }
  function round(value) { const n = Number(value || 0); return Math.round(n * 10) / 10; }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function setHtml(id, html) { const el = $(id); if (el) el.innerHTML = html; }
  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function escapeHtml(value) { return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
})();

