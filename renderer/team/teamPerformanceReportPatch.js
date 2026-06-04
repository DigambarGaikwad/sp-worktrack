// renderer/team/teamPerformanceReportPatch.js
// Adds printable employee performance report from People Dashboard.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 20000;

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function n(value) { const x = Number(value); return Number.isFinite(x) ? Number(x.toFixed(1)) : 0; }
  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
  function fmtPct(value) { return `${n(value)}%`; }
  function fmtHours(value) { return `${n(value)} hrs`; }

  async function requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "GET", signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data || {};
    } finally {
      clearTimeout(timer);
    }
  }

  function setReportStatus(message, type = "info") {
    let el = $("performanceReportStatus");
    const btn = $("showPerformanceReportBtn");
    if (!el && btn) {
      el = document.createElement("span");
      el.id = "performanceReportStatus";
      el.className = "small-hint";
      el.style.fontWeight = "900";
      btn.insertAdjacentElement("afterend", el);
    }
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function buildPeopleUrl(employee) {
    const period = clean($("periodFilter")?.value) || "yesterday";
    const year = clean($("yearFilter")?.value) || String(new Date().getFullYear());
    const month = clean($("monthFilter")?.value) || String(new Date().getMonth() + 1);
    const params = new URLSearchParams({
      period,
      shift: clean($("shiftFilter")?.value) || "All",
      department: clean($("departmentFilter")?.value) || "All",
      employee,
      year
    });
    if (period !== "selectedYear") params.set("month", month);
    return `${API_BASE_URL}/api/dashboard/people?${params.toString()}`;
  }

  function scoreLine(label, value, sign) {
    const color = sign === "-" ? "#b91c1c" : "#15803d";
    return `<tr><td>${esc(label)}</td><td style="text-align:right;color:${color};font-weight:900;">${sign}${esc(n(value))}</td></tr>`;
  }

  function kpi(label, value, note = "") {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></div>`;
  }

  function appraisalRemark(p) {
    const score = Number(p.score || 0);
    const unplanned = Number(p.unplannedAbsentDays || 0);
    const rework = Number(p.reworkHours || 0);
    if (score >= 85 && unplanned <= 1 && rework <= 2) return "Strong Performer: good output, discipline and low penalty impact.";
    if (score >= 70) return "Good Performer: stable contribution with scope to improve penalty areas.";
    if (unplanned >= 3) return "Needs Attention: unplanned absence is affecting performance score.";
    if (rework > 5) return "Needs Attention: rework hours are affecting performance score.";
    return "Review Required: productivity, attendance or penalty factors need improvement.";
  }

  function reportHtml(data, person) {
    const r = data.scoreRules || {};
    const b = person.scoreBreakdown?.details || {};
    const i = person.scoreInputs || {};
    const range = data.range || {};
    const periodLabel = `${range.label || data.period || "Selected Period"} (${range.from || "-"} to ${range.to || "-"})`;
    const positive = n((b.productivity || 0) + (b.utilization || 0) + (b.efficiency || 0) + (b.attendance || 0));
    const penalties = n((b.reworkPenalty || 0) + (b.otherWorkPenalty || 0) + (b.unplannedAbsentPenalty || 0) + (b.plannedAbsentPenalty || 0) + (b.plannedExtraPenalty || 0));

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Performance Report - ${esc(person.name)}</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827;}
  .page{max-width:1050px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.12);}
  .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #e5e7eb;padding-bottom:14px;}
  .title{font-size:26px;font-weight:900;color:#0b3f73;}.sub{color:#64748b;margin-top:4px;}.score{font-size:34px;font-weight:900;color:#15803d;text-align:right;}.score small{display:block;font-size:12px;color:#64748b;}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0;}.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f8fafc;}.kpi-label{font-size:12px;color:#64748b;font-weight:800;}.kpi-value{font-size:21px;font-weight:900;margin-top:4px;}.kpi-note{font-size:11px;color:#64748b;margin-top:4px;}
  .section{margin-top:18px;}.section h2{font-size:18px;color:#0b3f73;border-bottom:1px solid #e5e7eb;padding-bottom:6px;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}th{background:#0b3f73;color:#fff;text-align:left;padding:9px;}td{padding:9px;border-bottom:1px solid #e5e7eb;} .remark{background:#ecfdf5;border-left:5px solid #15803d;border-radius:10px;padding:12px;font-weight:800;line-height:1.45;}
  .actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:14px;}.btn{border:0;border-radius:10px;padding:10px 16px;font-weight:900;cursor:pointer;}.print{background:#15803d;color:#fff;}.close{background:#e5e7eb;color:#111827;}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.actions{display:none}.grid{grid-template-columns:repeat(4,1fr)}}
</style>
</head>
<body>
<div class="page">
  <div class="actions"><button class="btn print" onclick="window.print()">Print Report</button><button class="btn close" onclick="window.close()">Close</button></div>
  <div class="head">
    <div><div class="title">Employee Performance Report</div><div class="sub">${esc(periodLabel)}</div><div class="sub">Generated: ${esc(new Date().toLocaleString("en-IN"))}</div></div>
    <div class="score">${esc(person.score)}<small>Final Score</small></div>
  </div>

  <div class="grid">
    ${kpi("Employee", person.name || "-", person.code || "")}
    ${kpi("Department", person.department || "-", "")}
    ${kpi("Positive Marks", positive, "Before penalties")}
    ${kpi("Penalty Marks", penalties, "Score reduction")}
    ${kpi("Productivity", fmtPct(i.productivityPct ?? person.yesterdayProductivityPct), "Std output / available")}
    ${kpi("Utilization", fmtPct(i.utilizationPct), "Actual / available")}
    ${kpi("Efficiency", fmtPct(i.efficiencyPct ?? person.efficiencyPct), "Std output / actual")}
    ${kpi("Attendance", fmtPct(i.attendancePct), "Present days / working days")}
    ${kpi("Present Days", person.presentDays || 0, "Selected period")}
    ${kpi("Absent Days", person.absentDays || 0, `Planned ${person.plannedAbsentDays || 0}, Unplanned ${person.unplannedAbsentDays || 0}`)}
    ${kpi("Rework", fmtHours(person.reworkHours), "Penalty activity")}
    ${kpi("Other Work", fmtHours(person.otherWorkHours), "Support/non-production")}
  </div>

  <div class="section"><h2>Score Breakdown</h2>
    <table><thead><tr><th>Score Factor</th><th style="text-align:right;">Marks</th></tr></thead><tbody>
      ${scoreLine("Productivity Marks", b.productivity, "+")}
      ${scoreLine("Utilization Marks", b.utilization, "+")}
      ${scoreLine("Efficiency Marks", b.efficiency, "+")}
      ${scoreLine("Attendance Marks", b.attendance, "+")}
      ${scoreLine("Rework Penalty", b.reworkPenalty, "-")}
      ${scoreLine("Other Work Penalty", b.otherWorkPenalty, "-")}
      ${scoreLine("Unplanned Leave Penalty", b.unplannedAbsentPenalty, "-")}
      ${scoreLine("Planned Leave Penalty", b.plannedAbsentPenalty, "-")}
      ${scoreLine("Extra Planned Leave Penalty", b.plannedExtraPenalty, "-")}
      <tr><td><b>Final Score</b></td><td style="text-align:right;font-weight:900;">${esc(person.score)}</td></tr>
    </tbody></table>
  </div>

  <div class="section"><h2>Admin Score Rules Used</h2>
    <table><tbody>
      <tr><td>Positive marks total</td><td>${esc(n((r.productivityWeight || 0) + (r.utilizationWeight || 0) + (r.efficiencyWeight || 0) + (r.attendanceWeight || 0)))}</td></tr>
      <tr><td>Productivity / Utilization / Efficiency / Attendance</td><td>${esc(r.productivityWeight)} / ${esc(r.utilizationWeight)} / ${esc(r.efficiencyWeight)} / ${esc(r.attendanceWeight)}</td></tr>
      <tr><td>Unplanned leave penalty</td><td>-${esc(r.unplannedAbsentPenaltyPerDay)} per day</td></tr>
      <tr><td>Planned leave allowed</td><td>${esc(r.plannedLeaveAllowedPerYear)} days per year; extra penalty -${esc(r.plannedExtraPenaltyPerDay)} per day</td></tr>
      <tr><td>Rework / Other work penalty</td><td>-${esc(r.reworkPenaltyPerHour)} per rework hour / -${esc(r.otherWorkPenaltyPerHour)} per other work hour</td></tr>
    </tbody></table>
  </div>

  <div class="section"><h2>Appraisal Remark</h2><div class="remark">${esc(appraisalRemark(person))}</div></div>
</div>
</body>
</html>`;
  }

  async function showReport() {
    try {
      const employee = clean($("employeeFilter")?.value);
      if (!employee || employee === "All") {
        setReportStatus("Select one employee first.", "error");
        $("employeeFilter")?.classList.add("entry-error");
        setTimeout(() => $("employeeFilter")?.classList.remove("entry-error"), 1800);
        return;
      }

      setReportStatus("Preparing performance report...");
      const btn = $("showPerformanceReportBtn");
      if (btn) { btn.disabled = true; btn.textContent = "Preparing Report..."; }
      const data = await requestJson(buildPeopleUrl(employee));
      const person = (data.employees || []).find(p => clean(p.name) === employee || clean(p.code) === employee) || (data.employees || [])[0];
      if (!person) throw new Error("No performance data found for selected employee and period.");

      const w = window.open("", "_blank", "width=1100,height=850");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open();
      w.document.write(reportHtml(data, person));
      w.document.close();
      setReportStatus("Report opened.", "success");
    } catch (err) {
      setReportStatus("Report failed: " + (err?.message || err), "error");
    } finally {
      const btn = $("showPerformanceReportBtn");
      if (btn) { btn.disabled = false; btn.textContent = "Show Performance Report"; }
    }
  }

  function ensureButton() {
    const filters = document.querySelector(".people-filters");
    const refresh = $("refreshPeopleBtn");
    if (!filters || !refresh || $("showPerformanceReportBtn")) return;

    const btn = document.createElement("button");
    btn.className = "people-btn";
    btn.id = "showPerformanceReportBtn";
    btn.type = "button";
    btn.textContent = "Show Performance Report";
    btn.addEventListener("click", showReport);
    refresh.insertAdjacentElement("afterend", btn);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureButton, 600));
  setInterval(ensureButton, 1500);
})();
