(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const WEBAPP_URL = CONFIG.SHEETS_WEBAPP_URL || "";
  const SECRET = CONFIG.SECRET || "DIGAMBAR";

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
      renderDashboard(samplePayload());
      showOfflineNotice(err);
    }
  }

  function wireEvents() {
    $("refreshPeopleBtn")?.addEventListener("click", async function () {
      showLoading();

      try {
        const payload = await fetchPeopleDashboard();
        renderDashboard(payload);
      } catch (err) {
        console.error(err);
        renderDashboard(samplePayload());
        showOfflineNotice(err);
      }
    });
  }

  async function fetchPeopleDashboard() {
    if (!WEBAPP_URL) {
      throw new Error("Missing SHEETS_WEBAPP_URL in renderer/config.js");
    }

    const body = {
      secret: SECRET,
      action: "getPeopleDashboard",
      period: $("periodFilter")?.value || "today",
      shift: $("shiftFilter")?.value || "All",
      department: $("departmentFilter")?.value || "All",
      employee: $("employeeFilter")?.value || "All",
      year: new Date().getFullYear()
    };

    const res = await fetch(WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!data || data.ok === false) {
      throw new Error(data && data.error ? data.error : "People Dashboard API failed");
    }

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
      return `
        <div class="kpi-card" style="--accent:${x[3]};">
          <div class="kpi-label">${escapeHtml(x[0])}</div>
          <div class="kpi-value">${escapeHtml(x[1])}</div>
          <div class="kpi-note">${escapeHtml(x[2])}</div>
        </div>
      `;
    }).join(""));
  }

  function renderRecognition(data) {
    const topYesterday = data.topYesterday || null;
    const monthTop = Array.isArray(data.topMonth) ? data.topMonth.slice(0, 3) : [];

    const cards = [];

    cards.push(winnerCard({
      icon: "🏆",
      label: "Top Performer Yesterday",
      name: topYesterday?.name || "No data",
      meta: topYesterday ? personMeta(topYesterday) : "No performance entry found for yesterday.",
      badges: topYesterday ? badgeList(topYesterday) : [],
      type: "gold"
    }));

    const icons = ["🥇", "🥈", "🥉"];
    const labels = ["Top Performer Month", "2nd Performer Month", "3rd Performer Month"];
    const types = ["gold", "silver", "bronze"];

    for (let i = 0; i < 3; i++) {
      const p = monthTop[i];
      cards.push(winnerCard({
        icon: icons[i],
        label: labels[i],
        name: p?.name || "No data",
        meta: p ? personMeta(p) : "No month-to-date performance data found.",
        badges: p ? badgeList(p) : [],
        type: types[i]
      }));
    }

    setHtml("recognitionGrid", cards.join(""));
  }

  function winnerCard(item) {
    return `
      <div class="winner-card ${escapeHtml(item.type || "")}">
        <div class="winner-icon">${escapeHtml(item.icon || "")}</div>
        <div class="winner-label">${escapeHtml(item.label || "")}</div>
        <div class="winner-name">${escapeHtml(item.name || "No data")}</div>
        <div class="winner-meta">${escapeHtml(item.meta || "")}</div>
        <div class="badge-row">
          ${(item.badges || []).map(function (b) {
            return `<span class="badge ${b.type === "month" ? "month" : ""}">${escapeHtml(b.text)}</span>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderAbsentLists(data) {
    const yList = data.yesterdayAbsent || [];
    const mList = data.monthAbsent || [];

    setText("yesterdayAbsentCount", `${yList.length} Absent`);

    setHtml("yesterdayAbsentList", yList.length ? yList.map(function (a) {
      return absentRow(a.name, `${a.department || "-"} • ${a.shift || "-"}`, "1 Day");
    }).join("") : emptyAbsent("No absent employees found for yesterday."));

    setHtml("monthAbsentList", mList.length ? mList.map(function (a) {
      return absentRow(
        a.name,
        `${a.department || "-"} • Month-to-date absence`,
        `${Number(a.days || 0)} Day${Number(a.days || 0) === 1 ? "" : "s"}`,
        Number(a.days || 0) <= 1
      );
    }).join("") : emptyAbsent("No month-to-date absence found."));
  }

  function absentRow(name, meta, days, warning) {
    return `
      <div class="absent-row">
        <div>
          <div class="absent-name">${escapeHtml(name || "-")}</div>
          <div class="absent-meta">${escapeHtml(meta || "-")}</div>
        </div>
        <div class="absent-days ${warning ? "warning" : ""}">${escapeHtml(days || "-")}</div>
      </div>
    `;
  }

  function emptyAbsent(text) {
    return `<div class="absent-row empty"><div><div class="absent-name">${escapeHtml(text)}</div></div><div class="absent-days warning">0</div></div>`;
  }

  function renderEmployees(employees) {
    employees = Array.isArray(employees) ? employees : [];

    if (!employees.length) {
      setHtml("employeePerformanceGrid", `<div class="emp-card empty">No employee performance data found.</div>`);
      return;
    }

    setHtml("employeePerformanceGrid", employees.map(function (p, idx) {
      return `
        <div class="emp-card">
          <div class="emp-head">
            <div style="display:flex; gap:12px;">
              <div class="rank">${idx + 1}</div>
              <div>
                <div class="emp-name">${escapeHtml(p.name || "-")}</div>
                <div class="emp-dept">${escapeHtml(p.department || "-")}</div>
              </div>
            </div>
            <div class="score-pill">Score ${escapeHtml(round(p.score || 0))}</div>
          </div>

          <div class="emp-metrics">
            ${miniMetric("Yesterday", fmtPct(p.yesterdayProductivityPct))}
            ${miniMetric("Month", fmtPct(p.monthProductivityPct))}
            ${miniMetric("OT Hrs", fmtHours(p.overtimeHours))}
            ${miniMetric("Absent", Number(p.absentDays || 0))}
            ${miniMetric("Normal Prod", fmtPct(p.normalProductivityPct))}
            ${miniMetric("OT Prod", fmtPct(p.overtimeProductivityPct))}
            ${miniMetric("Efficiency", fmtPct(p.efficiencyPct))}
            ${miniMetric("Rework", fmtHours(p.reworkHours))}
            ${miniMetric("Other", fmtHours(p.otherWorkHours))}
          </div>
        </div>
      `;
    }).join(""));
  }

  function miniMetric(label, value) {
    return `
      <div class="mini-metric">
        <div class="mini-label">${escapeHtml(label)}</div>
        <div class="mini-value">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function renderDepartments(departments) {
    departments = Array.isArray(departments) ? departments : [];

    if (!departments.length) {
      setHtml("departmentPerformanceGrid", `<div class="dept-card empty">No department data found.</div>`);
      return;
    }

    const colors = [COLORS.green, COLORS.blue, COLORS.orange, COLORS.red, COLORS.cyan, COLORS.purple];

    setHtml("departmentPerformanceGrid", departments.map(function (d, i) {
      const pct = clamp(Number(d.productivityPct || 0), 0, 150);
      const barPct = clamp(pct, 0, 100);
      const color = colors[i % colors.length];

      return `
        <div class="dept-card" style="--accent:${color}; --pct:${barPct}%;">
          <div class="dept-name">${escapeHtml(d.department || "-")}</div>
          <div class="dept-meta">
            ${escapeHtml(Number(d.people || 0))} people • ${escapeHtml(fmtPct(pct))} productivity • ${escapeHtml(d.status || "Review")}
          </div>
          <div class="progress-track"><div class="progress-fill"></div></div>
        </div>
      `;
    }).join(""));
  }

  function renderInsights(insights) {
    insights = Array.isArray(insights) ? insights : [];

    if (!insights.length) {
      insights = [
        { icon: "ℹ️", title: "No Insights Yet", text: "Insights will appear after enough production and attendance data is available." }
      ];
    }

    setHtml("peopleInsightsGrid", insights.map(function (x) {
      return `
        <div class="insight-card">
          <div class="insight-icon">${escapeHtml(x.icon || "ℹ️")}</div>
          <div class="insight-title">${escapeHtml(x.title || "-")}</div>
          <div class="insight-text">${escapeHtml(x.text || "-")}</div>
        </div>
      `;
    }).join(""));
  }

  function normalizePayload(data) {
    data = data || {};
    data.kpis = data.kpis || {};
    data.filterOptions = data.filterOptions || {};
    data.topMonth = Array.isArray(data.topMonth) ? data.topMonth : [];
    data.yesterdayAbsent = Array.isArray(data.yesterdayAbsent) ? data.yesterdayAbsent : [];
    data.monthAbsent = Array.isArray(data.monthAbsent) ? data.monthAbsent : [];
    data.employees = Array.isArray(data.employees) ? data.employees : [];
    data.departments = Array.isArray(data.departments) ? data.departments : [];
    data.insights = Array.isArray(data.insights) ? data.insights : [];
    return data;
  }

  function showOfflineNotice(err) {
    renderInsights([{
      icon: "⚠️",
      title: "Backend Not Connected Yet",
      text: "Showing sample dashboard data. Reason: " + (err && err.message ? err.message : String(err))
    }]);
  }

  function samplePayload() {
    return {
      ok: true,
      filterOptions: {
        shifts: ["General", "Normal", "Overtime"],
        departments: ["Tubing", "Electrical", "Mechanical", "Welding / Fitting", "Testing / Quality"],
        employees: ["Amit Sharma", "Rahul Patil", "Suresh Yadav", "Nilesh Pawar"]
      },
      kpis: {
        presentEmployees: 22,
        absentEmployees: 3,
        availableHours: 176,
        utilizedHours: 151,
        standardOutputHours: 138,
        productivityPct: 78.4,
        utilizationPct: 85.8,
        reworkHours: 12.5,
        otherWorkHours: 8,
        lossHours: 5.5
      },
      topYesterday: {
        name: "Amit Sharma",
        department: "Tubing",
        yesterdayProductivityPct: 124,
        overtimeHours: 1.5,
        efficiencyPct: 118,
        badges: ["Yesterday Topper", "Month Top 3"]
      },
      topMonth: [
        { name: "Rahul Patil", department: "Electrical", monthProductivityPct: 116, absentDays: 0, badges: ["Month Rank 1"] },
        { name: "Suresh Yadav", department: "Mechanical", monthProductivityPct: 108, overtimeHours: 6, badges: ["Month Rank 2"] },
        { name: "Nilesh Pawar", department: "Testing / Quality", monthProductivityPct: 103, efficiencyPct: 101, badges: ["Month Rank 3"] }
      ],
      yesterdayAbsent: [
        { name: "Vijay More", department: "Welding / Fitting", shift: "General Shift" },
        { name: "Ramesh Kadam", department: "Tubing", shift: "Normal Shift" },
        { name: "Pravin Jadhav", department: "Mechanical", shift: "General Shift" }
      ],
      monthAbsent: [
        { name: "Ramesh Kadam", department: "Tubing", days: 3 },
        { name: "Nilesh Pawar", department: "Testing / Quality", days: 2 },
        { name: "Vijay More", department: "Welding / Fitting", days: 1 },
        { name: "Pravin Jadhav", department: "Mechanical", days: 1 }
      ],
      employees: [
        {
          name: "Amit Sharma",
          department: "Tubing Department",
          score: 94,
          yesterdayProductivityPct: 124,
          monthProductivityPct: 112,
          overtimeHours: 8.5,
          absentDays: 0,
          normalProductivityPct: 109,
          overtimeProductivityPct: 132,
          efficiencyPct: 118,
          reworkHours: 1.2,
          otherWorkHours: 0.5
        },
        {
          name: "Rahul Patil",
          department: "Electrical Department",
          score: 91,
          yesterdayProductivityPct: 105,
          monthProductivityPct: 116,
          overtimeHours: 12,
          absentDays: 0,
          normalProductivityPct: 111,
          overtimeProductivityPct: 121,
          efficiencyPct: 110,
          reworkHours: 0.8,
          otherWorkHours: 1
        }
      ],
      departments: [
        { department: "Tubing", people: 8, productivityPct: 82, status: "High workload" },
        { department: "Electrical", people: 5, productivityPct: 76, status: "Stable" },
        { department: "Mechanical", people: 6, productivityPct: 69, status: "Watch rework" },
        { department: "Welding / Fitting", people: 3, productivityPct: 64, status: "Support required" },
        { department: "Testing / Quality", people: 2, productivityPct: 88, status: "Good control" }
      ],
      insights: [
        { icon: "⚠️", title: "Overtime Dependency", text: "Tubing has high overtime contribution this month. Review load balancing and support manpower." },
        { icon: "📉", title: "Rework Watch", text: "Mechanical rework hours are increasing. Root area analysis is recommended." },
        { icon: "👥", title: "Manpower Gap", text: "Welding/Fitting shows capacity gap against current workload. Cross-support may be needed." },
        { icon: "🏆", title: "Recognition", text: "Amit Sharma appears as yesterday top performer and also month top performer candidate." }
      ]
    };
  }

  function personMeta(p) {
    const parts = [];

    if (p.department) parts.push(p.department);
    if (p.yesterdayProductivityPct != null) parts.push("Yesterday " + fmtPct(p.yesterdayProductivityPct));
    if (p.monthProductivityPct != null) parts.push("MTD " + fmtPct(p.monthProductivityPct));
    if (p.overtimeHours != null) parts.push("OT " + fmtHours(p.overtimeHours) + " hrs");
    if (p.efficiencyPct != null) parts.push("Efficiency " + fmtPct(p.efficiencyPct));
    if (p.absentDays != null) parts.push("Absent " + Number(p.absentDays || 0) + " days");

    return parts.join(" • ");
  }

  function badgeList(p) {
    return (p.badges || []).map(function (b) {
      const text = typeof b === "string" ? b : b.text;
      return {
        text: text || "",
        type: String(text || "").toLowerCase().includes("month") ? "month" : ""
      };
    });
  }

  function fmtPct(value) {
    const n = Number(value || 0);
    return round(n) + "%";
  }

  function fmtHours(value) {
    const n = Number(value || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function round(value) {
    const n = Number(value || 0);
    return Math.round(n * 10) / 10;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function setHtml(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();