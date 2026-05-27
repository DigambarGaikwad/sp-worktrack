// renderer/dashboard_v2/qualityReportPatch.js
// Adds Print Quality Report and Send Quality Report buttons to Machine Dashboard.

(function () {
  const REQUEST_TIMEOUT_MS = 30000;
  let qualityReportObservation = "";

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
  function assetUrl(fileName) {
    try {
      return new URL(`../assets/${fileName}`, window.location.href).href;
    } catch (err) {
      return "";
    }
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

    const notOk = rows.filter(r => clean(r.status).toUpperCase().includes("NOT OK") || clean(r.value).toUpperCase().includes("NOT OK")).length;
    const pending = rows.filter(r => clean(r.status).toUpperCase() === "PENDING" || !clean(r.status)).length;
    const done = rows.filter(r => clean(r.status).toUpperCase() !== "PENDING" && clean(r.status)).length;
    const ok = Math.max(0, done - notOk);

    return { machineNo, machineCategory, fromDate, toDate, rows, summary: { total: rows.length, done, pending, ok, notOk } };
  }

  function badge(status, value) {
    const s = clean(status || value || "PENDING").toUpperCase();
    const label = s || "PENDING";
    const color = label.includes("NOT OK") ? "#b91c1c" : label === "PENDING" ? "#b45309" : "#15803d";
    const bg = label.includes("NOT OK") ? "#fee2e2" : label === "PENDING" ? "#fef3c7" : "#dcfce7";
    return `<span class="badge" style="background:${bg};color:${color};">${esc(label)}</span>`;
  }

  function buildRuledLines() {
    const obs = clean(qualityReportObservation);
    const obsHtml = obs ? `<div class="observation-text">${esc(obs).replace(/\n/g, "<br>")}</div>` : "";
    return `
      <section class="obs-section">
        <div class="section-head">Observations / Deviations / Remarks</div>
        ${obsHtml}
        <div class="line"></div>
        <div class="line"></div>
        <div class="line"></div>
      </section>`;
  }

  function buildReportHtml() {
    const data = getReportData();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const logo = assetUrl("logo (2).png") || assetUrl("app.ico");
    const rowsHtml = data.rows.map((r, index) => {
      const status = clean(r.status) || (clean(r.value) ? "DONE" : "PENDING");
      return `
        <tr>
          <td class="sr">${index + 1}</td>
          <td class="point">${esc(r.point || r.qualityPoint || "-")}</td>
          <td>${esc(r.department || "-")}</td>
          <td>${esc(r.subwork || r.subWork || "-")}</td>
          <td>${badge(status, r.value)}</td>
          <td>${esc(r.value || r.readingStatus || "-")}</td>
          <td>${esc(r.empName || r.doneByName || r.empCode || "-")}</td>
          <td>${esc(displayDate(r.workDate || r.doneDate))}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="8" class="empty-row">No quality checkpoint data available</td></tr>`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>SP WorkTrack Quality Report</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin:0; background:#eef2f7; font-family:Arial, Helvetica, sans-serif; color:#111827; }
  .page { max-width: 1180px; margin: 16px auto; background:white; border-radius:14px; overflow:hidden; box-shadow:0 8px 28px rgba(15,23,42,.16); }
  .app-head { background:#111827; color:white; padding:16px 26px; display:flex; align-items:center; justify-content:space-between; gap:18px; }
  .brand { display:flex; align-items:center; gap:18px; }
  .logo-img { width:112px; height:48px; object-fit:contain; background:#0f172a; border-radius:4px; }
  .app-title { font-size:25px; font-weight:800; line-height:1; letter-spacing:.2px; }
  .app-sub { font-size:14px; margin-top:5px; opacity:.92; }
  .report-chip { border:1px solid rgba(255,255,255,.22); border-radius:999px; padding:8px 13px; font-size:12px; color:#e5e7eb; white-space:nowrap; }
  .content { padding:22px 26px 18px; }
  .title-row { display:flex; justify-content:space-between; align-items:flex-end; gap:14px; margin-bottom:12px; }
  .report-title { font-size:26px; font-weight:800; margin:0 0 4px; letter-spacing:.4px; }
  .subtitle { color:#64748b; font-size:13px; font-weight:700; }
  .meta-grid { display:grid; grid-template-columns: 1.05fr 1.25fr 1.25fr 1.15fr; gap:10px; margin-top:12px; }
  .meta-card { border:1px solid #e5e7eb; border-left:4px solid #0b3f73; border-radius:10px; padding:10px 12px; background:#f8fafc; min-height:64px; }
  .label { color:#64748b; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.4px; }
  .value { color:#111827; font-size:17px; font-weight:800; margin-top:6px; }
  .sum-grid { margin:14px 0 14px; display:grid; grid-template-columns: repeat(5,1fr); gap:10px; }
  .sum-card { border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px; background:#fff; display:flex; align-items:center; justify-content:space-between; min-height:52px; }
  .sum-card strong { font-size:23px; color:#0f172a; }
  .sum-card span { color:#64748b; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.35px; }
  .sum-card.total { background:#eff6ff; border-color:#bfdbfe; }
  .sum-card.done { background:#f0fdf4; border-color:#bbf7d0; }
  .sum-card.pending { background:#fffbeb; border-color:#fde68a; }
  .sum-card.notok { background:#fef2f2; border-color:#fecaca; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:11.3px; table-layout:fixed; }
  th { background:#0b3f73; color:white; padding:8px 7px; text-align:left; font-size:11px; letter-spacing:.2px; }
  td { border:1px solid #e5e7eb; padding:7px; vertical-align:top; word-break:break-word; }
  tr:nth-child(even) td { background:#f8fafc; }
  .sr { width:38px; text-align:center; }
  .point { font-weight:700; }
  .badge { display:inline-block; padding:4px 9px; border-radius:999px; font-weight:800; font-size:10.5px; white-space:nowrap; }
  .empty-row { text-align:center; color:#64748b; padding:18px; }
  .obs-section { margin-top:16px; border:1px solid #dbe3ee; border-radius:10px; padding:10px 12px 12px; break-inside:avoid; }
  .section-head { color:#0f172a; font-size:13px; font-weight:800; margin-bottom:8px; }
  .observation-text { font-size:12px; color:#111827; padding:6px 0 8px; line-height:1.45; }
  .line { height:24px; border-bottom:1px solid #cbd5e1; }
  .foot { padding:10px 26px 16px; color:#64748b; font-size:10.5px; display:flex; justify-content:space-between; gap:14px; }
  .no-print { padding:10px 26px; display:flex; justify-content:flex-end; gap:8px; }
  .print-btn { border:0; background:#0b3f73; color:white; border-radius:8px; padding:9px 14px; font-weight:800; cursor:pointer; }
  @media print {
    body { background:white; }
    .page { margin:0; max-width:none; box-shadow:none; border-radius:0; }
    .no-print { display:none; }
    .content { padding:16px 18px 10px; }
    .app-head { padding:13px 18px; }
    .meta-grid, .sum-grid { gap:7px; }
    th, td { padding:5.5px; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="app-head">
      <div class="brand">
        <img class="logo-img" src="${esc(logo)}" onerror="this.style.display='none'" />
        <div><div class="app-title">SP WorkTrack</div><div class="app-sub">Production Management System</div></div>
      </div>
      <div class="report-chip">Quality Report</div>
    </div>
    <div class="content">
      <div class="title-row">
        <div><h1 class="report-title">Quality Checkpoint Report</h1><div class="subtitle">Planned + completed quality checkpoints with status, result and responsible person</div></div>
      </div>
      <div class="meta-grid">
        <div class="meta-card"><div class="label">Machine No</div><div class="value">${esc(data.machineNo)}</div></div>
        <div class="meta-card"><div class="label">Machine Category</div><div class="value">${esc(data.machineCategory)}</div></div>
        <div class="meta-card"><div class="label">Report Period</div><div class="value">${esc(period)}</div></div>
        <div class="meta-card"><div class="label">Generated On</div><div class="value">${esc(nowText())}</div></div>
      </div>
      <div class="sum-grid">
        <div class="sum-card total"><span>Total Points</span><strong>${data.summary.total}</strong></div>
        <div class="sum-card done"><span>Done</span><strong>${data.summary.done}</strong></div>
        <div class="sum-card pending"><span>Pending</span><strong>${data.summary.pending}</strong></div>
        <div class="sum-card done"><span>OK</span><strong>${data.summary.ok}</strong></div>
        <div class="sum-card notok"><span>Not OK</span><strong>${data.summary.notOk}</strong></div>
      </div>
      <table>
        <thead><tr><th style="width:38px;">Sr</th><th style="width:18%;">Point</th><th style="width:14%;">Dept</th><th style="width:18%;">Sub Work</th><th style="width:10%;">Status</th><th style="width:14%;">Result / Reading</th><th style="width:16%;">Done By</th><th style="width:10%;">Done Date</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${buildRuledLines()}
    </div>
    <div class="foot"><span>Generated from SP WorkTrack quality checkpoint data.</span><span>Status, result, done by and done date are captured from production entries.</span></div>
    <div class="no-print"><button class="print-btn" onclick="window.print()">Print / Save PDF</button></div>
  </div>
</body>
</html>`;
  }

  function printQualityReport() {
    const html = buildReportHtml();
    const win = window.open("", "_blank", "width=1200,height=850");
    if (!win) return alert("Popup blocked. Allow popups for SP WorkTrack.");
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  function addObservation() {
    const text = prompt("Add observation / deviation / remarks for this quality report:", qualityReportObservation || "");
    if (text === null) return;
    qualityReportObservation = text.trim();
    alert(qualityReportObservation ? "Observation added for next print/send." : "Observation cleared.");
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
      <button class="dash-btn" id="addQualityObservationBtn" type="button">Add Observation</button>
      <button class="dash-btn primary" id="printQualityReportBtn" type="button">Print Quality Report</button>
      <button class="dash-btn" id="sendQualityReportBtn" type="button">Send Quality Report</button>
    `;
    target.appendChild(actions);
    document.getElementById("addQualityObservationBtn")?.addEventListener("click", addObservation);
    document.getElementById("printQualityReportBtn")?.addEventListener("click", printQualityReport);
    document.getElementById("sendQualityReportBtn")?.addEventListener("click", sendQualityReport);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(addButtons, 500));
  document.addEventListener("click", () => setTimeout(addButtons, 100), true);
})();
