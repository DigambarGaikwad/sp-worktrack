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
      return new URL(`../../assets/${fileName}`, window.location.href).href;
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
    const border = label.includes("NOT OK") ? "#b91c1c" : label === "PENDING" ? "#b45309" : "#15803d";
    return `<span class="badge" style="border-color:${border};color:${color};">${esc(label)}</span>`;
  }

  function emailBadge(status, value) {
    const s = clean(status || value || "PENDING").toUpperCase();
    const label = s || "PENDING";
    const color = label.includes("NOT OK") ? "#b91c1c" : label === "PENDING" ? "#b45309" : "#15803d";
    return `<span style="display:inline-block;border:1px solid ${color};border-radius:10px;padding:2px 6px;color:${color};font-weight:700;font-size:10px;white-space:nowrap;">${esc(label)}</span>`;
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
        <div class="line"></div>
        <div class="line"></div>
        <div class="line"></div>
      </section>`;
  }

  function buildEmailReportHtml() {
    const data = getReportData();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const obs = clean(qualityReportObservation);
    const border = "1px solid #cbd5e1";
    const th = `padding:7px 6px;border:${border};background:#0b3f73;color:#ffffff;font-size:12px;text-align:left;`;
    const td = `padding:7px 6px;border:${border};font-size:12px;color:#111827;vertical-align:top;`;
    const label = `font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#475569;font-weight:700;`;
    const value = `font-size:14px;color:#111827;font-weight:700;margin-top:2px;`;

    const rowsHtml = data.rows.map((r, index) => {
      const status = clean(r.status) || (clean(r.value) ? "DONE" : "PENDING");
      return `
        <tr>
          <td style="${td};text-align:center;width:34px;">${index + 1}</td>
          <td style="${td};font-weight:700;">${esc(r.point || r.qualityPoint || "-")}</td>
          <td style="${td}">${esc(r.department || "-")}</td>
          <td style="${td}">${esc(r.subwork || r.subWork || "-")}</td>
          <td style="${td}">${emailBadge(status, r.value)}</td>
          <td style="${td}">${esc(r.value || r.readingStatus || "-")}</td>
          <td style="${td}">${esc(r.empName || r.doneByName || r.empCode || "-")}</td>
          <td style="${td}">${esc(displayDate(r.workDate || r.doneDate))}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="8" style="${td};text-align:center;">No quality checkpoint data available</td></tr>`;

    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:16px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:760px;max-width:760px;background:#ffffff;border:1px solid #111827;border-collapse:collapse;">
          <tr>
            <td style="background:#111827;color:#ffffff;padding:14px 16px;border-bottom:3px solid #0b3f73;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#ffffff;font-size:22px;font-weight:800;line-height:1.1;">SP WorkTrack<br><span style="font-size:12px;font-weight:400;color:#e5e7eb;">Production Management System</span></td>
                  <td align="right" style="color:#ffffff;font-size:18px;font-weight:800;line-height:1.1;">Quality Checkpoint Report<br><span style="font-size:12px;font-weight:400;color:#e5e7eb;">Planned + completed checkpoints</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 16px;">
              <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:10px;">Status, result, done by and done date are captured from production entries.</div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:10px;">
                <tr>
                  <td width="50%" style="padding:7px;border:1px solid #94a3b8;border-left:4px solid #0b3f73;"><div style="${label}">Machine No</div><div style="${value}">${esc(data.machineNo)}</div></td>
                  <td width="50%" style="padding:7px;border:1px solid #94a3b8;border-left:4px solid #0b3f73;"><div style="${label}">Machine Category</div><div style="${value}">${esc(data.machineCategory)}</div></td>
                </tr>
                <tr>
                  <td width="50%" style="padding:7px;border:1px solid #94a3b8;border-left:4px solid #0b3f73;"><div style="${label}">Report Period</div><div style="${value}">${esc(period)}</div></td>
                  <td width="50%" style="padding:7px;border:1px solid #94a3b8;border-left:4px solid #0b3f73;"><div style="${label}">Generated On</div><div style="${value}">${esc(nowText())}</div></td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:5px;margin-bottom:10px;">
                <tr>
                  <td style="border:1px solid #1d4ed8;padding:7px;"><span style="${label}">Total</span><span style="float:right;font-size:18px;font-weight:800;">${data.summary.total}</span></td>
                  <td style="border:1px solid #15803d;padding:7px;"><span style="${label}">Done</span><span style="float:right;font-size:18px;font-weight:800;">${data.summary.done}</span></td>
                  <td style="border:1px solid #b45309;padding:7px;"><span style="${label}">Pending</span><span style="float:right;font-size:18px;font-weight:800;">${data.summary.pending}</span></td>
                  <td style="border:1px solid #15803d;padding:7px;"><span style="${label}">OK</span><span style="float:right;font-size:18px;font-weight:800;">${data.summary.ok}</span></td>
                  <td style="border:1px solid #b91c1c;padding:7px;"><span style="${label}">Not OK</span><span style="float:right;font-size:18px;font-weight:800;">${data.summary.notOk}</span></td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #0b3f73;">
                <thead>
                  <tr><th style="${th};width:34px;">Sr</th><th style="${th}">Point</th><th style="${th}">Dept</th><th style="${th}">Sub Work</th><th style="${th}">Status</th><th style="${th}">Result</th><th style="${th}">Done By</th><th style="${th}">Done Date</th></tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>

              <div style="margin-top:14px;border:1px solid #64748b;padding:10px;">
                <div style="font-size:13px;font-weight:800;margin-bottom:8px;">Observations / Deviations / Remarks</div>
                ${obs ? `<div style="font-size:12px;line-height:1.5;margin-bottom:8px;">${esc(obs).replace(/\n/g, "<br>")}</div>` : ""}
                <div style="height:18px;border-bottom:1px solid #94a3b8;"></div>
                <div style="height:18px;border-bottom:1px solid #94a3b8;"></div>
                <div style="height:18px;border-bottom:1px solid #94a3b8;"></div>
              </div>

              <div style="font-size:11px;color:#64748b;margin-top:12px;">Generated from SP WorkTrack quality checkpoint data.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  function buildReportHtml() {
    const data = getReportData();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const logo = assetUrl("logo%20(2).png") || assetUrl("app.ico");
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
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body { margin:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#111827; }
  .page { max-width: 820px; margin: 12px auto; background:#ffffff; border:1px solid #111827; border-radius:8px; overflow:hidden; }
  .app-head { background:#111827 !important; color:#ffffff !important; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:3px solid #0b3f73; }
  .brand { display:flex; align-items:center; gap:10px; min-width:0; }
  .logo-img { width:86px; height:36px; object-fit:contain; background:#111827 !important; border:0; border-radius:3px; flex:0 0 auto; padding:0; }
  .app-title { font-size:18px; font-weight:800; line-height:1; letter-spacing:.15px; color:#ffffff !important; }
  .app-sub { font-size:10.5px; margin-top:3px; color:#e5e7eb !important; }
  .header-report-title { font-size:13.5px; font-weight:800; text-align:right; letter-spacing:.2px; white-space:nowrap; color:#ffffff !important; }
  .header-report-sub { font-size:9.6px; color:#d1d5db !important; margin-top:3px; text-align:right; }
  .content { padding:10px 14px 10px; }
  .subtitle { color:#334155; font-size:10px; font-weight:700; margin-bottom:6px; }
  .meta-grid { display:grid; grid-template-columns: 1fr 1.25fr; gap:5px; margin-top:5px; }
  .meta-card { border:1px solid #94a3b8; border-left:3px solid #0b3f73; border-radius:5px; padding:4px 7px; background:#ffffff !important; min-height:32px; }
  .label { color:#475569; font-size:8.2px; font-weight:800; text-transform:uppercase; letter-spacing:.24px; }
  .value { color:#111827; font-size:11px; font-weight:800; margin-top:2px; line-height:1.12; }
  .sum-grid { margin:7px 0 7px; display:grid; grid-template-columns: repeat(5,1fr); gap:5px; }
  .sum-card { border:1.4px solid #64748b; border-radius:5px; padding:4px 6px; background:#ffffff !important; display:flex; align-items:center; justify-content:space-between; min-height:28px; }
  .sum-card strong { font-size:15px; color:#0f172a; }
  .sum-card span { color:#334155; font-size:8px; font-weight:800; text-transform:uppercase; letter-spacing:.18px; }
  .sum-card.total { border-color:#1d4ed8; }
  .sum-card.done { border-color:#15803d; }
  .sum-card.pending { border-color:#b45309; }
  .sum-card.notok { border-color:#b91c1c; }
  table { width:100%; border-collapse:collapse; margin-top:5px; font-size:8.8px; table-layout:fixed; border:1.4px solid #0b3f73; }
  th { background:#ffffff !important; color:#0b3f73 !important; border:1.4px solid #0b3f73 !important; padding:4px 3px; text-align:left; font-size:8.4px; letter-spacing:.04px; }
  td { border:1px solid #cbd5e1; padding:4px 3px; vertical-align:top; word-break:break-word; line-height:1.16; color:#111827; }
  tr:nth-child(even) td { background:#ffffff !important; }
  .sr { text-align:center; }
  .point { font-weight:700; }
  .badge { display:inline-block; padding:1.5px 4px; border:1.2px solid; border-radius:999px; font-weight:800; font-size:7.4px; white-space:nowrap; background:#ffffff !important; }
  .empty-row { text-align:center; color:#64748b; padding:14px; }
  .obs-section { margin-top:9px; border:1.2px solid #64748b; border-radius:6px; padding:6px 8px 8px; break-inside:avoid; }
  .section-head { color:#0f172a; font-size:10.5px; font-weight:800; margin-bottom:4px; }
  .observation-text { font-size:9.7px; color:#111827; padding:3px 0 5px; line-height:1.32; }
  .line { height:16px; border-bottom:1px solid #94a3b8; }
  .foot { padding:6px 14px 9px; color:#475569; font-size:8.2px; display:flex; justify-content:space-between; gap:8px; }
  .no-print { padding:8px 14px; display:flex; justify-content:flex-end; gap:8px; }
  .print-btn { border:1px solid #0b3f73; background:#ffffff !important; color:#0b3f73 !important; border-radius:6px; padding:7px 11px; font-weight:800; cursor:pointer; }
  @media print {
    body { background:#ffffff !important; }
    .page { margin:0; max-width:none; box-shadow:none; border-radius:0; border:1px solid #111827; }
    .no-print { display:none; }
    .content { padding:8px 7px 7px; }
    .app-head { padding:7px 8px; }
    .meta-grid, .sum-grid { gap:4px; }
    .meta-card { min-height:30px; padding:3px 5px; }
    .value { font-size:10.5px; }
    th, td { padding:3.4px 2.8px; }
    .line { height:15px; }
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
      <div><div class="header-report-title">Quality Checkpoint Report</div><div class="header-report-sub">Planned + completed checkpoints</div></div>
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
      <table>
        <thead><tr><th style="width:26px;">Sr</th><th style="width:20%;">Point</th><th style="width:13%;">Dept</th><th style="width:19%;">Sub Work</th><th style="width:8%;">Status</th><th style="width:8%;">Result</th><th style="width:18%;">Done By</th><th style="width:14%;">Done Date</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${buildRuledLines()}
    </div>
    <div class="foot"><span>Generated from SP WorkTrack quality checkpoint data.</span><span>View-only report.</span></div>
    <div class="no-print"><button class="print-btn" onclick="window.print()">Print / Save PDF</button></div>
  </div>
</body>
</html>`;
  }

  function printQualityReport() {
    const html = buildReportHtml();
    const win = window.open("", "_blank", "width=850,height=900");
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
    const html = buildEmailReportHtml();
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

  function addQualityReportButtonStyles() {
    if (document.getElementById("qualityReportButtonStyles")) return;
    const style = document.createElement("style");
    style.id = "qualityReportButtonStyles";
    style.textContent = `
      .quality-report-actions { align-items: center; justify-content: flex-end; margin-left: auto; }
      .quality-report-actions .qr-action-btn { border: 0; border-radius: 10px; padding: 7px 11px; min-height: 32px; font-size: 12px; line-height: 1; font-weight: 800; letter-spacing: .1px; cursor: pointer; transition: transform .14s ease, box-shadow .14s ease, opacity .14s ease; box-shadow: 0 6px 14px rgba(15, 23, 42, .08); white-space: nowrap; }
      .quality-report-actions .qr-action-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(15, 23, 42, .13); }
      .quality-report-actions .qr-action-btn:active { transform: translateY(0); box-shadow: 0 5px 10px rgba(15, 23, 42, .10); }
      .quality-report-actions .qr-action-secondary { background: #e5e7eb; color: #111827; }
      .quality-report-actions .qr-action-primary { background: #0b3f73; color: #ffffff; }
      .quality-report-actions .qr-action-send { background: #f97316; color: #ffffff; }
    `;
    document.head.appendChild(style);
  }

  function addButtons() {
    const heads = Array.from(document.querySelectorAll(".panel-head"));
    const target = heads.find(h => clean(h.querySelector("h2")?.textContent) === "Quality Point Checklist");
    if (!target || target.querySelector("#printQualityReportBtn")) return;

    addQualityReportButtonStyles();

    const actions = document.createElement("div");
    actions.className = "quality-report-actions";
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.flexWrap = "wrap";
    actions.innerHTML = `
      <button class="qr-action-btn qr-action-secondary" id="addQualityObservationBtn" type="button">Add Observation</button>
      <button class="qr-action-btn qr-action-primary" id="printQualityReportBtn" type="button">Print Quality Report</button>
      <button class="qr-action-btn qr-action-send" id="sendQualityReportBtn" type="button">Send Quality Report</button>
    `;
    target.appendChild(actions);
    document.getElementById("addQualityObservationBtn")?.addEventListener("click", addObservation);
    document.getElementById("printQualityReportBtn")?.addEventListener("click", printQualityReport);
    document.getElementById("sendQualityReportBtn")?.addEventListener("click", sendQualityReport);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(addButtons, 500));
  document.addEventListener("click", () => setTimeout(addButtons, 100), true);
})();
