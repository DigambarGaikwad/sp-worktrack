let dashboardRows = [];
let filteredRows = [];
let selectedMachine = null;
let selectedWorkTab = "remaining";
let deptChart = null;
let latestMachineDetails = null;

const el = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  loadDashboard();
});

function wireEvents() {
  el("refreshBtn")?.addEventListener("click", loadDashboard);

  el("backBtn")?.addEventListener("click", () => {
    window.location.href = "../../index.html";
  });

  el("statusFilter")?.addEventListener("change", applyFilters);
  el("typeFilter")?.addEventListener("change", applyFilters);
  el("machineFilter")?.addEventListener("change", applyFilters);

  el("remainingTabBtn")?.addEventListener("click", () => {
    selectedWorkTab = "remaining";
    el("remainingTabBtn").classList.add("active");
    el("completedTabBtn").classList.remove("active");
    renderWorkTable();
  });

  el("completedTabBtn")?.addEventListener("click", () => {
    selectedWorkTab = "completed";
    el("completedTabBtn").classList.add("active");
    el("remainingTabBtn").classList.remove("active");
    renderWorkTable();
  });
}

async function loadDashboard() {
  try {
    setLoadingState(true);

    const res = await fetch(window.SPWT_CONFIG.SHEETS_WEBAPP_URL, {
      method: "POST",
      body: JSON.stringify({
        secret: window.SPWT_CONFIG.SECRET,
        action: "getDashboardFeed",
        year: new Date().getFullYear()
      })
    });

    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || "Dashboard feed failed");
    }

    dashboardRows = tableToObjects(json.table || []);
    buildFilterOptions();
    applyFilters();
  } catch (err) {
    console.error(err);
    alert("Dashboard load failed: " + err.message);
  } finally {
    setLoadingState(false);
  }
}

function tableToObjects(table) {
  if (!Array.isArray(table) || table.length < 2) return [];

  const headers = table[0].map((h) => String(h || "").trim());

  return table.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });

    return {
      machineName: clean(obj.MachineName),
      type: clean(obj.Type),
      status: clean(obj.Status) || "Active",
      stdMin: num(obj.Std_Total_Min),
      actualMin: num(obj.Consumed_Total_Min),
      remainingMin: num(obj.Remaining_Total_Min),
      overrunMin: num(obj.Overrun_Total_Min),
      progressPct: num(obj.Progress_Pct),
      remainingPct: num(obj.Remaining_Pct),
      overrunPct: num(obj.Overrun_Pct),
      reworkMin: num(obj.Rework_Total_Min),
      otherMin: num(obj.Other_Total_Min),
      dept: parseJsonSafe(obj.DeptJSON, {}),
      efficiencyReasons: clean(obj.Efficiency_Reasons),
      workCheckpoints: clean(obj.Work_Checkpoints),
      qualityCheckpoints: clean(obj.Quality_Checkpoints),
      qualityStatus: clean(obj.Quality_Status),
      qualityNotOkCount: num(obj.Quality_NOT_OK_Count),
      bookingDoneCount: num(obj.Booking_Done_Count)
    };
  }).filter((x) => x.machineName);
}

function buildFilterOptions() {
  const typeFilter = el("typeFilter");
  const machineFilter = el("machineFilter");

  const selectedType = typeFilter.value || "All";
  const selectedMachineValue = machineFilter.value || "All";

  const types = unique(dashboardRows.map((r) => r.type).filter(Boolean));

  typeFilter.innerHTML = `<option value="All">Type: All</option>`;
  types.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = "Type: " + t;
    typeFilter.appendChild(opt);
  });

  if (types.includes(selectedType)) typeFilter.value = selectedType;

  machineFilter.innerHTML = `<option value="All">Machine: All</option>`;
  dashboardRows.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.machineName;
    opt.textContent = "Machine: " + r.machineName;
    machineFilter.appendChild(opt);
  });

  if (dashboardRows.some((r) => r.machineName === selectedMachineValue)) {
    machineFilter.value = selectedMachineValue;
  }
}

function applyFilters() {
  const statusValue = el("statusFilter").value || "All";
  const typeValue = el("typeFilter").value || "All";
  const machineValue = el("machineFilter").value || "All";

  filteredRows = dashboardRows.filter((r) => {
    const statusOk = statusValue === "All" || same(r.status, statusValue);
    const typeOk = typeValue === "All" || same(r.type, typeValue);
    const machineOk = machineValue === "All" || same(r.machineName, machineValue);
    return statusOk && typeOk && machineOk;
  });

  renderOverallKpis();
  renderMachineCards();

  selectedMachine = filteredRows[0] || null;
  renderSelectedMachine();
}

function renderOverallKpis() {
  const activeRows = dashboardRows.filter((r) => same(r.status, "Active"));
  const completedRows = dashboardRows.filter((r) => same(r.status, "Completed"));

  const rowsForTotal = filteredRows.length ? filteredRows : [];

  const std = sum(rowsForTotal, "stdMin");
  const actual = sum(rowsForTotal, "actualMin");
  const remaining = sum(rowsForTotal, "remainingMin");
  const completedStd = Math.max(0, std - remaining);
  const pct = std > 0 ? (completedStd / std) * 100 : 0;

  setText("kpiActiveMachines", activeRows.length);
  setText("kpiCompletedMachines", completedRows.length);
  setText("kpiStdHours", minToHours(std));
  setText("kpiActualHours", minToHours(actual));
  setText("kpiRemainingHours", minToHours(remaining));
  setText("kpiCompletionPct", pct.toFixed(1) + "%");
}

function renderMachineCards() {
  const grid = el("machineCardGrid");
  grid.innerHTML = "";

  if (!filteredRows.length) {
    grid.innerHTML = `<div class="empty-state">No machines found for selected filter.</div>`;
    return;
  }

  filteredRows.forEach((m) => {
    const card = document.createElement("div");
    card.className = "machine-card";
    card.dataset.machine = m.machineName;

    const pct = safePct(m.progressPct);
    const color = pct >= 90 ? "var(--green)" : pct >= 50 ? "var(--blue)" : pct > 0 ? "var(--orange)" : "var(--red)";

    card.innerHTML = `
      <div class="machine-card-title">${escapeHtml(m.machineName)}</div>
      <div class="machine-card-meta">${escapeHtml(m.type)} • ${escapeHtml(m.status)}</div>
      <div class="machine-card-row">
        <div class="machine-card-pct" style="color:${color}">${pct.toFixed(1)}%</div>
        <div class="machine-card-rem">${minToHours(m.remainingMin)} hrs rem</div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${Math.min(100, pct)}%; background:${color};"></div>
      </div>
    `;

    card.addEventListener("click", () => {
      selectedMachine = m;
      el("machineFilter").value = m.machineName;
      highlightSelectedCard();
      renderSelectedMachine();
      el("machineDetailSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    grid.appendChild(card);
  });

  highlightSelectedCard();
}

function highlightSelectedCard() {
  document.querySelectorAll(".machine-card").forEach((c) => {
    c.classList.toggle("active", selectedMachine && c.dataset.machine === selectedMachine.machineName);
  });
}

async function renderSelectedMachine() {
  if (!selectedMachine) {
    setText("selectedMachineName", "No Machine Found");
    setText("selectedMachineMeta", "Change filters to show machines");
    clearMachineDetails();
    return;
  }

  highlightSelectedCard();

  setText("selectedMachineName", selectedMachine.machineName);
  setText("selectedMachineMeta", `${selectedMachine.type} • ${selectedMachine.status}`);

  setText("machineStdHours", minToHours(selectedMachine.stdMin));
  setText("machineActualHours", minToHours(selectedMachine.actualMin));
  setText("machineRemainingHours", minToHours(selectedMachine.remainingMin));
  setText("machineEfficiencyPct", selectedMachine.stdMin > 0 ? ((selectedMachine.stdMin / Math.max(1, selectedMachine.actualMin)) * 100).toFixed(1) + "%" : "0%");
  setText("machineCompletionPct", safePct(selectedMachine.progressPct).toFixed(1) + "%");
  setText("machineOverrunHours", minToHours(selectedMachine.overrunMin));

  const reworkHours = minToHours(selectedMachine.reworkMin);
  const otherHours = minToHours(selectedMachine.otherMin);
  const actual = Math.max(1, selectedMachine.actualMin);
  setText("reworkHours", reworkHours);
  setText("otherHours", otherHours);
  setText("reworkPct", ((selectedMachine.reworkMin / actual) * 100).toFixed(1) + "%");
  setText("otherPct", ((selectedMachine.otherMin / actual) * 100).toFixed(1) + "%");

  renderDeptChartAndTable(selectedMachine);

  await loadMachineDetails(selectedMachine);
}

async function loadMachineDetails(machineRow) {
  try {
    latestMachineDetails = null;

    const res = await fetch(window.SPWT_CONFIG.SHEETS_WEBAPP_URL, {
      method: "POST",
      body: JSON.stringify({
        secret: window.SPWT_CONFIG.SECRET,
        action: "getMachineDashboardDetails",
        year: new Date().getFullYear(),
        machine: machineRow.machineName,
        machineCategory: machineRow.type
      })
    });

    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || "Machine details failed");
    }

    latestMachineDetails = json;

    renderQualityTable();
    renderWorkTable();
    renderLastSixAndShortage();
  } catch (err) {
    console.error(err);
    latestMachineDetails = null;
    setText("lastSixPct", "0%");
    setText("lastSixHours", "0 hrs");
    setText("shortageCount", "0");
    el("qualityTableBody").innerHTML = `<tr><td colspan="5">Failed to load quality details</td></tr>`;
    el("workTableBody").innerHTML = `<tr><td colspan="7">Failed to load work details</td></tr>`;
  }
}

function renderDeptChartAndTable(machineRow) {
  const deptObj = machineRow.dept || {};
  const names = Object.keys(deptObj);

  const tableBody = el("departmentTableBody");
  tableBody.innerHTML = "";

  if (!names.length) {
    tableBody.innerHTML = `<tr><td colspan="6">No department data available</td></tr>`;
  } else {
    names.forEach((deptName) => {
      const d = deptObj[deptName] || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(deptName)}</td>
        <td>${minToHours(num(d.std))}</td>
        <td>${minToHours(num(d.cons))}</td>
        <td>${minToHours(num(d.rem))}</td>
        <td>${minToHours(num(d.ov))}</td>
        <td>${safePct(num(d.progressPct)).toFixed(1)}%</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  const ctx = el("deptChart");
  if (!ctx || typeof Chart === "undefined") return;

  if (deptChart) deptChart.destroy();

  deptChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        { label: "Std", data: names.map((n) => minToHoursNum(num(deptObj[n].std))) },
        { label: "Actual", data: names.map((n) => minToHoursNum(num(deptObj[n].cons))) },
        { label: "Overrun", data: names.map((n) => minToHoursNum(num(deptObj[n].ov))) }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

function renderQualityTable() {
  const body = el("qualityTableBody");
  const rows = latestMachineDetails?.qualityChecklist || [];

  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5">No quality checklist found</td></tr>`;
    return;
  }

  rows.forEach((q) => {
    const status = clean(q.status) || "PENDING";
    const badgeClass = statusClass(status);

    const result = clean(q.readingStatus) || clean(q.result) || "-";
    const doneBy = clean(q.doneByName) || "-";
    const doneDate = clean(q.doneDate) || "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(q.qualityPoint || "-")}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(result)}</td>
      <td>${escapeHtml(doneBy)}</td>
      <td>${escapeHtml(doneDate)}</td>
    `;
    body.appendChild(tr);
  });
}

function renderWorkTable() {
  const body = el("workTableBody");

  if (!latestMachineDetails) {
    body.innerHTML = `<tr><td colspan="7">Select a machine to load work details</td></tr>`;
    return;
  }

  const rows = selectedWorkTab === "completed"
    ? latestMachineDetails.completedWork || []
    : latestMachineDetails.remainingWork || [];

  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7">No ${selectedWorkTab} work found</td></tr>`;
    return;
  }

  rows.forEach((w) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(w.department || "-")}</td>
      <td>${escapeHtml(w.subWork || "-")}</td>
      <td>${minToHours(num(w.stdTime))}</td>
      <td>${minToHours(num(w.actualTime))}</td>
      <td>${minToHours(num(w.remainingTime))}</td>
      <td>${minToHours(num(w.overrunTime))}</td>
      <td>${escapeHtml(w.doneDate || "-")}</td>
    `;
    body.appendChild(tr);
  });
}

function renderLastSixAndShortage() {
  const last = latestMachineDetails?.lastSixWorkDays || {};
  const shortage = latestMachineDetails?.shortageMaterial || [];

  setText("lastSixPct", safePct(num(last.workDonePct)).toFixed(1) + "%");
  setText("lastSixHours", `${num(last.actualHours).toFixed(1)} hrs`);
  setText("shortageCount", shortage.length || 0);
}

function clearMachineDetails() {
  ["machineStdHours", "machineActualHours", "machineRemainingHours", "machineOverrunHours"].forEach((id) => setText(id, "0"));
  ["machineEfficiencyPct", "machineCompletionPct", "lastSixPct"].forEach((id) => setText(id, "0%"));
  setText("lastSixHours", "0 hrs");
  setText("shortageCount", "0");
  el("machineCardGrid").innerHTML = "";
  el("departmentTableBody").innerHTML = "";
  el("qualityTableBody").innerHTML = "";
  el("workTableBody").innerHTML = "";
  if (deptChart) deptChart.destroy();
}

function setLoadingState(isLoading) {
  const btn = el("refreshBtn");
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? "Loading..." : "Refresh";
  }
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

function clean(v) {
  return String(v == null ? "" : v).trim();
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function same(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function unique(arr) {
  return [...new Set(arr.map(clean).filter(Boolean))].sort();
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + num(r[key]), 0);
}

function minToHours(min) {
  return Number((num(min) / 60).toFixed(1));
}

function minToHoursNum(min) {
  return Number((num(min) / 60).toFixed(2));
}

function safePct(v) {
  const n = num(v);
  return Math.max(0, Math.min(999, n));
}

function parseJsonSafe(text, fallback) {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function statusClass(status) {
  const s = clean(status).toLowerCase();
  if (s === "done" || s === "ok") return "done";
  if (s.includes("not ok") || s.includes("issue")) return "notok";
  return "pending";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}