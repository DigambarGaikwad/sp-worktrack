(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";

  const $ = (id) => document.getElementById(id);
  let latestPeopleData = null;

  document.addEventListener("DOMContentLoaded", function () {
    injectAbsentDrilldownStyles();
    ensureAbsentModal();
    wireAbsentRefreshHooks();

    setTimeout(refreshAbsentDrilldown, 900);
  });

  function wireAbsentRefreshHooks() {
    ["periodFilter", "shiftFilter", "departmentFilter", "employeeFilter", "refreshPeopleBtn"].forEach(function (id) {
      $(id)?.addEventListener("change", function () {
        setTimeout(refreshAbsentDrilldown, 900);
      });
      $(id)?.addEventListener("click", function () {
        if (id === "refreshPeopleBtn") setTimeout(refreshAbsentDrilldown, 900);
      });
    });

    document.addEventListener("click", function (event) {
      const kpi = event.target.closest(".kpi-card");
      if (kpi && /absent/i.test(kpi.textContent || "")) {
        openAbsentModal("Selected Period Absent List", latestPeopleData?.yesterdayAbsent || []);
        return;
      }

      const btn = event.target.closest(".absent-date-btn");
      if (btn) {
        const source = btn.dataset.source || "selected";
        const index = Number(btn.dataset.index || 0);
        const list = source === "month" ? latestPeopleData?.monthAbsent || [] : latestPeopleData?.yesterdayAbsent || [];
        const item = list[index];
        if (item) openAbsentModal(`${item.name || "Employee"} - Absent Dates`, [item]);
      }

      if (event.target.matches(".absent-modal-backdrop, .absent-modal-close")) {
        closeAbsentModal();
      }
    });
  }

  async function refreshAbsentDrilldown() {
    try {
      const params = new URLSearchParams({
        period: $("periodFilter")?.value || "yesterday",
        shift: $("shiftFilter")?.value || "All",
        department: $("departmentFilter")?.value || "All",
        employee: $("employeeFilter")?.value || "All"
      });

      const res = await fetch(`${API_BASE_URL}/api/dashboard/people?${params.toString()}`);
      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload?.ok) return;

      latestPeopleData = payload.data || {};
      renderAbsentDrilldown(latestPeopleData);
    } catch (err) {
      console.error("Absent drilldown refresh failed:", err);
    }
  }

  function renderAbsentDrilldown(data) {
    renderSelectedPeriodAbsent(data.yesterdayAbsent || []);
    renderMonthAbsent(data.monthAbsent || []);
  }

  function renderSelectedPeriodAbsent(list) {
    const host = $("yesterdayAbsentList");
    const count = $("yesterdayAbsentCount");
    if (!host) return;

    const departments = unique(list.map((x) => x.department || "-").filter(Boolean));
    const currentFilter = $("selectedAbsentDeptFilter")?.value || "All";
    const activeFilter = departments.includes(currentFilter) ? currentFilter : "All";
    const filtered = activeFilter === "All" ? list : list.filter((x) => (x.department || "-") === activeFilter);

    if (count) {
      count.textContent = `${filtered.length} Absent`;
      count.classList.add("clickable-absent-count");
      count.title = "Click to view absent list";
      count.onclick = function () {
        openAbsentModal("Selected Period Absent List", filtered);
      };
    }

    host.innerHTML = `
      <div class="absent-mini-filter-row">
        <select id="selectedAbsentDeptFilter" class="absent-mini-filter">
          <option value="All">Department: All</option>
          ${departments.map((d) => `<option value="${escapeHtml(d)}" ${d === activeFilter ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}
        </select>
        <button class="absent-mini-btn" id="openSelectedAbsentBtn">View All</button>
      </div>
      ${filtered.length ? filtered.map((a, i) => absentRow(a, i, "selected", "1 Day")).join("") : emptyAbsent("No absent employees found for selected period.")}
    `;

    $("selectedAbsentDeptFilter")?.addEventListener("change", function () {
      renderSelectedPeriodAbsent(list);
    });
    $("openSelectedAbsentBtn")?.addEventListener("click", function () {
      openAbsentModal("Selected Period Absent List", filtered);
    });
  }

  function renderMonthAbsent(list) {
    const host = $("monthAbsentList");
    if (!host) return;

    host.innerHTML = list.length
      ? list.map((a, i) => absentRow(a, i, "month", `${Number(a.days || 0)} Day${Number(a.days || 0) === 1 ? "" : "s"}`)).join("")
      : emptyAbsent("No month-to-date absence found.");
  }

  function absentRow(a, index, source, label) {
    const days = Number(a.days || (Array.isArray(a.absentDates) ? a.absentDates.length : 0) || 0);
    return `
      <div class="absent-row absent-row-clickable">
        <div>
          <div class="absent-name">${escapeHtml(a.name || "-")}</div>
          <div class="absent-meta">${escapeHtml(a.department || "-")} • ${escapeHtml(a.shift || "Month-to-date absence")}</div>
        </div>
        <button class="absent-days absent-date-btn ${days <= 1 ? "warning" : ""}" data-source="${escapeHtml(source)}" data-index="${index}" title="Click to view absent dates">
          ${escapeHtml(label)}
        </button>
      </div>
    `;
  }

  function emptyAbsent(text) {
    return `<div class="absent-row empty"><div><div class="absent-name">${escapeHtml(text)}</div></div><div class="absent-days warning">0</div></div>`;
  }

  function openAbsentModal(title, list) {
    ensureAbsentModal();

    const modal = $("absentDrilldownModal");
    const titleEl = $("absentModalTitle");
    const body = $("absentModalBody");

    if (!modal || !body) return;

    titleEl.textContent = title || "Absent Details";

    const rows = Array.isArray(list) ? list : [];
    body.innerHTML = rows.length ? rows.map((item) => {
      const dates = Array.isArray(item.absentDates) ? item.absentDates : [];
      return `
        <div class="absent-modal-emp">
          <div class="absent-modal-emp-head">
            <div>
              <div class="absent-modal-name">${escapeHtml(item.name || "-")}</div>
              <div class="absent-modal-meta">${escapeHtml(item.department || "-")} • ${escapeHtml(item.shift || "-")}</div>
            </div>
            <div class="absent-modal-pill">${dates.length || Number(item.days || 0)} Day${(dates.length || Number(item.days || 0)) === 1 ? "" : "s"}</div>
          </div>
          <div class="absent-date-chip-wrap">
            ${dates.length ? dates.map((d) => `<span class="absent-date-chip">${escapeHtml(formatDate(d))}</span>`).join("") : `<span class="absent-date-chip muted">No date detail available</span>`}
          </div>
        </div>
      `;
    }).join("") : `<div class="absent-modal-empty">No absent data found.</div>`;

    modal.classList.add("show");
  }

  function closeAbsentModal() {
    $("absentDrilldownModal")?.classList.remove("show");
  }

  function ensureAbsentModal() {
    if ($("absentDrilldownModal")) return;

    const div = document.createElement("div");
    div.id = "absentDrilldownModal";
    div.className = "absent-modal-backdrop";
    div.innerHTML = `
      <div class="absent-modal-card">
        <div class="absent-modal-head">
          <div>
            <div class="absent-modal-title" id="absentModalTitle">Absent Details</div>
            <div class="absent-modal-subtitle">Click Close after reviewing absent dates</div>
          </div>
          <button class="absent-modal-close">Close</button>
        </div>
        <div class="absent-modal-body" id="absentModalBody"></div>
      </div>
    `;

    document.body.appendChild(div);
  }

  function injectAbsentDrilldownStyles() {
    if ($("absentDrilldownStyles")) return;

    const style = document.createElement("style");
    style.id = "absentDrilldownStyles";
    style.textContent = `
      .clickable-absent-count { cursor:pointer; user-select:none; }
      .clickable-absent-count:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(239, 68, 68, .18); }
      .absent-mini-filter-row { display:flex; gap:10px; margin-bottom:12px; align-items:center; }
      .absent-mini-filter { height:38px; border:1px solid #dbe4f0; border-radius:14px; padding:0 12px; font-weight:800; color:#334155; background:#fff; flex:1; }
      .absent-mini-btn { height:38px; border:0; border-radius:14px; padding:0 16px; font-weight:900; color:#991b1b; background:#fee2e2; cursor:pointer; }
      .absent-row-clickable .absent-days { border:0; cursor:pointer; }
      .absent-row-clickable .absent-days:hover { transform: scale(1.04); }
      .absent-modal-backdrop { position:fixed; inset:0; z-index:9999; background:rgba(15,23,42,.55); display:none; align-items:center; justify-content:center; padding:24px; }
      .absent-modal-backdrop.show { display:flex; }
      .absent-modal-card { width:min(780px, 94vw); max-height:84vh; overflow:hidden; background:#fff; border-radius:28px; box-shadow:0 28px 80px rgba(15,23,42,.35); border:1px solid #e2e8f0; }
      .absent-modal-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:22px 24px; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
      .absent-modal-title { font-size:22px; font-weight:1000; color:#0f172a; }
      .absent-modal-subtitle { font-size:13px; color:#64748b; font-weight:800; margin-top:4px; }
      .absent-modal-close { border:0; background:#0f172a; color:#fff; font-weight:900; border-radius:16px; padding:11px 18px; cursor:pointer; }
      .absent-modal-body { padding:20px 24px 24px; overflow:auto; max-height:68vh; }
      .absent-modal-emp { border:1px solid #e2e8f0; border-radius:20px; padding:16px; margin-bottom:14px; background:#fff; }
      .absent-modal-emp-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .absent-modal-name { font-size:17px; font-weight:1000; color:#0f172a; }
      .absent-modal-meta { font-size:13px; color:#475569; font-weight:800; margin-top:3px; }
      .absent-modal-pill { background:#fee2e2; color:#991b1b; border-radius:999px; padding:8px 14px; font-weight:1000; white-space:nowrap; }
      .absent-date-chip-wrap { display:flex; gap:8px; flex-wrap:wrap; }
      .absent-date-chip { background:#f1f5f9; color:#0f172a; border:1px solid #e2e8f0; border-radius:999px; padding:8px 12px; font-weight:900; }
      .absent-date-chip.muted, .absent-modal-empty { color:#64748b; font-weight:900; }
    `;

    document.head.appendChild(style);
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function formatDate(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const [y, m, d] = text.split("-");
    return `${d}-${m}-${y}`;
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
