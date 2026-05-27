// renderer/dashboard_v2/qualityReportDownloadPatch.js
// Adds Download Report button and sends/downloads stable styled quality report PDF.

(function () {
  const REQUEST_TIMEOUT_MS = 60000;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function displayDate(value) {
    const s = clean(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "-";
  }
  function nowText() { return new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
  function safeFilePart(value) { return clean(value || "Report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Report"; }

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
    return `<span class="badge" style="background:${bg};color:${color};border-color:${color};">${esc(label)}</span>`;
  }

  function buildStablePdfHtml() {
    const data = getReportData();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const obs = clean(window.__SPWT_QUALITY_REPORT_OBSERVATION || "");
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
  body { margin:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#111827; }
  .page { width:100%; max-width:820px; margin:0 auto; background:#fff; border:1px solid #111827; border-radius:12px; overflow:hidden; }
  .app-head { background:#111827 !important; color:white !important; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; border-bottom:4px solid #0b3f73; border-radius:12px 12px 0 0; }
  .app-title { font-size:22px; font-weight:900; line-height:1; color:#fff !important; }
  .app-sub { font-size:12px; margin-top:4px; color:#e5e7eb !important; }
  .report-title { font-size:16px; font-weight:900; text-align:right; color:#fff !important; }
  .report-sub { font-size:11px; margin-top:4px; color:#d1d5db !important; text-align:right; }
  .content { padding:12px 16px 10px; }
  .subtitle { color:#334155; font-size:11px; font-weight:800; margin-bottom:8px; }
  .meta-grid { display:grid; grid-template-columns: 1fr 1.25fr; gap:7px; }
  .meta-card { border:1px solid #dbe3ee; border-left:4px solid #0b3f73; border-radius:8px; padding:7px 9px; background:#f8fafc !important; min-height:44px; }
  .label { color:#64748b; font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:.35px; }
  .value { color:#111827; font-size:13px; font-weight:900; margin-top:3px; }
  .sum-grid { margin:10px 0; display:grid; grid-template-columns: repeat(5,1fr); gap:7px; }
  .sum-card { border:1px solid #e5e7eb; border-radius:8px; padding:7px 8px; display:flex; align-items:center; justify-content:space-between; min-height:36px; }
  .sum-card span { color:#475569; font-size:9px; font-weight:900; text-transform:uppercase; }
  .sum-card strong { font-size:17px; color:#0f172a; }
  .sum-card.total { background:#eff6ff !important; border-color:#bfdbfe; }
  .sum-card.done { background:#f0fdf4 !important; border-color:#bbf7d0; }
  .sum-card.pending { background:#fffbeb !important; border-color:#fde68a; }
  .sum-card.notok { background:#fef2f2 !important; border-color:#fecaca; }
  table { width:100%; border-collapse:separate; border-spacing:0; margin-top:7px; font-size:8.6px; table-layout:fixed; border:1px solid #d1d5db; border-radius:10px; overflow:hidden; }
  th { background:#0b3f73 !important; color:white !important; border-right:1px solid rgba(255,255,255,.25); padding:5px 3px; text-align:left; font-size:8.2px; }
  th:first-child { border-top-left-radius:10px; }
  th:last-child { border-top-right-radius:10px; border-right:0; }
  td { border-right:1px solid #d1d5db; border-bottom:1px solid #d1d5db; padding:4px 3px; vertical-align:top; word-break:break-word; line-height:1.18; }
  tr:nth-child(even) td { background:#f8fafc !important; }
  td:last-child { border-right:0; }
  tbody tr:last-child td { border-bottom:0; }
  .sr { text-align:center; }
  .point { font-weight:800; }
  .status-cell { text-align:center; }
  .result-cell { text-align:center; }
  .badge { display:inline-block; padding:2px 4px; border-radius:999px; border:1px solid; font-weight:900; font-size:6.9px; white-space:nowrap; max-width:100%; }
  .obs-section { margin-top:10px; border:1.2px solid #dbe3ee; border-radius:10px; padding:8px 10px 10px; break-inside:avoid; background:#ffffff !important; }
  .section-head { color:#0f172a; font-size:11.5px; font-weight:900; margin-bottom:6px; }
  .observation-text { font-size:10px; line-height:1.4; padding:3px 0 6px; }
  .line { height:17px; border-bottom:1px solid #94a3b8; }
  .foot { padding:7px 16px 10px; color:#64748b; font-size:8.7px; display:flex; justify-content:space-between; }
  .empty-row { text-align:center; color:#64748b; padding:14px; }
</style>
</head>
<body>
  <div class="page">
    <div class="app-head">
      <div><div class="app-title">SP WorkTrack</div><div class="app-sub">Production Management System</div></div>
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
  </div>
</body>
</html>`;
  }

  async function postPdf() {
    const data = getReportData();
    const res = await fetch(`${apiBaseUrl()}/api/email/quality-report/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineNo: data.machineNo, pdfHtml: buildStablePdfHtml() })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.message || `PDF API error ${res.status}`);
    }
    return await res.blob();
  }

  async function downloadQualityReport() {
    try {
      const data = getReportData();
      const blob = await postPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Quality_Report_${safeFilePart(data.machineNo)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download quality report failed: " + (err?.message || err));
    }
  }

  function wireDownloadButton() {
    const actions = document.querySelector(".quality-report-actions");
    if (!actions || document.getElementById("downloadQualityReportBtn")) return;
    const btn = document.createElement("button");
    btn.className = "qr-action-btn qr-action-download";
    btn.id = "downloadQualityReportBtn";
    btn.type = "button";
    btn.textContent = "Download Report";
    const printBtn = document.getElementById("printQualityReportBtn");
    actions.insertBefore(btn, printBtn || actions.firstChild);
    btn.addEventListener("click", downloadQualityReport);
  }

  async function sendStablePdfQualityReport() {
    const data = getReportData();
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;"><h2>SP WorkTrack Quality Report</h2><p><b>Machine:</b> ${esc(data.machineNo)}</p><p><b>Category:</b> ${esc(data.machineCategory)}</p><p><b>Period:</b> ${esc(displayDate(data.fromDate))} to ${esc(displayDate(data.toDate))}</p><p>Please find attached PDF report.</p></div>`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${apiBaseUrl()}/api/email/quality-report/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          machineNo: data.machineNo,
          machineCategory: data.machineCategory,
          period: `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`,
          html,
          pdfHtml: buildStablePdfHtml()
        })
      });
      clearTimeout(timer);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      alert("Quality report email sent successfully with PDF attachment.");
    } catch (err) {
      alert("Send quality report failed: " + (err?.message || err));
    }
  }

  function interceptSendClick(e) {
    if (!e.target?.closest?.("#sendQualityReportBtn")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sendStablePdfQualityReport();
  }

  function addStyles() {
    if (document.getElementById("qualityReportDownloadButtonStyles")) return;
    const style = document.createElement("style");
    style.id = "qualityReportDownloadButtonStyles";
    style.textContent = `.quality-report-actions .qr-action-download{background:#16a34a;color:#fff;}`;
    document.head.appendChild(style);
  }

  function init() {
    addStyles();
    wireDownloadButton();
  }

  document.addEventListener("click", interceptSendClick, true);
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 700));
  document.addEventListener("click", () => setTimeout(init, 150), true);
})();
