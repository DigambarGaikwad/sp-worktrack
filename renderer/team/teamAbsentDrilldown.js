(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";

  const $ = (id) => document.getElementById(id);
  let latestPeopleData = null;

  document.addEventListener("DOMContentLoaded", function () {
    injectAbsentDrilldownStyles();
    ensureAttendanceModal();
    wireAttendanceHooks();
    setTimeout(refreshAttendanceDrilldown, 900);
  });

  function wireAttendanceHooks() {
    ["periodFilter", "shiftFilter", "departmentFilter", "employeeFilter", "refreshPeopleBtn"].forEach(function (id) {
      $(id)?.addEventListener("change", function () { setTimeout(refreshAttendanceDrilldown, 900); });
      $(id)?.addEventListener("click", function () { if (id === "refreshPeopleBtn") setTimeout(refreshAttendanceDrilldown, 900); });
    });

    document.addEventListener("click", function (event) {
      const kpi = event.target.closest(".kpi-card");
      if (kpi) {
        const label = (kpi.querySelector(".kpi-label")?.textContent || kpi.textContent || "").trim().toLowerCase();

        if (label === "present") {
          openAttendanceModal("Selected Period Present List", latestPeopleData?.presentList || [], "present");
          return;
        }

        if (label === "planned absent") {
          openAttendanceModal("Planned Absent List", latestPeopleData?.plannedAbsent || [], "absent", "Planned absent employees and dates");
          return;
        }

        if (label === "unplanned absent") {
          openAttendanceModal("Unplanned Absent List", latestPeopleData?.unplannedAbsent || [], "absent", "Unplanned absent employees and dates");
          return;
        }

        if (label === "absent % range") {
          openAttendanceModal("Selected Range Absent Summary", latestPeopleData?.monthAbsent || latestPeopleData?.yesterdayAbsent || [], "absent", "All absent employees in selected range");
          return;
        }

        if (label === "absent") {
          openAttendanceModal("Selected Period Absent List", getFilteredSelectedAbsent(), "absent", "All absent employees in selected period");
          return;
        }
      }

      const btn = event.target.closest(".absent-date-btn");
      if (btn) {
        const source = btn.dataset.source || "selected";
        const index = Number(btn.dataset.index || 0);
        const list = source === "month" ? latestPeopleData?.monthAbsent || [] : getFilteredSelectedAbsent();
        const item = list[index];
        if (item) openAttendanceModal(`${item.name || "Employee"} - ${source === "present" ? "Present" : "Absent"} Dates`, [item], source === "present" ? "present" : "absent");
      }

      if (event.target.matches(".absent-modal-backdrop, .absent-modal-close")) closeAttendanceModal();
    });
  }

  async function refreshAttendanceDrilldown() {
    try {
      const params = new URLSearchParams({
        period: $("periodFilter")?.value || "yesterday",
        shift: $("shiftFilter")?.value || "All",
        department: $("departmentFilter")?.value || "All",
        employee: $("employeeFilter")?.value || "All",
        year: $("yearFilter")?.value || "",
        month: $("monthFilter")?.value || ""
      });

      const res = await fetch(`${API_BASE_URL}/api/dashboard/people?${params.toString()}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) return;

      latestPeopleData = payload.data || {};
      renderAttendanceDrilldown(latestPeopleData);
      makeKpiCardsClickable();
    } catch (err) {
      console.error("Attendance drilldown refresh failed:", err);
    }
  }

  function renderAttendanceDrilldown(data) {
    renderSelectedPeriodAbsent(data.yesterdayAbsent || []);
    renderMonthAbsent(data.monthAbsent || []);
  }

  function makeKpiCardsClickable() {
    document.querySelectorAll(".kpi-card").forEach(function (card) {
      const label = (card.querySelector(".kpi-label")?.textContent || "").trim().toLowerCase();
      const clickableLabels = ["present", "absent", "planned absent", "unplanned absent", "absent % range"];
      if (clickableLabels.includes(label)) {
        card.classList.add("attendance-kpi-clickable");
        if (label === "present") card.title = "Click to view present list";
        else if (label === "planned absent") card.title = "Click to view planned absent list";
        else if (label === "unplanned absent") card.title = "Click to view unplanned absent list";
        else card.title = "Click to view absent list";
      }
    });
  }

  function getFilteredSelectedAbsent() {
    const list = latestPeopleData?.yesterdayAbsent || [];
    const dept = $("selectedAbsentDeptFilter")?.value || "All";
    const date = $("selectedAbsentDateFilter")?.value || "All";
    return list.filter(function (x) {
      const deptOk = dept === "All" || (x.department || "-") === dept;
      const dates = Array.isArray(x.absentDates) ? x.absentDates : [];
      const dateOk = date === "All" || dates.includes(date);
      return deptOk && dateOk;
    });
  }

  function renderSelectedPeriodAbsent(list) {
    const host = $("yesterdayAbsentList");
    const count = $("yesterdayAbsentCount");
    if (!host) return;

    const departments = unique(list.map((x) => x.department || "-").filter(Boolean));
    const dates = unique(list.flatMap((x) => Array.isArray(x.absentDates) ? x.absentDates : [])).sort();
    const currentDept = $("selectedAbsentDeptFilter")?.value || "All";
    const currentDate = $("selectedAbsentDateFilter")?.value || "All";
    const activeDept = departments.includes(currentDept) ? currentDept : "All";
    const activeDate = dates.includes(currentDate) ? currentDate : "All";

    const filtered = list.filter(function (x) {
      const deptOk = activeDept === "All" || (x.department || "-") === activeDept;
      const absentDates = Array.isArray(x.absentDates) ? x.absentDates : [];
      const dateOk = activeDate === "All" || absentDates.includes(activeDate);
      return deptOk && dateOk;
    });

    if (count) {
      count.textContent = `${filtered.length} Absent`;
      count.classList.add("clickable-absent-count", "graphic-click");
      count.title = "Click to view absent list";
      count.onclick = function () { openAttendanceModal("Selected Period Absent List", filtered, "absent", "All absent employees in selected period"); };
    }

    host.innerHTML = `
      <div class="absent-mini-filter-row two-filters">
        <select id="selectedAbsentDateFilter" class="absent-mini-filter">
          <option value="All">Date: All</option>
          ${dates.map((d) => `<option value="${escapeHtml(d)}" ${d === activeDate ? "selected" : ""}>${escapeHtml(formatDate(d))}</option>`).join("")}
        </select>
        <select id="selectedAbsentDeptFilter" class="absent-mini-filter">
          <option value="All">Department: All</option>
          ${departments.map((d) => `<option value="${escapeHtml(d)}" ${d === activeDept ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}
        </select>
        <button class="absent-mini-btn graphic-click" id="openSelectedAbsentBtn">👥 View</button>
      </div>
      ${filtered.length ? filtered.map((a, i) => absentRow(a, i, "selected", `${Number(a.days || 1)} Day${Number(a.days || 1) === 1 ? "" : "s"}`, "absent")).join("") : emptyAbsent("No absent employees found for selected period.")}
    `;

    $("selectedAbsentDeptFilter")?.addEventListener("change", function () { renderSelectedPeriodAbsent(list); });
    $("selectedAbsentDateFilter")?.addEventListener("change", function () { renderSelectedPeriodAbsent(list); });
    $("openSelectedAbsentBtn")?.addEventListener("click", function () { openAttendanceModal("Selected Period Absent List", filtered, "absent", "All absent employees in selected period"); });
  }

  function renderMonthAbsent(list) {
    const host = $("monthAbsentList");
    if (!host) return;
    host.innerHTML = list.length ? list.map((a, i) => absentRow(a, i, "month", `${Number(a.days || 0)} Day${Number(a.days || 0) === 1 ? "" : "s"}`, "absent")).join("") : emptyAbsent("No month-to-date absence found.");
  }

  function absentRow(a, index, source, label, mode) {
    const days = Number(a.days || (Array.isArray(a.absentDates) ? a.absentDates.length : 0) || 0);
    const metaText = source === "month" ? `${a.department || "-"} • Month-to-date absence` : `${a.department || "-"}`;
    return `<div class="absent-row absent-row-clickable"><div><div class="absent-name">${escapeHtml(a.name || "-")}</div><div class="absent-meta">${escapeHtml(metaText)}</div></div><button class="absent-days absent-date-btn graphic-click ${days <= 1 ? "warning" : ""}" data-source="${escapeHtml(source)}" data-index="${index}" title="Click to view dates">${mode === "present" ? "✅" : "📅"} ${escapeHtml(label)}</button></div>`;
  }

  function emptyAbsent(text) { return `<div class="absent-row empty"><div><div class="absent-name">${escapeHtml(text)}</div></div><div class="absent-days warning">0</div></div>`; }

  function openAttendanceModal(title, list, mode, subtitle) {
    ensureAttendanceModal();
    const modal = $("absentDrilldownModal");
    const titleEl = $("absentModalTitle");
    const subtitleEl = $("absentModalSubtitle");
    const body = $("absentModalBody");
    if (!modal || !body) return;

    const isPresent = mode === "present";
    titleEl.textContent = title || (isPresent ? "Present Details" : "Absent Details");
    subtitleEl.textContent = subtitle || (isPresent ? "General shift present employees and dates" : "General shift absent employees and dates");
    modal.classList.toggle("present-mode", isPresent);

    const rows = Array.isArray(list) ? list : [];
    body.innerHTML = rows.length ? rows.map((item) => {
      const dates = isPresent ? (Array.isArray(item.presentDates) ? item.presentDates : []) : (Array.isArray(item.absentDates) ? item.absentDates : []);
      const dayCount = dates.length || Number(item.days || 0);
      return `<div class="absent-modal-emp ${isPresent ? "present" : ""}"><div class="absent-modal-emp-head"><div><div class="absent-modal-name">${isPresent ? "✅" : "📅"} ${escapeHtml(item.name || "-")}</div><div class="absent-modal-meta">${escapeHtml(item.department || "-")} • General Shift</div></div><div class="absent-modal-pill">${dayCount} Day${dayCount === 1 ? "" : "s"}</div></div><div class="absent-date-chip-wrap">${dates.length ? dates.map((d) => `<span class="absent-date-chip ${isPresent ? "present" : ""}">${escapeHtml(formatDate(d))}</span>`).join("") : `<span class="absent-date-chip muted">No date detail available</span>`}</div></div>`;
    }).join("") : `<div class="absent-modal-empty">No ${isPresent ? "present" : "absent"} data found.</div>`;
    modal.classList.add("show");
  }

  function closeAttendanceModal() { $("absentDrilldownModal")?.classList.remove("show"); }

  function ensureAttendanceModal() {
    if ($("absentDrilldownModal")) return;
    const div = document.createElement("div");
    div.id = "absentDrilldownModal";
    div.className = "absent-modal-backdrop";
    div.innerHTML = `<div class="absent-modal-card"><div class="absent-modal-head"><div><div class="absent-modal-title" id="absentModalTitle">Attendance Details</div><div class="absent-modal-subtitle" id="absentModalSubtitle">General shift attendance dates</div></div><button class="absent-modal-close graphic-click">✕ Close</button></div><div class="absent-modal-body" id="absentModalBody"></div></div>`;
    document.body.appendChild(div);
  }

  function injectAbsentDrilldownStyles() {
    if ($("absentDrilldownStyles")) return;
    const style = document.createElement("style");
    style.id = "absentDrilldownStyles";
    style.textContent = `
      .graphic-click, .people-btn, .kpi-card, .absent-days, .score-pill { transition: transform .16s ease, box-shadow .16s ease, filter .16s ease; }
      .graphic-click:hover, .people-btn:hover, .attendance-kpi-clickable:hover { transform: translateY(-2px); filter: brightness(1.02); }
      .graphic-click:active, .people-btn:active, .attendance-kpi-clickable:active { transform: translateY(1px) scale(.98); filter: brightness(.96); }
      .attendance-kpi-clickable { cursor:pointer; position:relative; overflow:hidden; }
      .attendance-kpi-clickable::after { content:'↗'; position:absolute; top:14px; right:18px; opacity:.28; font-size:18px; font-weight:1000; }
      .clickable-absent-count { cursor:pointer; user-select:none; }
      .clickable-absent-count:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(239, 68, 68, .18); }
      .absent-mini-filter-row { display:flex; gap:10px; margin-bottom:12px; align-items:center; }
      .absent-mini-filter-row.two-filters { display:grid; grid-template-columns: 1fr 1fr auto; }
      .absent-mini-filter { height:38px; border:1px solid #dbe4f0; border-radius:14px; padding:0 12px; font-weight:800; color:#334155; background:#fff; min-width:0; }
      .absent-mini-btn { height:38px; border:0; border-radius:14px; padding:0 16px; font-weight:900; color:#991b1b; background:linear-gradient(135deg,#fee2e2,#fff7ed); cursor:pointer; box-shadow:0 8px 18px rgba(239,68,68,.12); }
      .absent-row-clickable .absent-days { border:0; cursor:pointer; box-shadow:0 6px 16px rgba(239,68,68,.10); }
      .absent-row-clickable .absent-days:hover { transform: scale(1.04); box-shadow:0 10px 22px rgba(239,68,68,.18); }
      .absent-row-clickable .absent-days:active { transform: scale(.97); }
      .absent-modal-backdrop { position:fixed; inset:0; z-index:9999; background:rgba(15,23,42,.55); display:none; align-items:center; justify-content:center; padding:24px; backdrop-filter: blur(3px); }
      .absent-modal-backdrop.show { display:flex; }
      .absent-modal-card { width:min(820px, 94vw); max-height:84vh; overflow:hidden; background:#fff; border-radius:28px; box-shadow:0 28px 80px rgba(15,23,42,.35); border:1px solid #e2e8f0; animation: attendancePop .18s ease-out; }
      @keyframes attendancePop { from { opacity:0; transform: translateY(16px) scale(.98); } to { opacity:1; transform: translateY(0) scale(1); } }
      .absent-modal-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:22px 24px; border-bottom:1px solid #e2e8f0; background:linear-gradient(135deg,#fff7ed,#f8fafc); }
      .present-mode .absent-modal-head { background:linear-gradient(135deg,#dcfce7,#f8fafc); }
      .absent-modal-title { font-size:22px; font-weight:1000; color:#0f172a; }
      .absent-modal-subtitle { font-size:13px; color:#64748b; font-weight:800; margin-top:4px; }
      .absent-modal-close { border:0; background:#0f172a; color:#fff; font-weight:900; border-radius:16px; padding:11px 18px; cursor:pointer; box-shadow:0 10px 24px rgba(15,23,42,.22); }
      .absent-modal-body { padding:20px 24px 24px; overflow:auto; max-height:68vh; }
      .absent-modal-emp { border:1px solid #e2e8f0; border-radius:20px; padding:16px; margin-bottom:14px; background:#fff; box-shadow:0 8px 20px rgba(15,23,42,.04); }
      .absent-modal-emp.present { border-color:#bbf7d0; }
      .absent-modal-emp-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .absent-modal-name { font-size:17px; font-weight:1000; color:#0f172a; }
      .absent-modal-meta { font-size:13px; color:#475569; font-weight:800; margin-top:3px; }
      .absent-modal-pill { background:#fee2e2; color:#991b1b; border-radius:999px; padding:8px 14px; font-weight:1000; white-space:nowrap; }
      .present-mode .absent-modal-pill { background:#dcfce7; color:#166534; }
      .absent-date-chip-wrap { display:flex; gap:8px; flex-wrap:wrap; }
      .absent-date-chip { background:#f1f5f9; color:#0f172a; border:1px solid #e2e8f0; border-radius:999px; padding:8px 12px; font-weight:900; }
      .absent-date-chip.present { background:#dcfce7; color:#166534; border-color:#bbf7d0; }
      .absent-date-chip.muted, .absent-modal-empty { color:#64748b; font-weight:900; }
      @media (max-width: 800px) { .absent-mini-filter-row.two-filters { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function unique(list) { return Array.from(new Set(list)); }
  function formatDate(value) { const text = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const [y, m, d] = text.split("-"); return `${d}-${m}-${y}`; }
  function escapeHtml(value) { return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
})();
