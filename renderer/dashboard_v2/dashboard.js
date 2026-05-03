// renderer/dashboard_v2/dashboard.js
// Uses: Chart.js + window.api.getDashboardFeed()

let pieChart = null;
let barChart = null;

document.addEventListener("DOMContentLoaded", () => {
  // (Optional debug - keep for 1 day, then remove)
  console.log("Preload:", window.api?.__preloadVersion?.() || "NOT LOADED");
  console.log("API keys:", Object.keys(window.api || {}));

  document.getElementById("refreshBtn")?.addEventListener("click", () => loadAndRender(true));
  document.getElementById("backBtn")?.addEventListener("click", () => (window.location.href = "../../index.html"));

  loadAndRender(true);

  // Auto refresh every 60 sec (enable when stable)
  setInterval(() => loadAndRender(false), 60 * 1000);
});

async function loadAndRender(showPopup) {
  try {
    const webAppUrl = window.SPWT_CONFIG?.SHEETS_WEBAPP_URL;
    const secret = window.SPWT_CONFIG?.SECRET;
    const year = new Date().getFullYear();

    if (!webAppUrl) return showPopup && alert("Missing SHEETS_WEBAPP_URL in config.js");
    if (!secret) return showPopup && alert("Missing SECRET in config.js");
    if (!window.api?.getDashboardFeed) return alert("window.api.getDashboardFeed not available (preload/IPC issue)");

    const res = await window.api.getDashboardFeed({ webAppUrl, secret, year });
    console.log("Dashboard feed:", res);

    if (!res?.ok) return showPopup && alert("Dashboard feed failed: " + (res?.error || "Unknown"));

    const table = res.table || [];
    if (table.length <= 1) return showPopup && alert("No dashboard rows yet. (DASHBOARD_FEED empty)");

    const headers = table[0].map(h => String(h || "").trim());
    const rows = table.slice(1);

    renderCharts(headers, rows);
    renderMachineGrid(headers, rows);

    const sync = document.getElementById("syncLine");
    if (sync) sync.textContent = "Last Sync: " + new Date().toLocaleString("en-IN");

  } catch (e) {
    console.error(e);
    if (showPopup) alert("Dashboard render error: " + (e?.message || e));
  }
}

function colIndex(headers, name) {
  return headers.findIndex(h => h === name);
}

function n(v) {
  const x = Number(v || 0);
  return isNaN(x) ? 0 : x;
}

function renderCharts(headers, rows) {
  const iDept = colIndex(headers, "DeptJSON");
  const iStdTot = colIndex(headers, "Std_Total_Min");
  const iConsTot = colIndex(headers, "Consumed_Total_Min");
  const iOvrTot = colIndex(headers, "Overrun_Total_Min");

  // ---- Aggregate dept totals across ALL machines ----
  const deptAgg = {}; // dept -> {std, cons, rem, ov}
  rows.forEach(r => {
    const raw = r[iDept];
    if (!raw) return;
    let obj = {};
    try { obj = JSON.parse(raw); } catch { obj = {}; }

    Object.keys(obj).forEach(dep => {
      const it = obj[dep] || {};
      const std  = n(it.std);
      const cons = n(it.cons);
      const rem  = n(it.rem);
      const ov   = n(it.ov);

      deptAgg[dep] = deptAgg[dep] || { std: 0, cons: 0, rem: 0, ov: 0 };
      deptAgg[dep].std += std;
      deptAgg[dep].cons += cons;
      deptAgg[dep].rem += rem;
      deptAgg[dep].ov += ov;
    });
  });

  // ---- PIE: Remaining by Department (All Machines) ----
  const pieLabels = Object.keys(deptAgg);
  const pieData = pieLabels.map(d => deptAgg[d].rem);

  const pieCanvas = document.getElementById("pieDept");
  if (pieCanvas) {
    if (pieChart) pieChart.destroy();
    pieChart = new Chart(pieCanvas, {
      type: "pie",
      data: { labels: pieLabels, datasets: [{ data: pieData }] },
      options: { plugins: { legend: { position: "bottom" } } }
    });
  }

  // ---- BAR: TOTAL Std vs Consumed vs Overrun (All Machines) ----
  let totalStd = 0, totalCons = 0, totalOv = 0;
  rows.forEach(r => {
    totalStd += n(r[iStdTot]);
    totalCons += n(r[iConsTot]);
    totalOv += n(r[iOvrTot]);
  });

  const barCanvas = document.getElementById("barDept");
  if (barCanvas) {
    if (barChart) barChart.destroy();
    barChart = new Chart(barCanvas, {
      type: "bar",
      data: {
        labels: ["TOTAL (All Machines)"],
        datasets: [
          { label: "Standard (min)", data: [totalStd] },
          { label: "Consumed (min)", data: [totalCons] },
          { label: "Overrun (min)", data: [totalOv] }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  const note = document.getElementById("pieNote");
  if (note) note.textContent = "Remaining minutes by team (from DeptJSON.rem).";
}

function renderMachineGrid(headers, rows) {
  const iMachine = colIndex(headers, "MachineName");
  const iType = colIndex(headers, "Type");
  const iStart = colIndex(headers, "StartDate");
  const iStdTot = colIndex(headers, "Std_Total_Min");
  const iConsTot = colIndex(headers, "Consumed_Total_Min");
  const iRemTot = colIndex(headers, "Remaining_Total_Min");
  const iOvrTot = colIndex(headers, "Overrun_Total_Min");

  const host = document.getElementById("machineGrid");
  if (!host) return;

  host.innerHTML = rows.map(r => {
    const name = esc(r[iMachine]);
    const type = esc(r[iType]);
    const start = esc(r[iStart]);
    const std = n(r[iStdTot]);
    const cons = n(r[iConsTot]);
    const rem = n(r[iRemTot]);
    const ov = n(r[iOvrTot]);

    return `
      <div class="ms-row">
        <div class="ms-name"><b>${name}</b> <span style="opacity:.7">(${type})</span></div>
        <div class="ms-kpi">Start: <b>${start || "-"}</b></div>
        <div class="ms-kpi">Std: <b>${std}</b></div>
        <div class="ms-kpi">Used: <b>${cons}</b></div>
        <div class="ms-kpi">Rem: <b>${rem}</b></div>
        <div class="ms-kpi">Over: <b>${ov}</b></div>
      </div>
    `;
  }).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}