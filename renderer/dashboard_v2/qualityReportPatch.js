// renderer/dashboard_v2/qualityReportPatch.js
// Adds Print Quality Report and Send Quality Report buttons to Machine Dashboard.

(function () {
  const REQUEST_TIMEOUT_MS = 30000;

  function apiBaseUrl() {
    return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  }

  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) {
    return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
  function displayDate(value) {
    const s = clean(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "-";
  }
  function nowText() {
    return new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function getCurrentQualityRows() {
    try {
      const rawRows = latestMachineDetails?.raw?.qualityStatus;
      if (Array.isArray(rawRows) && rawRows.length) return rawRows;
    } catch (err) {}
    try {
      const mappedRows = latestMachineDetails?.qualityChecklist;
      if (Array.isArray(mappedRows)) return mappedRows.map(q => ({
        point: q.qualityPoint,
        status: q.status,
        value: q.readingStatus,
        empName: q.doneByName,
        workDate: q.doneDate
      }));
    } catch (err) {}
    return [];
  }

  function getReportData() {
    const machine = latestMachineDetails?.raw?.machine || {};
    const machineNo = clean(machine.machineNo || selectedMachine?.machineName || "-");
    const machineCategory = clean(machine.machineCategory || selectedMachine?.type || "-");
    const fromDate = clean(machine.startDate || "");
    const toDate = clean(machine.endDate || new Date().toISOString().slice(0, 10));
    const rows = getCurrentQualityRows();

    const done = rows.filter(r => ["DONE", "OK", "NOT OK"].includes(clean(r.status).toUpperCase())).length;
    const notOk = rows.filter(r => clean(r.status).toUpperCase().includes("NOT OK") || clean(r.value).toUpperCase().includes("NOT OK")).length;
    const pending = rows.filter(r => clean(r.status).toUpperCase() === "PENDING" || !clean(r.status)).length;
    const ok = Math.max(0, done - notOk);

    return { machineNo, machineCategory, fromDate, toDate, rows, summary: { total: rows.length, done, pending, ok, notOk } };
  }

  function badge(status, value) {
    const s = clean(status || value || "PENDING").toUpperCase();
    const label = s || "PENDING";
    const color = label.includes("NOT OK") ? "#DC2626" : label === "PENDING" ? "#F59E0B" : "#16A34A";
    const bg = label.includes("NOT OK") ? "#FEE2E2" : label === "PENDING" ? "#FEF3C7" : "#DCFCE7";
    return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:${color};font-weight:700;font-size:11px;">${esc(label)}</span>`;
  }

  function buildReportHtml() {
    const data = getReportData();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const rowsHtml = data.rows.map((r, index) => {
      const status = clean(r.status) || (clean(r.value) ? "DONE" : "PENDING");
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(r.point || r.qualityPoint || "-")}</td>
          <td>${esc(r.department || "-")}</td>
          <td>${esc(r.subwork || r.subWork || "-")}</td>
          <td>${badge(status, r.value)}</td>
          <td>${esc(r.value || r.readingStatus || "-")}</td>
          <td>${esc(r.empName || r.doneByName || r.empCode || "-")}</td>
          <td>${esc(displayDate(r.workDate || r.doneDate))}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center;">No quality checkpoint data available</td></tr>`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>SP WorkTrack Quality Report</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { margin:0; background:#f1f5f9; font-family:Arial, sans-serif; color:#111827; }
  .page { max-width: 1120px; margin: 18px auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 8px 24px rgba(15,23,42,.14); }
  .app-head { background:#111827; color:white; padding:18px 24px; display:flex; align-items:center; gap:18px; }
  .logo-box { width:96px; height:42px; background:#1f2937; border-radius:4px; display:flex; align-items:center; justify-content:center; font-weight:800; letter-spacing:1px; }
  .logo-mark { color:#f97316; margin-right:6px; }
  .app-title { font-size:24px; font-weight:800; line-height:1; }
  .app-sub { font-size:14px; margin-top:4px; opacity:.92; }
  .content { padding:24px; }
  .report-title { font-size:24px; font-weight:800; margin:0 0 4px; }
  .meta-grid { margin-top:14px; display:grid; grid-template-columns: repeat(4,1fr); gap:10px; }
  .meta-card, .sum-card { border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px; background:#f8fafc; }
  .label { color:#64748b; font-size:12px; font-weight:700; }
  .value { color:#111827; font-size:15px; font-weight:800; margin-top:4px; }
  .sum-grid { margin:18px 0; display:grid; grid-template-columns: repeat(5,1fr); gap:10px; }
  .sum-card .value { font-size:22px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
  th { background:#0b3f73; color:white; padding:9px 8px; text-align:left; }
  td { border:1px solid #e5e7eb; padding:8px; vertical-align:top; }
  tr:nth-child(even) td { background:#f8fafc; }
  .foot { padding:12px 24px 18px; color:#64748b; font-size:11px; }
  @media print { body { background:white; } .page { margin:0; box-shadow:none; border-radius:0; } .no-print { display:none; } }
</style>
</head>
<body>
  <div class="page">
    <div class="app-head">
      <div class="logo-box"><span class="logo-mark">SP</span> TECHN</div>
      <div><div class="app-title">SP WorkTrack</div><div class="app-sub">Production Management System</div></div>
    </div>
    <div class="content">
      <h1 class="report-title">Quality Checkpoint Report</h1>
      <div class="label">Planned + completed quality checkpoints</div>
      <div class="meta-grid">
        <div class="meta-card"><div class="label">Machine No</div><div class="value">${esc(data.machineNo)}</div></div>
        <div class="meta-card"><div class="label">Machine Category</div><div class="value">${esc(data.machineCategory)}</div></div>
        <div class="meta-card"><div class="label">Report Period</div><div class="value">${esc(period)}</div></div>
        <div class="meta-card"><div class="label">Generated On</div><div class="value">${esc(nowText())}</div></div>
      </div>
      <div class="sum-grid">
        <div class="sum-card"><div class="label">Total Points</div><div class="value">${data.summary.total}</div></div>
        <div class="sum-card"><div class="label">Done</div><div class="value">${data.summary.done}</div></div>
        <div class="sum-card"><div class="label">Pending</div><div class="value">${data.summary.pending}</div></div>
        <div class="sum-card"><div class="label">OK</div><div class="value">${data.summary.ok}</div></div>
        <div class="sum-card"><div class="label">Not OK</div><div class="value">${data.summary.notOk}</div></div>
      </div>
      <table><thead><tr><th>Sr</th><th>Point</th><th>Dept</th><th>Sub Work</th><th>Status</th><th>Result / Reading</th><th>Done By</th><th>Done Date</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </div>
    <div class="foot">This report is generated from SP WorkTrack quality checkpoint data. Status, result, done by and done date are captured from production entries.</div>
  </div>
</body>
</html>`;
  }

  function printQualityReport() {
    const html = buildReportHtml();
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) return alert("Popup blocked. Allow popups for SP WorkTrack.");
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  async function sendQualityReport() {
    const data = getReportData();
    const html = buildReportHtml();
    try {
      await requestJson("/api/email/quality-report/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineNo: data.machineNo,
          machineCategory: data.machineCategory,
          period: `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`,
          html
        })
      });
      alert("Quality report email sent successfully.");
    } catch (err) {
      alert("Send quality report failed: " + (err?.message || err));
    }
  }

  function addButtons() {
    const heads = Array.from(document.querySelectorAll(".panel-head"));
    const target = heads.find(h => clean(h.querySelector("h2")?.textContent) === "Quality Point Checklist");
    if (!target || target.querySelector("#printQualityReportBtn")) return;

    const actions = document.createElement("div");
    actions.className = "quality-report-actions";
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.innerHTML = `
      <button class="dash-btn primary" id="printQualityReportBtn" type="button">Print Quality Report</button>
      <button class="dash-btn" id="sendQualityReportBtn" type="button">Send Quality Report</button>
    `;
    target.appendChild(actions);
    document.getElementById("printQualityReportBtn")?.addEventListener("click", printQualityReport);
    document.getElementById("sendQualityReportBtn")?.addEventListener("click", sendQualityReport);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(addButtons, 500));
  document.addEventListener("click", () => setTimeout(addButtons, 100), true);
})();
