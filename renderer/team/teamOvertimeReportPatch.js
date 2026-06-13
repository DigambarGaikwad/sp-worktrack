// renderer/team/teamOvertimeReportPatch.js
// Adds Overtime report popup with Print and Send features.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v ?? "").trim();

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[ch]));
  }

  async function requestJson(url, options = {}) {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(body?.message || `Request failed ${res.status}`);
    return body.data;
  }

  function setStatus(msg, bad = false) {
    let el = $("otReportStatus");
    const btn = $("showOvertimeReportBtn");
    if (!el && btn?.parentElement) {
      el = document.createElement("span");
      el.id = "otReportStatus";
      el.className = "section-subtitle";
      btn.parentElement.appendChild(el);
    }
    if (el) {
      el.textContent = msg || "";
      el.style.color = bad ? "#b91c1c" : "#64748b";
    }
  }

  function buildUrl() {
    const period = clean($("otReportPeriod")?.value || $("periodFilter")?.value || "selectedMonth");
    const params = new URLSearchParams({
      period,
      year: clean($("otReportYear")?.value || $("yearFilter")?.value || String(new Date().getFullYear())),
      month: clean($("otReportMonth")?.value || $("monthFilter")?.value || String(new Date().getMonth() + 1)),
      fromDate: clean($("otReportFromDate")?.value),
      toDate: clean($("otReportToDate")?.value)
    });
    return `${API_BASE_URL}/api/reports/overtime?${params.toString()}`;
  }

  function mountControls() {
    if ($("overtimeReportControls")) return;

            const filters = document.querySelector(".people-filters");
    if (!filters?.parentElement) return;

    const wrap = document.createElement("div");
    wrap.id = "overtimeReportControls";
    wrap.className = "people-filter-bar";
    wrap.style.marginTop = "10px";
    wrap.innerHTML = `
      <select class="people-select" id="otReportPeriod" title="Overtime Report Period">
        <option value="selectedMonth">OT Report: Selected Month</option>
        <option value="selectedYear">OT Report: Selected Year</option>
        <option value="selectedRange">OT Report: Selected Range</option>
      </select>
      <select class="people-select" id="otReportYear" title="Report Year"></select>
      <select class="people-select" id="otReportMonth" title="Report Month"></select>
      <input class="people-select" id="otReportFromDate" type="date" title="From Date">
      <input class="people-select" id="otReportToDate" type="date" title="To Date">
      <button class="people-btn" id="showOvertimeReportBtn" type="button">Show Overtime Report</button>
    `;

    filters.insertAdjacentElement("afterend", wrap);

    fillYearMonth();
    $("otReportPeriod")?.addEventListener("change", syncMonthVisibility);
    $("showOvertimeReportBtn")?.addEventListener("click", showReport);
    syncMonthVisibility();
  }

  function fillYearMonth() {
    const y = $("otReportYear");
    const m = $("otReportMonth");
    if (y && !y.options.length) {
      const now = new Date().getFullYear();
      for (let yr = now - 1; yr <= now + 1; yr++) {
        const opt = document.createElement("option");
        opt.value = String(yr);
        opt.textContent = String(yr);
        if (yr === now) opt.selected = true;
        y.appendChild(opt);
      }
    }
    if (m && !m.options.length) {
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      names.forEach((name, i) => {
        const opt = document.createElement("option");
        opt.value = String(i + 1);
        opt.textContent = name;
        if (i === new Date().getMonth()) opt.selected = true;
        m.appendChild(opt);
      });
    }
  }

  function syncMonthVisibility() {
    const period = $("otReportPeriod")?.value || "selectedMonth";
    const yearly = period === "selectedYear";
    const range = period === "selectedRange";

    const y = $("otReportYear");
    const m = $("otReportMonth");
    const f = $("otReportFromDate");
    const t = $("otReportToDate");

    if (y) y.style.display = range ? "none" : "";
    if (m) m.style.display = yearly || range ? "none" : "";
    if (f) f.style.display = range ? "" : "none";
    if (t) t.style.display = range ? "" : "none";
  }

  function mini(label, value, note = "") {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></div>`;
  }

  function reportHtml(report) {
    const s = report.summary || {};
    const empRows = Array.isArray(report.byEmployee) ? report.byEmployee : [];
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const employees = Array.isArray(report.byEmployee) ? report.byEmployee : [];

    const empHtml = empRows.map((r) => `
      <tr><td>${esc(r.empCode)}</td><td>${esc(r.empName)}</td><td>${esc(r.actualHours)}</td><td>${esc(r.standardHours)}</td><td>${esc(r.productivityPct)}%</td><td>${esc(r.entries)}</td></tr>
    `).join("");

        const detailHtml = employees.map((emp) => {
      const list = Array.isArray(emp.lines) ? emp.lines : [];
      return `
        <h2>${esc(emp.empCode || "")} - ${esc(emp.empName || "Unknown")}
          <span style="font-size:13px;color:#64748b;">Actual OT: ${esc(emp.actualHours)} hr | Standard: ${esc(emp.standardHours)} hr | Productivity: ${esc(emp.productivityPct)}% | Lines: ${esc(emp.lineCount || list.length)}</span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Machine</th><th>Category</th><th>Department</th><th>Sub Work</th><th>Description</th><th>Std Hr</th><th>Actual Hr</th><th>Eff %</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((r) => `<tr>
              <td>${esc(r.workDate)}</td>
              <td>${esc(r.machine)}</td>
              <td>${esc(r.machineCategory)}</td>
              <td>${esc(r.department)}</td>
              <td>${esc(r.subWork)}</td>
              <td>${esc(r.description)}</td>
              <td>${esc(r.standardHours)}</td>
              <td>${esc(r.actualHours)}</td>
              <td>${esc(r.productivityPct)}%</td>
            </tr>`).join("") || `<tr><td colspan="9">No line details.</td></tr>`}
          </tbody>
        </table>`;
    }).join("");

    return `<!DOCTYPE html><html><head><title>${esc(report.title)}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:0;background:#f3f6fb;color:#0f172a;padding:20px;}
        .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px;}
        .title{font-size:26px;font-weight:800;color:#0b3f73}.sub{color:#64748b;margin-top:4px}
        .actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:12px}
        .btn{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}.send{background:#16a34a;color:white}.print{background:#334155;color:white}
        .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:12px 0 18px}
        .kpi{background:white;border:1px solid #e2e8f0;border-radius:14px;padding:12px}.kpi-label{font-size:12px;color:#64748b}.kpi-value{font-size:22px;font-weight:800}.kpi-note{font-size:11px;color:#64748b}
        h2{font-size:18px;color:#0b3f73;border-bottom:2px solid #dbeafe;padding-bottom:6px;margin-top:18px}
        table{width:100%;border-collapse:collapse;background:white}th{background:#0b3f73;color:white}th,td{border:1px solid #cbd5e1;padding:7px;font-size:12px;text-align:left}
        @media print{.actions{display:none}body{background:white;padding:0}.kpi,table{break-inside:avoid}}
      </style></head><body>
      <div class="actions"><button class="btn send" id="sendOvertimeReportBtn">Send Report</button><button class="btn print" onclick="window.print()">Print Report</button></div>
      <div class="head"><div><div class="title">${esc(report.title)}</div><div class="sub">Period: ${esc(report.period)} | ${esc(report.fromDate)} to ${esc(report.toDate)}</div></div><div class="sub">Generated: ${esc(new Date().toLocaleString())}</div></div>
      <div class="grid">
        ${mini("Employees", s.employees)}
        ${mini("Entries", s.entries)}
        ${mini("Actual OT Hours", s.totalActualHours)}
        ${mini("Standard Hours", s.totalStandardHours)}
        ${mini("OT Productivity", `${s.productivityPct}%`)}
      </div>
      <h2>Employee Summary</h2>
      <table><thead><tr><th>Emp ID</th><th>Name</th><th>Actual OT Hours</th><th>Standard Hours</th><th>Productivity</th><th>Entries</th></tr></thead><tbody>${empHtml || `<tr><td colspan="6">No overtime records.</td></tr>`}</tbody></table>
      <h2>Employee Wise Work Details</h2>${detailHtml || `<table><tbody><tr><td>No overtime records.</td></tr></tbody></table>`}
      </body></html>`;
  }

  async function showReport() {
    const btn = $("showOvertimeReportBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Loading..."; }
      setStatus("");
      const period = clean($("otReportPeriod")?.value || "selectedMonth");
      if (period === "selectedRange" && (!clean($("otReportFromDate")?.value) || !clean($("otReportToDate")?.value))) {
        throw new Error("Select From Date and To Date for selected range overtime report.");
      }
      const report = await requestJson(buildUrl());
      const w = window.open("", "_blank");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open();
      w.document.write(reportHtml(report));
      w.document.close();
      setTimeout(() => {
        const sendBtn = w.document.getElementById("sendOvertimeReportBtn");
        if (sendBtn) sendBtn.addEventListener("click", () => sendReportFromPopup(w));
      }, 100);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Failed to open overtime report", true);
      alert("Overtime report failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Show Overtime Report"; }
    }
  }

  async function sendReportFromPopup(w) {
    const btn = w?.document?.getElementById("sendOvertimeReportBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
      const period = clean($("otReportPeriod")?.value || "selectedMonth");
      const payload = await requestJson(`${API_BASE_URL}/api/email/overtime-report/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          year: clean($("otReportYear")?.value || String(new Date().getFullYear())),
          month: clean($("otReportMonth")?.value || String(new Date().getMonth() + 1)),
          fromDate: clean($("otReportFromDate")?.value),
          toDate: clean($("otReportToDate")?.value),
          pdfHtml: w?.document?.documentElement?.outerHTML || ""
        })
      });
      alert(`Overtime report sent.\nTo: ${payload.mainRecipients}\nCC: ${payload.ccRecipients || "-"}`);
    } catch (err) {
      console.error(err);
      alert("Send failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Send Report"; }
    }
  }

  function boot() {
    mountControls();
    let tries = 0;
    const timer = setInterval(() => {
      mountControls();
      tries += 1;
      if ($("overtimeReportControls") || tries >= 30) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();






