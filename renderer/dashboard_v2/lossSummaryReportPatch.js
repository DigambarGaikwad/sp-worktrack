// renderer/dashboard_v2/lossSummaryReportPatch.js
// Adds printable/sendable Loss Summary report for Rework, Other, Major Loss and Unplanned Absent.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 30000;
  let latestReport = null;
  let latestHtml = "";

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function num(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function displayDate(value) {
    const s = clean(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "-";
  }
  function nowText() { return new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
  function assetUrl(fileName) { try { return new URL(`../../assets/${fileName}`, window.location.href).href; } catch (_) { return ""; } }

  function addStyles() {
    if ($("lossSummaryReportStyles")) return;
    const style = document.createElement("style");
    style.id = "lossSummaryReportStyles";
    style.textContent = `
      .loss-summary-panel .loss-summary-kpis { display:grid; grid-template-columns:repeat(5,minmax(145px,1fr)); gap:12px; }
      .loss-summary-panel .loss-box.purple { background:#f2ecff; color:#7e57c2; }
      .loss-summary-panel .loss-box.navy { background:#eaf2ff; color:#0b3f73; }
      .loss-report-actions { align-items:center; justify-content:flex-end; margin-left:auto; }
      .loss-report-actions .qr-action-btn { border:0; border-radius:10px; padding:7px 11px; min-height:32px; font-size:12px; line-height:1; font-weight:800; cursor:pointer; box-shadow:0 6px 14px rgba(15,23,42,.08); white-space:nowrap; }
      .loss-report-actions .qr-action-primary { background:#0b3f73; color:#fff; }
      .loss-report-actions .qr-action-send { background:#f97316; color:#fff; }
      @media (max-width:1200px){ .loss-summary-panel .loss-summary-kpis { grid-template-columns:repeat(2,minmax(145px,1fr)); } }
      @media (max-width:700px){ .loss-summary-panel .loss-summary-kpis { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data || payload;
    } finally { clearTimeout(timer); }
  }

  function selectedLossUrl() {
    const range = clean($("lossRangeSelect")?.value || "currentMonth");
    const from = clean($("lossFromDate")?.value || "");
    const to = clean($("lossToDate")?.value || "");
    if (range === "custom" && from && to) return `${API_BASE_URL}/api/dashboard/loss-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return `${API_BASE_URL}/api/dashboard/loss-summary?range=${encodeURIComponent(range)}`;
  }

  function setStatus(message, type = "info") {
    let el = $("lossReportStatus");
    const btn = $("printLossReportBtn");
    if (!el && btn) {
      el = document.createElement("span");
      el.id = "lossReportStatus";
      el.className = "small-hint";
      el.style.fontWeight = "900";
      btn.insertAdjacentElement("afterend", el);
    }
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function updateKpis(data) {
    const s = data?.summary || {};
    if ($("lossUnplannedAbsentHours")) $("lossUnplannedAbsentHours").textContent = num(s.unplannedAbsentHours).toFixed(2);
    if ($("lossTotalHours")) $("lossTotalHours").textContent = num(s.totalLossHours).toFixed(2);
  }

  async function refreshAugmentedKpis() {
    try {
      const data = await requestJson(selectedLossUrl());
      latestReport = data;
      updateKpis(data);
    } catch (err) {
      console.warn("Loss report KPI refresh failed:", err);
    }
  }

  function tableRows(rows = []) {
    return rows.length ? rows.map(r => `
      <tr>
        <td>${esc(displayDate(r.workDate))}</td>
        <td>${esc(r.type || "-")}</td>
        <td>${esc(r.machineNo || "-")}</td>
        <td>${esc(r.department || "-")}</td>
        <td>${esc(r.subwork || "-")}</td>
        <td>${esc(r.rootArea || "-")}</td>
        <td class="reason-cell">${esc(r.reason || "-")}</td>
        <td style="text-align:right;font-weight:900;">${num(r.hours).toFixed(2)}</td>
        <td>${esc(r.empName || r.empCode || "-")}</td>
      </tr>`).join("") : `<tr><td colspan="9" class="empty">No loss records found for selected period.</td></tr>`;
  }

  function groupRows(rows = []) {
    return rows.length ? rows.map(r => `<tr><td>${esc(r.name || "-")}</td><td style="text-align:right;">${num(r.count)}</td><td style="text-align:right;font-weight:900;">${num(r.hours).toFixed(2)}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">No records found.</td></tr>`;
  }

  function kpi(label, value, note = "") {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>${note ? `<div class="kpi-note">${esc(note)}</div>` : ""}</div>`;
  }

  function reportHtml(data = {}) {
    const s = data.summary || {};
    const range = data.range || {};
    const logo = assetUrl("logo%20(2).png") || assetUrl("app.ico");
    const title = "Loss Summary Report";
    const period = `${range.label || "Selected Period"} (${displayDate(range.from)} to ${displayDate(range.to)})`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>${esc(title)}</title><style>
      @page{size:A4 landscape;margin:8mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827}.page{max-width:1220px;margin:16px auto;background:#fff;border:1px solid #111827;border-radius:10px;overflow:hidden}.app-head{background:#111827;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0b3f73}.brand{display:flex;gap:10px;align-items:center}.logo-img{width:86px;height:36px;object-fit:contain}.app-title{font-size:18px;font-weight:900}.app-sub{font-size:10px;color:#e5e7eb}.report-title{text-align:right;font-size:16px;font-weight:900}.report-sub{font-size:10px;color:#e5e7eb;margin-top:3px}.actions{padding:9px 14px;display:flex;justify-content:flex-end;gap:8px}.btn{border:0;border-radius:8px;padding:8px 12px;font-weight:900;cursor:pointer}.print{background:#15803d;color:#fff}.send{background:#0b3f73;color:#fff}.close{background:#e5e7eb;color:#111827}.content{padding:12px 14px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.meta-card{border:1px solid #94a3b8;border-left:4px solid #0b3f73;border-radius:6px;padding:7px;background:#fff}.label{font-size:9px;color:#475569;text-transform:uppercase;font-weight:900}.value{font-size:12px;font-weight:900;margin-top:2px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0}.kpi{border:1.4px solid #cbd5e1;border-radius:8px;padding:8px;background:#f8fafc}.kpi-label{font-size:10px;color:#475569;text-transform:uppercase;font-weight:900}.kpi-value{font-size:20px;font-weight:900;color:#0b3f73;margin-top:2px}.kpi-note{font-size:9px;color:#64748b;margin-top:2px}h2{font-size:14px;color:#0b3f73;margin:12px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#0b3f73;color:#fff;text-align:left;padding:6px;border:1px solid #0b3f73}td{padding:6px;border:1px solid #dbe3ee;vertical-align:top}.split{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.reason-cell{min-width:220px;line-height:1.35}.empty{text-align:center;color:#64748b;font-weight:900;padding:12px}.foot{font-size:9px;color:#64748b;padding:8px 14px;border-top:1px solid #cbd5e1;display:flex;justify-content:space-between}@media print{body{background:#fff}.page{max-width:none;margin:0;border-radius:0}.actions{display:none}.content{padding:8px}.grid{gap:5px}.kpi{padding:6px}td,th{padding:4px;font-size:8.8px}.reason-cell{min-width:180px}}
    </style></head><body><div class="page"><div class="app-head"><div class="brand"><img class="logo-img" src="${esc(logo)}" onerror="this.style.display='none'"/><div><div class="app-title">SP WorkTrack</div><div class="app-sub">Production & Performance Management System</div></div></div><div><div class="report-title">${esc(title)}</div><div class="report-sub">Rework • Other Work • Major Loss • Unplanned Absent</div></div></div><div class="actions"><button class="btn send" id="sendLossReportFromPopup">Send Report</button><button class="btn print" onclick="window.print()">Print / Save PDF</button><button class="btn close" onclick="window.close()">Close</button></div><div class="content"><div class="meta"><div class="meta-card"><div class="label">Report Period</div><div class="value">${esc(period)}</div></div><div class="meta-card"><div class="label">Generated On</div><div class="value">${esc(nowText())}</div></div><div class="meta-card"><div class="label">Records</div><div class="value">${esc((data.details || []).length)}</div></div></div><div class="grid">${kpi("Total Loss Hours", num(s.totalLossHours).toFixed(2))}${kpi("Rework Hours", num(s.reworkHours).toFixed(2))}${kpi("Other Work Hours", num(s.otherHours).toFixed(2))}${kpi("Major Loss Hours", num(s.majorLossHours).toFixed(2))}${kpi("Unplanned Absent", num(s.unplannedAbsentHours).toFixed(2), `${num(s.unplannedAbsentDays)} day(s)`)}</div><h2>Loss Type Summary</h2><table><thead><tr><th>Type</th><th>Count</th><th>Hours</th></tr></thead><tbody>${groupRows(data.byType || [])}</tbody></table><div class="split"><div><h2>Rework by Root Area</h2><table><thead><tr><th>Root Area</th><th>Count</th><th>Hours</th></tr></thead><tbody>${groupRows(data.rework?.byRootArea || [])}</tbody></table></div><div><h2>Major Loss by Reason</h2><table><thead><tr><th>Reason</th><th>Count</th><th>Hours</th></tr></thead><tbody>${groupRows(data.majorLoss?.byReason || [])}</tbody></table></div><div><h2>Unplanned Absent by Employee</h2><table><thead><tr><th>Employee</th><th>Days</th><th>Hours</th></tr></thead><tbody>${groupRows(data.unplannedAbsent?.byEmployee || [])}</tbody></table></div></div><h2>All Loss Details</h2><table><thead><tr><th>Date</th><th>Type</th><th>Machine</th><th>Dept</th><th>Sub Work</th><th>Root Area</th><th>Reason</th><th>Hours</th><th>Employee</th></tr></thead><tbody>${tableRows(data.details || [])}</tbody></table></div><div class="foot"><span>Generated from SP WorkTrack loss summary data.</span><span>Period: ${esc(period)}</span></div></div></body></html>`;
  }

  async function getReportData() {
    const data = await requestJson(selectedLossUrl());
    latestReport = data;
    latestHtml = reportHtml(data);
    updateKpis(data);
    return data;
  }

  async function printReport() {
    try {
      setStatus("Preparing loss report...");
      const data = await getReportData();
      const w = window.open("", "_blank", "width=1220,height=850");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open();
      w.document.write(latestHtml);
      w.document.close();
      setTimeout(() => {
        try { w.document.getElementById("sendLossReportFromPopup")?.addEventListener("click", () => sendReport()); } catch (_) {}
      }, 300);
      setStatus(`Loss report opened for ${data.range?.label || "selected period"}.`, "success");
    } catch (err) {
      setStatus("Loss report failed: " + (err?.message || err), "error");
      alert("Loss report failed: " + (err?.message || err));
    }
  }

  async function sendReport() {
    try {
      if (!latestReport || !latestHtml) await getReportData();
      setStatus("Sending loss report...");
      const period = `${latestReport.range?.label || "Selected Period"} (${displayDate(latestReport.range?.from)} to ${displayDate(latestReport.range?.to)})`;
      const payload = await requestJson(`${API_BASE_URL}/api/email/rework-other-report/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: "Loss Summary", period, machine: "All", html: latestHtml, pdfHtml: latestHtml })
      });
      setStatus(`Loss report sent to ${payload.mainRecipients?.length || 0} main recipient(s).`, "success");
      alert("Loss report sent successfully.");
    } catch (err) {
      setStatus("Send failed: " + (err?.message || err), "error");
      alert("Send failed: " + (err?.message || err));
    }
  }

  function addButtons() {
    addStyles();
    const panel = document.querySelector(".loss-summary-panel .panel-head");
    if (!panel || $("printLossReportBtn")) return;
    const actions = document.createElement("div");
    actions.className = "loss-report-actions";
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.flexWrap = "wrap";
    actions.innerHTML = `
      <button class="qr-action-btn qr-action-primary" id="printLossReportBtn" type="button">Print Loss Report</button>
      <button class="qr-action-btn qr-action-send" id="sendLossReportBtn" type="button">Send Loss Report</button>
    `;
    panel.appendChild(actions);
    $("printLossReportBtn")?.addEventListener("click", printReport);
    $("sendLossReportBtn")?.addEventListener("click", sendReport);
  }

  function wireApplyRefresh() {
    const btn = $("lossApplyBtn");
    if (btn && !btn.__lossReportPatchWired) {
      btn.__lossReportPatchWired = true;
      btn.addEventListener("click", () => setTimeout(refreshAugmentedKpis, 900));
    }
  }

  function init() { addButtons(); wireApplyRefresh(); refreshAugmentedKpis(); }
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1200));
  document.addEventListener("click", () => setTimeout(() => { addButtons(); wireApplyRefresh(); }, 200), true);
  setInterval(() => { addButtons(); wireApplyRefresh(); }, 1500);
})();
