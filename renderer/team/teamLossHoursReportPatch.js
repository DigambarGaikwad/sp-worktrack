// renderer/team/teamLossHoursReportPatch.js
// Opens a detailed Loss Hours report from the People Dashboard Loss Hours KPI card.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 25000;
  let latestReport = null;
  let latestHtml = "";

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
  function n(value) { const x = Number(value); return Number.isFinite(x) ? Number(x.toFixed(1)) : 0; }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const fullUrl = /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
      const res = await fetch(fullUrl, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data || payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function reportUrl() {
    const period = clean($("periodFilter")?.value) || "yesterday";
    const year = clean($("yearFilter")?.value) || String(new Date().getFullYear());
    const month = clean($("monthFilter")?.value) || String(new Date().getMonth() + 1);
    const params = new URLSearchParams({
      period,
      year,
      shift: clean($("shiftFilter")?.value) || "All",
      department: clean($("departmentFilter")?.value) || "All",
      employee: clean($("employeeFilter")?.value) || "All"
    });
    if (period !== "selectedYear") params.set("month", month);
    return `${API_BASE_URL}/api/reports/loss-hours?${params.toString()}`;
  }

  function setStatus(message, type = "info") {
    let el = $("lossHoursReportStatus");
    const card = document.querySelector(".loss-hours-kpi-clickable");
    if (!el && card) {
      el = document.createElement("div");
      el.id = "lossHoursReportStatus";
      el.className = "small-hint";
      el.style.fontWeight = "900";
      el.style.marginTop = "6px";
      card.appendChild(el);
    }
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function mini(label, value, color = "#0b3f73") {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value" style="color:${color};">${esc(value)}</div></div>`;
  }

  function reasonRows(rows = []) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.name || "Not Specified")}</td><td>${esc(r.count || 0)}</td><td style="text-align:right;font-weight:900;">${esc(r.hours || 0)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No reason summary found.</td></tr>`;
  }

  function employeeRows(rows = []) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.employee || "-")}</td><td>${esc(r.count || 0)}</td><td style="text-align:right;font-weight:900;">${esc(r.hours || 0)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No employee summary found.</td></tr>`;
  }

  function dateRows(rows = []) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.workDate || "-")}</td><td>${esc(r.count || 0)}</td><td style="text-align:right;font-weight:900;">${esc(r.hours || 0)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No date summary found.</td></tr>`;
  }

  function detailRows(rows = []) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.workDate || "-")}</td><td>${esc(r.empName || "-")}<br><span class="muted">${esc(r.empCode || "")}</span></td><td>${esc(r.department || "-")}</td><td>${esc(r.shift || "-")}</td><td>${esc(r.reason || "Not Specified")}</td><td>${esc(r.remark || "-")}</td><td style="text-align:right;font-weight:900;">${esc(r.lossHours || 0)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">No loss hour records found.</td></tr>`;
  }

  function reportHtml(data = {}) {
    const title = data.title || "Loss Hours Report";
    const range = data.range || {};
    const filters = data.filters || {};
    const k = data.kpis || {};
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>${esc(title)}</title><style>
      @page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827}.page{max-width:1220px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.12)}.actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:14px}.btn{border:0;border-radius:10px;padding:10px 16px;font-weight:900;cursor:pointer}.print{background:#15803d;color:#fff}.send{background:#0b3f73;color:#fff}.close{background:#e5e7eb;color:#111827}.head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e5e7eb;padding-bottom:14px}.title{font-size:26px;font-weight:900;color:#0b3f73}.sub{color:#64748b;margin-top:4px}.count{font-size:30px;font-weight:900;color:#b45309;text-align:right}.count small{display:block;font-size:12px;color:#64748b}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f8fafc}.kpi-label{font-size:12px;color:#64748b;font-weight:800}.kpi-value{font-size:22px;font-weight:900;margin-top:4px}h2{font-size:18px;color:#0b3f73;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-top:20px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;margin-top:10px;page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}th{background:#0b3f73;color:#fff;text-align:left;padding:9px;font-size:12px}td{padding:9px;border-bottom:1px solid #e5e7eb;font-size:12px;vertical-align:top}.muted{color:#64748b}.empty{text-align:center;color:#64748b;font-weight:900;padding:18px}@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.actions{display:none}.grid{grid-template-columns:repeat(5,1fr)}}
    </style></head><body><div class="page">
      <div class="actions"><button class="btn send" id="sendLossHoursReportFromPopup" type="button">Send Report</button><button class="btn print" onclick="window.print()" type="button">Print Report</button><button class="btn close" onclick="window.close()" type="button">Close</button></div>
      <div class="head"><div><div class="title">${esc(title)}</div><div class="sub">Period: ${esc(range.label || "-")} (${esc(range.from || "-")} to ${esc(range.to || "-")})</div><div class="sub">Shift: ${esc(filters.shift || "All")} | Department: ${esc(filters.department || "All")} | Employee: ${esc(filters.employee || "All")}</div><div class="sub">Generated: ${esc(new Date().toLocaleString("en-IN"))}</div></div><div class="count">${esc(k.totalLossHours || 0)}<small>Loss Hours</small></div></div>
      <div class="grid">${mini("Records", k.records || 0)}${mini("Total Loss Hours", k.totalLossHours || 0, "#b45309")}${mini("Employees", k.employees || 0)}${mini("Loss Reasons", k.reasons || 0)}${mini("Average / Record", n(k.averageLossHours || 0))}</div>
      <h2>Major Loss by Reason</h2><div class="table-wrap"><table><thead><tr><th>Reason</th><th>Records</th><th style="text-align:right;">Hours</th></tr></thead><tbody>${reasonRows(data.byReason || [])}</tbody></table></div>
      <h2>Employee Summary</h2><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Records</th><th style="text-align:right;">Hours</th></tr></thead><tbody>${employeeRows(data.byEmployee || [])}</tbody></table></div>
      <h2>Date Summary</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Records</th><th style="text-align:right;">Hours</th></tr></thead><tbody>${dateRows(data.byDate || [])}</tbody></table></div>
      <h2>Detailed Loss Records</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Shift</th><th>Reason</th><th>Remark</th><th style="text-align:right;">Hours</th></tr></thead><tbody>${detailRows(data.rows || [])}</tbody></table></div>
    </div></body></html>`;
  }

  async function sendReport() {
    try {
      if (!latestReport || !latestHtml) {
        latestReport = await requestJson(reportUrl());
        latestHtml = reportHtml(latestReport);
      }
      if (!latestReport?.rows?.length) throw new Error("No loss hour records available to send.");
      setStatus("Sending Loss Hours report...");
      const payload = await requestJson("/api/email/rework-other-report/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: "loss-hours",
          period: latestReport.range?.label || "Selected Period",
          machine: "All",
          html: latestHtml,
          pdfHtml: latestHtml,
          filters: latestReport.filters || {}
        })
      });
      setStatus(`Loss Hours report sent to ${payload.mainRecipients?.length || payload.sent || 0} main recipient(s).`, "success");
      alert("Loss Hours report sent successfully.");
    } catch (err) {
      setStatus("Send failed: " + (err?.message || err), "error");
      alert("Send failed: " + (err?.message || err));
    }
  }

  async function openLossHoursReport() {
    try {
      setStatus("Preparing Loss Hours report...");
      const data = await requestJson(reportUrl());
      if (!Array.isArray(data.rows) || !data.rows.length) { alert("No loss hour records found for this selection."); setStatus(""); return; }
      latestReport = data;
      latestHtml = reportHtml(data);
      const w = window.open("", "_blank", "width=1200,height=850");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open();
      w.document.write(latestHtml);
      w.document.close();
      setTimeout(() => { try { w.document.getElementById("sendLossHoursReportFromPopup")?.addEventListener("click", () => sendReport()); } catch {} }, 300);
      setStatus("Loss Hours report opened.", "success");
    } catch (err) {
      console.error("Loss hours report failed:", err);
      setStatus("Report failed: " + (err?.message || err), "error");
      alert("Loss hours report failed: " + (err?.message || err));
    }
  }

  function markLossCard() {
    document.querySelectorAll(".kpi-card").forEach((card) => {
      const label = clean(card.querySelector(".kpi-label")?.textContent).toLowerCase();
      if (label !== "loss hours" || card.__spwtLossReportWired) return;
      card.__spwtLossReportWired = true;
      card.classList.add("loss-hours-kpi-clickable", "attendance-kpi-clickable");
      card.title = "Click to view detailed Loss Hours report";
      card.addEventListener("click", openLossHoursReport);
    });
  }

  function injectStyles() {
    if ($("lossHoursReportPatchStyles")) return;
    const style = document.createElement("style");
    style.id = "lossHoursReportPatchStyles";
    style.textContent = `.loss-hours-kpi-clickable{cursor:pointer;position:relative;overflow:hidden}.loss-hours-kpi-clickable::after{content:'↗';position:absolute;top:14px;right:18px;opacity:.28;font-size:18px;font-weight:1000}.loss-hours-kpi-clickable:hover{transform:translateY(-2px);filter:brightness(1.02)}.loss-hours-kpi-clickable:active{transform:translateY(1px) scale(.98);filter:brightness(.96)}`;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    markLossCard();
    document.addEventListener("click", () => setTimeout(markLossCard, 100), true);
    setInterval(markLossCard, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
