// renderer/team/teamPlannedAbsentReportPatch.js
// Adds printable planned absence report for selected People Dashboard period.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 20000;

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  async function requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "GET", signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function setStatus(message, type = "info") {
    let el = $("plannedAbsentReportStatus");
    const btn = $("showPlannedAbsentReportBtn");
    if (!el && btn) {
      el = document.createElement("span");
      el.id = "plannedAbsentReportStatus";
      el.className = "small-hint";
      el.style.fontWeight = "900";
      btn.insertAdjacentElement("afterend", el);
    }
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function peopleUrl() {
    const period = clean($("periodFilter")?.value) || "yesterday";
    const year = clean($("yearFilter")?.value) || String(new Date().getFullYear());
    const month = clean($("monthFilter")?.value) || String(new Date().getMonth() + 1);
    const params = new URLSearchParams({
      period,
      shift: clean($("shiftFilter")?.value) || "All",
      department: clean($("departmentFilter")?.value) || "All",
      employee: clean($("employeeFilter")?.value) || "All",
      year
    });
    if (period !== "selectedYear") params.set("month", month);
    return `${API_BASE_URL}/api/dashboard/people?${params.toString()}`;
  }

  function overlaps(row, range) {
    const from = clean(row.from_date || row.fromDate);
    const to = clean(row.to_date || row.toDate || from);
    return from && to && from <= range.to && to >= range.from;
  }

  function clampDate(value, min, max) {
    const v = clean(value);
    if (!v) return "";
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function calcVisibleDays(row, range) {
    const from = clampDate(row.from_date, range.from, range.to);
    const to = clampDate(row.to_date || row.from_date, range.from, range.to);
    if (!from || !to || from > to) return 0;
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    let d = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    let days = 0;
    while (d <= end) {
      if (d.getDay() !== 0) days += 1;
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  function reportHtml(rows, data) {
    const range = data.range || {};
    const title = `${range.label || data.period || "Selected Period"} (${range.from || "-"} to ${range.to || "-"})`;
    const totalDays = rows.reduce((s, r) => s + Number(r.visibleDays || 0), 0);
    const uniqueEmployees = new Set(rows.map(r => clean(r.emp_code || r.emp_name).toLowerCase()).filter(Boolean)).size;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Planned Absence Report</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827;}
  .page{max-width:1120px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.12);}
  .actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:14px;}.btn{border:0;border-radius:10px;padding:10px 16px;font-weight:900;cursor:pointer;}.print{background:#15803d;color:#fff;}.close{background:#e5e7eb;color:#111827;}
  .head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e5e7eb;padding-bottom:14px;}.title{font-size:26px;font-weight:900;color:#0b3f73;}.sub{color:#64748b;margin-top:4px;}.count{font-size:30px;font-weight:900;color:#15803d;text-align:right;}.count small{display:block;font-size:12px;color:#64748b;}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0;}.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f8fafc;}.kpi-label{font-size:12px;color:#64748b;font-weight:800;}.kpi-value{font-size:22px;font-weight:900;margin-top:4px;}
  table{width:100%;border-collapse:collapse;margin-top:14px;}th{background:#0b3f73;color:#fff;text-align:left;padding:9px;font-size:13px;}td{padding:9px;border-bottom:1px solid #e5e7eb;font-size:13px;vertical-align:top;}.empty{padding:18px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;font-weight:800;text-align:center;}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.actions{display:none}}
</style>
</head>
<body>
<div class="page">
  <div class="actions"><button class="btn print" onclick="window.print()">Print Report</button><button class="btn close" onclick="window.close()">Close</button></div>
  <div class="head">
    <div><div class="title">Planned Absence Report</div><div class="sub">${esc(title)}</div><div class="sub">Generated: ${esc(new Date().toLocaleString("en-IN"))}</div></div>
    <div class="count">${esc(rows.length)}<small>Planned Records</small></div>
  </div>
  <div class="grid">
    <div class="kpi"><div class="kpi-label">Planned Employees</div><div class="kpi-value">${esc(uniqueEmployees)}</div></div>
    <div class="kpi"><div class="kpi-label">Planned Days in Selected Period</div><div class="kpi-value">${esc(totalDays)}</div></div>
    <div class="kpi"><div class="kpi-label">Period</div><div class="kpi-value">${esc(range.label || data.period || "-")}</div></div>
  </div>
  ${rows.length ? `<table><thead><tr><th>Employee</th><th>Department</th><th>Planned From</th><th>Planned To</th><th>Visible in Period</th><th>Days</th><th>Reason</th><th>Remark</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.emp_name || "-")}</b><br><span style="color:#64748b;">${esc(r.emp_code || "")}</span></td><td>${esc(r.department || "-")}</td><td>${esc(r.from_date || "-")}</td><td>${esc(r.to_date || r.from_date || "-")}</td><td>${esc(r.visibleFrom)} to ${esc(r.visibleTo)}</td><td style="font-weight:900;">${esc(r.visibleDays)}</td><td>${esc(r.reason || "-")}</td><td>${esc(r.remark || "-")}</td><td>${esc(r.status || "Planned")}</td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">No planned absence found in selected period.</div>`}
</div>
</body>
</html>`;
  }

  async function showReport() {
    try {
      setStatus("Preparing planned absence report...");
      const btn = $("showPlannedAbsentReportBtn");
      if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }

      const peoplePayload = await requestJson(peopleUrl());
      const data = peoplePayload.data || peoplePayload;
      const range = data.range || {};
      if (!range.from || !range.to) throw new Error("Selected period range not available.");

      const plannedPayload = await requestJson(`${API_BASE_URL}/api/admin/planned-absences`);
      let rows = Array.isArray(plannedPayload.items) ? plannedPayload.items : [];
      const dept = clean($("departmentFilter")?.value) || "All";
      const employee = clean($("employeeFilter")?.value) || "All";

      rows = rows
        .filter(r => !["cancelled", "canceled", "deleted"].includes(clean(r.status).toLowerCase()))
        .filter(r => overlaps(r, range))
        .filter(r => dept === "All" || clean(r.department) === dept)
        .filter(r => employee === "All" || clean(r.emp_name) === employee || clean(r.emp_code) === employee)
        .map(r => ({
          ...r,
          visibleFrom: clampDate(r.from_date, range.from, range.to),
          visibleTo: clampDate(r.to_date || r.from_date, range.from, range.to),
          visibleDays: calcVisibleDays(r, range)
        }))
        .sort((a, b) => clean(a.visibleFrom).localeCompare(clean(b.visibleFrom)) || clean(a.emp_name).localeCompare(clean(b.emp_name)));

      const w = window.open("", "_blank", "width=1150,height=850");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open();
      w.document.write(reportHtml(rows, data));
      w.document.close();
      setStatus(`Planned absence report opened. ${rows.length} record(s).`, "success");
    } catch (err) {
      setStatus("Planned absence report failed: " + (err?.message || err), "error");
    } finally {
      const btn = $("showPlannedAbsentReportBtn");
      if (btn) { btn.disabled = false; btn.textContent = "Show Planned Absence Report"; }
    }
  }

  function ensureButton() {
    const anchor = $("showPerformanceReportBtn") || $("refreshPeopleBtn");
    if (!anchor || $("showPlannedAbsentReportBtn")) return;

    const btn = document.createElement("button");
    btn.className = "people-btn";
    btn.id = "showPlannedAbsentReportBtn";
    btn.type = "button";
    btn.textContent = "Show Planned Absence Report";
    btn.addEventListener("click", showReport);
    anchor.insertAdjacentElement("afterend", btn);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureButton, 800));
  setInterval(ensureButton, 1500);
})();
