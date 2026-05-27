// renderer/dashboard_v2/qualityReportPrintPolishPatch.js
// Polishes the print report UI and removes the older download button from the dashboard.

(function () {
  let observationText = "";

  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function displayDate(value) {
    const s = clean(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "-";
  }
  function nowText() { return new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
  function assetUrl(fileName) {
    try { return new URL(`../../assets/${fileName}`, window.location.href).href; }
    catch (err) { return ""; }
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
    const bg = label.includes("NOT OK") ? "#fee2e2" : label === "PENDING" ? "#fff1c2" : "#dcfce7";
    return `<span class="badge" style="background:${bg};color:${color};border-color:${color};">${esc(label)}</span>`;
  }

  function buildPolishedPrintHtml() {
    const data = getReportData();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const logo = assetUrl("logo%20(2).png") || assetUrl("app.ico");
    const obs = clean(observationText || window.__SPWT_QUALITY_REPORT_OBSERVATION || "");
    const rowsHtml = data.rows.map((r, index) => {
      const status = clean(r.status) || (clean(r.value) ? "DONE" : "PENDING");
      return `
        <tr>
          <td class="sr">${index + 1}</td>
          <td class="point">${esc(r.point || r.qualityPoint || "-")}</td>
          <td>${esc(r.department || "-")}</td>
          <td>${esc(r.subwork || r.subWork || "-")}</td>
          <td class="status-cell">${badge(status, r.value)}</td>
          <td class="result-cell">${esc(r.value || r.readingStatus || "-")}</td>
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
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  body { margin:0; background:#eef2f7; font-family:Arial, Helvetica, sans-serif; color:#111827; }
  .page { max-width:820px; margin:12px auto; background:#fff; border:1px solid #cbd5e1; border-radius:10px; overflow:hidden; box-shadow:0 8px 24px rgba(15,23,42,.12); }
  .app-head { background:#111827 !important; color:#fff !important; padding:11px 16px; display:flex; justify-content:space-between; align-items:center; gap:12px; border-bottom:4px solid #0b3f73; border-radius:10px 10px 0 0; }
  .brand { display:flex; align-items:center; gap:12px; min-width:0; }
  .logo-img { width:106px; height:42px; object-fit:contain; background:#111827 !important; border-radius:6px; }
  .app-title { font-size:21px; font-weight:900; color:#fff !important; line-height:1; letter-spacing:.2px; }
  .app-sub { font-size:11.5px; margin-top:4px; color:#e5e7eb !important; }
  .report-title { font-size:16px; font-weight:900; color:#fff !important; text-align:right; }
  .report-sub { font-size:10.5px; margin-top:4px; color:#d1d5db !important; text-align:right; }
  .content { padding:11px 15px 10px; }
  .subtitle { color:#334155; font-size:10.5px; font-weight:800; margin-bottom:8px; }
  .meta-grid { display:grid; grid-template-columns:1fr 1.25fr; gap:6px; }
  .meta-card { border:1px solid #d8e0ea; border-left:4px solid #0b3f73; border-radius:8px; background:#f8fafc !important; padding:6px 8px; min-height:40px; }
  .label { color:#64748b; font-size:8.5px; font-weight:900; text-transform:uppercase; letter-spacing:.34px; }
  .value { color:#111827; font-size:12.5px; font-weight:900; margin-top:3px; }
  .sum-grid { margin:9px 0; display:grid; grid-template-columns:repeat(5,1fr); gap:6px; }
  .sum-card { border:1px solid #e5e7eb; border-radius:8px; padding:6px 8px; display:flex; align-items:center; justify-content:space-between; min-height:34px; }
  .sum-card span { color:#475569; font-size:8.5px; font-weight:900; text-transform:uppercase; }
  .sum-card strong { font-size:16px; color:#0f172a; }
  .sum-card.total { background:#eff6ff !important; border-color:#bfdbfe; }
  .sum-card.done { background:#f0fdf4 !important; border-color:#bbf7d0; }
  .sum-card.pending { background:#fffbeb !important; border-color:#fde68a; }
  .sum-card.notok { background:#fef2f2 !important; border-color:#fecaca; }
  table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; margin-top:7px; font-size:8.8px; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; }
  th { background:#0b3f73 !important; color:#fff !important; padding:5px 3px; text-align:left; font-size:8.4px; border-right:1px solid rgba(255,255,255,.25); }
  th:first-child { border-top-left-radius:8px; }
  th:last-child { border-top-right-radius:8px; border-right:0; }
  td { padding:4px 3px; border-right:1px solid #d1d5db; border-bottom:1px solid #d1d5db; vertical-align:top; word-break:break-word; line-height:1.18; }
  tr:nth-child(even) td { background:#f8fafc !important; }
  td:last-child { border-right:0; }
  tbody tr:last-child td { border-bottom:0; }
  .sr, .status-cell, .result-cell { text-align:center; }
  .point { font-weight:800; }
  .badge { display:inline-block; padding:2px 4px; border:1px solid; border-radius:999px; font-weight:900; font-size:7.1px; white-space:nowrap; }
  .obs-section { margin-top:10px; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px 10px; background:#fff !important; break-inside:avoid; }
  .section-head { color:#0f172a; font-size:11.5px; font-weight:900; margin-bottom:5px; }
  .observation-text { font-size:10px; line-height:1.35; padding:3px 0 6px; }
  .line { height:17px; border-bottom:1px solid #94a3b8; }
  .foot { padding:7px 15px 10px; color:#64748b; font-size:8.5px; display:flex; justify-content:space-between; }
  .empty-row { text-align:center; color:#64748b; padding:14px; }
  .no-print { padding:8px 15px; display:flex; justify-content:flex-end; }
  .print-btn { border:0; border-radius:8px; background:#0b3f73; color:#fff; padding:8px 12px; font-weight:900; }
  @media print {
    body { background:#fff !important; }
    .page { margin:0; max-width:none; box-shadow:none; border-radius:8px; }
    .no-print { display:none; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="app-head">
      <div class="brand"><img class="logo-img" src="${esc(logo)}" onerror="this.style.display='none'" /><div><div class="app-title">SP WorkTrack</div><div class="app-sub">Production Management System</div></div></div>
      <div><div class="report-title">Quality Checkpoint Report</div><div class="report-sub">Planned + completed checkpoints</div></div>
    </div>
    <div class="content">
      <div class="subtitle">Status, result, done by and done date are captured from production entries.</div>
      <div class="meta-grid">
        <div class="meta-card"><div class="label">Machine No</div><div class="value">${esc(data.machineNo)}</div></div>
        <div class="meta-card"><div class="label">Machine Category</div><div class="value">${esc(data.machineCategory)}</div></div>
        <div class="meta-card"><div class="label">Report Period</div><div class="value">${esc(period)}</div></div>
        <div class="meta-card"><div class="label">Generated On</div><div class="value">${esc(nowText())}</div></div>
      </div>
      <div class="sum-grid">
        <div class="sum-card total"><span>Total</span><strong>${data.summary.total}</strong></div>
        <div class="sum-card done"><span>Done</span><strong>${data.summary.done}</strong></div>
        <div class="sum-card pending"><span>Pending</span><strong>${data.summary.pending}</strong></div>
        <div class="sum-card done"><span>OK</span><strong>${data.summary.ok}</strong></div>
        <div class="sum-card notok"><span>Not OK</span><strong>${data.summary.notOk}</strong></div>
      </div>
      <table><thead><tr><th style="width:26px;">Sr</th><th style="width:20%;">Point</th><th style="width:13%;">Dept</th><th style="width:18%;">Sub Work</th><th style="width:10%;">Status</th><th style="width:9%;">Result</th><th style="width:16%;">Done By</th><th style="width:14%;">Done Date</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <section class="obs-section"><div class="section-head">Observations / Deviations / Remarks</div>${obs ? `<div class="observation-text">${esc(obs).replace(/\n/g, "<br>")}</div>` : ""}<div class="line"></div><div class="line"></div><div class="line"></div><div class="line"></div><div class="line"></div><div class="line"></div></section>
    </div>
    <div class="foot"><span>Generated from SP WorkTrack quality checkpoint data.</span><span>View-only report.</span></div>
    <div class="no-print"><button class="print-btn" onclick="window.print()">Print / Save PDF</button></div>
  </div>
</body>
</html>`;
  }

  function printPolishedReport() {
    const win = window.open("", "_blank", "width=850,height=900");
    if (!win) return alert("Popup blocked. Allow popups for SP WorkTrack.");
    win.document.open();
    win.document.write(buildPolishedPrintHtml());
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  function addObservation() {
    const text = prompt("Add observation / deviation / remarks for this quality report:", observationText || window.__SPWT_QUALITY_REPORT_OBSERVATION || "");
    if (text === null) return;
    observationText = text.trim();
    window.__SPWT_QUALITY_REPORT_OBSERVATION = observationText;
    alert(observationText ? "Observation added for next print/send." : "Observation cleared.");
  }

  function removeDownloadButton() {
    document.getElementById("downloadQualityReportBtn")?.remove();
  }

  function interceptClicks(e) {
    if (e.target?.closest?.("#downloadQualityReportBtn")) {
      e.preventDefault(); e.stopImmediatePropagation(); removeDownloadButton(); return;
    }
    if (e.target?.closest?.("#printQualityReportBtn")) {
      e.preventDefault(); e.stopImmediatePropagation(); printPolishedReport(); return;
    }
    if (e.target?.closest?.("#addQualityObservationBtn")) {
      e.preventDefault(); e.stopImmediatePropagation(); addObservation(); return;
    }
  }

  function init() { removeDownloadButton(); }

  document.addEventListener("click", interceptClicks, true);
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 700));
  document.addEventListener("click", () => setTimeout(init, 150), true);
})();
