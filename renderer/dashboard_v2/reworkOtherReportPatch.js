// renderer/dashboard_v2/reworkOtherReportPatch.js
// Adds Rework / Other Work report to Machine Dashboard using machine dashboard filters.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 25000;
  let latestReport = null;
  let latestHtml = "";

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

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

  function setStatus(message, type = "info") {
    let el = $("rwOtherMachineReportStatus");
    const btn = $("showRwOtherMachineReportBtn");
    if (!el && btn) {
      el = document.createElement("span");
      el.id = "rwOtherMachineReportStatus";
      el.className = "small-hint";
      el.style.fontWeight = "900";
      btn.insertAdjacentElement("afterend", el);
    }
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function focusField(id) {
    const field = $(id);
    if (!field) return;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      field.focus();
      field.classList.add("entry-error");
      setTimeout(() => field.classList.remove("entry-error"), 1800);
    }, 250);
  }

  function validateSelection() {
    const type = clean($("rwOtherType")?.value);
    const period = clean($("rwOtherPeriod")?.value);
    const year = clean($("rwOtherYear")?.value);
    const month = clean($("rwOtherMonth")?.value);
    const machineOptions = Array.from($("rwOtherMachine")?.options || []);

    if (!type) { setStatus("Select report type first.", "error"); focusField("rwOtherType"); return false; }
    if (!period) { setStatus("Select report period first.", "error"); focusField("rwOtherPeriod"); return false; }
    if (!year) { setStatus("Select year first.", "error"); focusField("rwOtherYear"); return false; }
    if (period !== "selectedYear" && !month) { setStatus("Select month first.", "error"); focusField("rwOtherMonth"); return false; }
    if (machineOptions.length <= 1) { setStatus("Machine list is not loaded. Click Refresh, then try again.", "error"); focusField("machineFilter"); return false; }
    return true;
  }

  function getMachineValue() {
    return clean($("rwOtherMachine")?.value || $("machineFilter")?.value || "All") || "All";
  }

  function reportUrl() {
    const params = new URLSearchParams({
      type: clean($("rwOtherType")?.value || "rework"),
      period: clean($("rwOtherPeriod")?.value || "selectedMonth"),
      year: clean($("rwOtherYear")?.value || String(new Date().getFullYear())),
      month: clean($("rwOtherMonth")?.value || String(new Date().getMonth() + 1)),
      machine: getMachineValue()
    });
    return `${API_BASE_URL}/api/reports/rework-other?${params.toString()}`;
  }

  function ensureControls() {
    const host = document.querySelector(".dash-topbar .filter-bar") || document.querySelector(".filter-bar");
    const machineFilter = $("machineFilter");
    if (!host || !machineFilter || $("showRwOtherMachineReportBtn")) return;

    const box = document.createElement("div");
    box.id = "rwOtherMachineReportControls";
    box.style.display = "contents";
    box.innerHTML = `
      <select class="dash-select" id="rwOtherType"><option value="rework">Report: Rework</option><option value="other">Report: Other Work</option></select>
      <select class="dash-select" id="rwOtherPeriod"><option value="selectedMonth">Selected Month</option><option value="selectedYear">Selected Year</option></select>
      <select class="dash-select" id="rwOtherYear"></select>
      <select class="dash-select" id="rwOtherMonth"></select>
      <select class="dash-select" id="rwOtherMachine"><option value="All">Machine: All</option></select>
      <button class="dash-btn primary" id="showRwOtherMachineReportBtn" type="button">Show Work Nature Report</button>
    `;
    host.appendChild(box);
    fillYearMonth();
    syncMachineOptions();
    $("rwOtherPeriod")?.addEventListener("change", syncMonthVisibility);
    $("machineFilter")?.addEventListener("change", syncMachineOptions);
    $("refreshBtn")?.addEventListener("click", () => setTimeout(syncMachineOptions, 900));
    $("showRwOtherMachineReportBtn")?.addEventListener("click", showReport);
    syncMonthVisibility();
  }

  function fillYearMonth() {
    const y = $("rwOtherYear"), m = $("rwOtherMonth");
    if (y && !y.options.length) {
      const current = new Date().getFullYear();
      y.innerHTML = Array.from({ length: 6 }, (_, i) => current - i).map(v => `<option value="${v}">Year: ${v}</option>`).join("");
    }
    if (m && !m.options.length) {
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      m.innerHTML = names.map((name, i) => `<option value="${i + 1}" ${i === new Date().getMonth() ? "selected" : ""}>Month: ${name}</option>`).join("");
    }
  }

  function syncMonthVisibility() {
    const m = $("rwOtherMonth");
    if (m) m.style.display = $("rwOtherPeriod")?.value === "selectedYear" ? "none" : "";
  }

  function syncMachineOptions() {
    const src = $("machineFilter"), dst = $("rwOtherMachine");
    if (!src || !dst) return;
    const current = dst.value || src.value || "All";
    dst.innerHTML = Array.from(src.options).map(o => `<option value="${esc(o.value)}">${esc(o.textContent || o.value)}</option>`).join("");
    dst.value = Array.from(dst.options).some(o => o.value === current) ? current : (src.value || "All");
  }

  function mini(label, value, color = "#0b3f73") { return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value" style="color:${color};">${esc(value)}</div></div>`; }

  function descriptionText(r) {
    return clean(r.remark) || clean(r.description) || "-";
  }

  function tableRows(rows) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.workDate)}</td><td>${esc(r.machine)}</td><td>${esc(r.empName)}<br><span class="muted">${esc(r.empCode)}</span></td><td>${esc(r.department)}</td><td>${esc(r.subWork)}</td><td>${esc(r.rootArea || "-")}</td><td class="description-cell">${esc(descriptionText(r))}</td><td style="text-align:right;font-weight:900;">${esc(r.actualHours)}</td></tr>`).join("")
      : `<tr><td colspan="8" class="empty">No records found.</td></tr>`;
  }

  function reportHtml(data) {
    const title = data.title || "Work Nature Report";
    const range = data.range || {};
    const k = data.kpis || {};
    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>${esc(title)}</title><style>
      body{font-family:Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827}.page{max-width:1220px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.12)}.actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:14px}.btn{border:0;border-radius:10px;padding:10px 16px;font-weight:900;cursor:pointer}.print{background:#15803d;color:#fff}.send{background:#0b3f73;color:#fff}.close{background:#e5e7eb;color:#111827}.head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e5e7eb;padding-bottom:14px}.title{font-size:26px;font-weight:900;color:#0b3f73}.sub{color:#64748b;margin-top:4px}.count{font-size:30px;font-weight:900;color:#b91c1c;text-align:right}.count small{display:block;font-size:12px;color:#64748b}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f8fafc}.kpi-label{font-size:12px;color:#64748b;font-weight:800}.kpi-value{font-size:22px;font-weight:900;margin-top:4px}h2{font-size:18px;color:#0b3f73;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-top:20px}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#0b3f73;color:#fff;text-align:left;padding:9px;font-size:12px}td{padding:9px;border-bottom:1px solid #e5e7eb;font-size:12px;vertical-align:top}.muted{color:#64748b}.description-cell{min-width:280px;max-width:520px;white-space:normal;line-height:1.45}.empty{text-align:center;color:#64748b;font-weight:900;padding:18px}@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.actions{display:none}.grid{grid-template-columns:repeat(5,1fr)}.description-cell{min-width:260px}}
    </style></head><body><div class="page"><div class="actions"><button class="btn send" id="sendRwOtherReportFromPopup">Send Report</button><button class="btn print" onclick="window.print()">Print Report</button><button class="btn close" onclick="window.close()">Close</button></div><div class="head"><div><div class="title">${esc(title)}</div><div class="sub">Period: ${esc(range.label || "-")} (${esc(range.from || "-")} to ${esc(range.to || "-")})</div><div class="sub">Machine: ${esc(data.machine || "All")}</div><div class="sub">Generated: ${esc(new Date().toLocaleString("en-IN"))}</div></div><div class="count">${esc(k.records || 0)}<small>Records</small></div></div><div class="grid">${mini("Total Actual Hours", k.totalActualHours || 0, "#b91c1c")}${mini("Total Std Hours", k.totalStandardHours || 0, "#b45309")}${mini("Machines", k.machines || 0)}${mini("Employees", k.employees || 0)}${mini("Report Type", title)}</div><h2>Machine Summary</h2><table><thead><tr><th>Machine</th><th>Records</th><th>Std Hours</th><th>Actual Hours</th></tr></thead><tbody>${(data.byMachine || []).map(r => `<tr><td>${esc(r.machine)}</td><td>${esc(r.count)}</td><td>${esc(r.standardHours)}</td><td style="font-weight:900;">${esc(r.actualHours)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No records found.</td></tr>`}</tbody></table><h2>Employee Summary</h2><table><thead><tr><th>Employee</th><th>Records</th><th>Std Hours</th><th>Actual Hours</th></tr></thead><tbody>${(data.byEmployee || []).map(r => `<tr><td>${esc(r.empName)} <span class="muted">${esc(r.empCode)}</span></td><td>${esc(r.count)}</td><td>${esc(r.standardHours)}</td><td style="font-weight:900;">${esc(r.actualHours)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No records found.</td></tr>`}</tbody></table><h2>Detailed Records</h2><table><thead><tr><th>Date</th><th>Machine</th><th>Employee</th><th>Department</th><th>Sub Work</th><th>Root Area</th><th>Description</th><th>Actual Hrs</th></tr></thead><tbody>${tableRows(data.rows || [])}</tbody></table></div></body></html>`;
  }

  async function showReport() {
    try {
      syncMachineOptions();
      if (!validateSelection()) return;
      setStatus("Preparing report...");
      const btn = $("showRwOtherMachineReportBtn");
      if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }
      const data = await requestJson(reportUrl());
      if (!data?.rows?.length) {
        setStatus("No records found for this selection. Change period, machine or report type.", "error");
        focusField("rwOtherMachine");
        return;
      }
      latestReport = data;
      latestHtml = reportHtml(data);
      const w = window.open("", "_blank", "width=1200,height=850");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open(); w.document.write(latestHtml); w.document.close();
      setTimeout(() => { try { w.document.getElementById("sendRwOtherReportFromPopup")?.addEventListener("click", () => sendReport()); } catch {} }, 300);
      setStatus(`${data.title} opened.`, "success");
    } catch (err) { setStatus("Report failed: " + (err?.message || err), "error"); focusField("showRwOtherMachineReportBtn"); }
    finally { const btn = $("showRwOtherMachineReportBtn"); if (btn) { btn.disabled = false; btn.textContent = "Show Work Nature Report"; } }
  }

  async function sendReport() {
    try {
      if (!latestReport || !latestHtml) { latestReport = await requestJson(reportUrl()); latestHtml = reportHtml(latestReport); }
      setStatus("Sending report...");
      const payload = await requestJson(`${API_BASE_URL}/api/email/rework-other-report/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportType: latestReport.reportType, period: latestReport.range?.label || "Selected Period", machine: latestReport.machine || "All", html: latestHtml, pdfHtml: latestHtml }) });
      setStatus(`Report sent to ${payload.mainRecipients?.length || 0} main recipient(s).`, "success");
      alert("Report sent successfully.");
    } catch (err) { setStatus("Send failed: " + (err?.message || err), "error"); alert("Send failed: " + (err?.message || err)); }
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureControls, 1000));
  document.addEventListener("click", () => setTimeout(ensureControls, 200), true);
  setInterval(ensureControls, 1500);
})();
