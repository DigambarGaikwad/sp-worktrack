// renderer/team/teamLossHoursReportPatch.js
// Opens a detailed Loss Hours report from the People Dashboard Loss Hours KPI card.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  let currentReportData = null;

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
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

  async function requestJson(path, options = {}) {
    const res = await fetch(`${API_BASE_URL}${path}`, options);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
    return payload;
  }

  async function requestReport() {
    const res = await fetch(reportUrl(), { method: "GET" });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
    return payload.data || {};
  }

  function mini(label, value) {
    return `<div class="loss-report-kpi"><div>${esc(label)}</div><strong>${esc(value)}</strong></div>`;
  }

  function reasonRows(rows) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.count)}</td><td class="num">${esc(r.hours)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No reason summary found.</td></tr>`;
  }

  function employeeRows(rows) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.employee)}</td><td>${esc(r.count)}</td><td class="num">${esc(r.hours)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="empty">No employee summary found.</td></tr>`;
  }

  function detailRows(rows) {
    return rows.length
      ? rows.map(r => `<tr><td>${esc(r.workDate)}</td><td>${esc(r.empName)}<br><span>${esc(r.empCode)}</span></td><td>${esc(r.department)}</td><td>${esc(r.shift)}</td><td>${esc(r.reason || "Not Specified")}</td><td>${esc(r.remark || "-")}</td><td class="num">${esc(r.lossHours)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">No loss hour records found.</td></tr>`;
  }

  function ensureModal() {
    if ($("lossHoursReportModal")) return;
    const div = document.createElement("div");
    div.id = "lossHoursReportModal";
    div.className = "loss-report-backdrop";
    div.innerHTML = `
      <div class="loss-report-card">
        <div class="loss-report-actions">
          <span class="loss-report-status" id="lossReportSendStatus"></span>
          <button class="loss-report-btn send" id="lossReportSendBtn" type="button">Send Report</button>
          <button class="loss-report-btn print" id="lossReportPrintBtn" type="button">Print Report</button>
          <button class="loss-report-btn close" id="lossReportCloseBtn" type="button">Close</button>
        </div>
        <div class="loss-report-head">
          <div>
            <div class="loss-report-title" id="lossReportTitle">Loss Hours Report</div>
            <div class="loss-report-sub" id="lossReportPeriod"></div>
            <div class="loss-report-sub" id="lossReportFilters"></div>
            <div class="loss-report-sub" id="lossReportGenerated"></div>
          </div>
          <div class="loss-report-count"><span id="lossReportHours">0</span><small>Loss Hours</small></div>
        </div>
        <div class="loss-report-grid" id="lossReportKpis"></div>
        <h2>Major Loss by Reason</h2>
        <div class="loss-report-table-wrap"><table><thead><tr><th>Reason</th><th>Records</th><th class="num">Hours</th></tr></thead><tbody id="lossReportReasonBody"></tbody></table></div>
        <h2>Employee Summary</h2>
        <div class="loss-report-table-wrap"><table><thead><tr><th>Employee</th><th>Records</th><th class="num">Hours</th></tr></thead><tbody id="lossReportEmployeeBody"></tbody></table></div>
        <h2>Detailed Loss Records</h2>
        <div class="loss-report-table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Shift</th><th>Reason</th><th>Remark</th><th class="num">Hours</th></tr></thead><tbody id="lossReportDetailBody"></tbody></table></div>
      </div>`;
    document.body.appendChild(div);
    $("lossReportCloseBtn")?.addEventListener("click", closeReport);
    $("lossReportPrintBtn")?.addEventListener("click", () => window.print());
    $("lossReportSendBtn")?.addEventListener("click", sendLossHoursReport);
    div.addEventListener("click", (event) => { if (event.target === div) closeReport(); });
  }

  function injectStyles() {
    if ($("lossHoursReportPatchStyles")) return;
    const style = document.createElement("style");
    style.id = "lossHoursReportPatchStyles";
    style.textContent = `
      .loss-hours-kpi-clickable{cursor:pointer;position:relative;overflow:hidden}.loss-hours-kpi-clickable::after{content:'↗';position:absolute;top:14px;right:18px;opacity:.28;font-size:18px;font-weight:1000}.loss-hours-kpi-clickable:hover{transform:translateY(-2px);filter:brightness(1.02)}.loss-hours-kpi-clickable:active{transform:translateY(1px) scale(.98);filter:brightness(.96)}
      .loss-report-backdrop{display:none;position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:99999;overflow:auto;padding:22px}.loss-report-backdrop.show{display:block}.loss-report-card{max-width:1220px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.24);color:#111827}.loss-report-actions{display:flex;justify-content:flex-end;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap}.loss-report-status{margin-right:auto;font-size:13px;font-weight:900;color:#64748b}.loss-report-status.ok{color:#15803d}.loss-report-status.err{color:#b91c1c}.loss-report-btn{border:0;border-radius:10px;padding:10px 16px;font-weight:900;cursor:pointer}.loss-report-btn.send{background:#0b3f73;color:#fff}.loss-report-btn.print{background:#15803d;color:#fff}.loss-report-btn.close{background:#e5e7eb;color:#111827}.loss-report-head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e5e7eb;padding-bottom:14px}.loss-report-title{font-size:26px;font-weight:900;color:#0b3f73}.loss-report-sub{color:#64748b;margin-top:4px}.loss-report-count{font-size:30px;font-weight:900;color:#b45309;text-align:right}.loss-report-count small{display:block;font-size:12px;color:#64748b}.loss-report-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}.loss-report-kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f8fafc}.loss-report-kpi div{font-size:12px;color:#64748b;font-weight:800}.loss-report-kpi strong{display:block;font-size:22px;margin-top:4px} .loss-report-card h2{font-size:18px;color:#0b3f73;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-top:20px}.loss-report-table-wrap{overflow:auto}.loss-report-card table{width:100%;border-collapse:collapse;margin-top:10px}.loss-report-card th{background:#0b3f73;color:#fff;text-align:left;padding:9px;font-size:12px}.loss-report-card td{padding:9px;border-bottom:1px solid #e5e7eb;font-size:12px;vertical-align:top}.loss-report-card td span{color:#64748b}.loss-report-card .num{text-align:right;font-weight:900}.loss-report-card .empty{text-align:center;color:#64748b;font-weight:900;padding:18px}@media print{body>*:not(#lossHoursReportModal){display:none!important}.loss-report-backdrop{display:block!important;position:static;background:#fff;padding:0}.loss-report-card{box-shadow:none;margin:0;max-width:none;border-radius:0}.loss-report-actions{display:none}.loss-report-grid{grid-template-columns:repeat(5,1fr)}}@media(max-width:768px){.loss-report-backdrop{padding:10px}.loss-report-card{padding:14px}.loss-report-head{display:block}.loss-report-grid{grid-template-columns:1fr 1fr}.loss-report-count{text-align:left;margin-top:10px}.loss-report-actions{justify-content:stretch}.loss-report-btn{flex:1 1 100%}.loss-report-status{width:100%;margin:0}}
    `;
    document.head.appendChild(style);
  }

  function closeReport() { $("lossHoursReportModal")?.classList.remove("show"); }

  function sendStatus(message, type = "") {
    const el = $("lossReportSendStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("ok", type === "ok");
    el.classList.toggle("err", type === "err");
  }

  function buildPdfHtml() {
    const card = document.querySelector("#lossHoursReportModal .loss-report-card")?.cloneNode(true);
    if (!card) return "";
    card.querySelector(".loss-report-actions")?.remove();
    const css = $("lossHoursReportPatchStyles")?.textContent || "";
    return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${card.outerHTML}</body></html>`;
  }

  async function sendLossHoursReport() {
    const btn = $("lossReportSendBtn");
    try {
      if (!currentReportData?.rows?.length) throw new Error("No loss hour records available to send.");
      if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
      sendStatus("Sending report...");

      const range = currentReportData.range || {};
      const filters = currentReportData.filters || {};
      const period = range.label || `${range.from || ""} to ${range.to || ""}` || "Selected Period";
      const payload = await requestJson("/api/email/rework-other-report/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: "loss-hours",
          period,
          machine: "All",
          pdfHtml: buildPdfHtml(),
          filters
        })
      });

      const sent = payload.data?.sent || 0;
      const attach = payload.data?.attachmentCount || 0;
      sendStatus(`Sent to ${sent} recipient(s). Attachment: ${attach}`, "ok");
    } catch (err) {
      console.error("Loss hours report email failed:", err);
      sendStatus("Send failed: " + (err?.message || err), "err");
      alert("Loss Hours Report send failed: " + (err?.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Send Report"; }
    }
  }

  function fillReport(data) {
    ensureModal();
    currentReportData = data;
    const range = data.range || {};
    const filters = data.filters || {};
    const k = data.kpis || {};
    $("lossReportTitle").textContent = data.title || "Loss Hours Report";
    $("lossReportPeriod").textContent = `Period: ${range.label || "-"} (${range.from || "-"} to ${range.to || "-"})`;
    $("lossReportFilters").textContent = `Shift: ${filters.shift || "All"} | Department: ${filters.department || "All"} | Employee: ${filters.employee || "All"}`;
    $("lossReportGenerated").textContent = `Generated: ${new Date().toLocaleString("en-IN")}`;
    $("lossReportHours").textContent = k.totalLossHours || 0;
    $("lossReportKpis").innerHTML = [mini("Records", k.records || 0), mini("Total Loss Hours", k.totalLossHours || 0), mini("Employees", k.employees || 0), mini("Loss Reasons", k.reasons || 0), mini("Average / Record", k.averageLossHours || 0)].join("");
    $("lossReportReasonBody").innerHTML = reasonRows(data.byReason || []);
    $("lossReportEmployeeBody").innerHTML = employeeRows(data.byEmployee || []);
    $("lossReportDetailBody").innerHTML = detailRows(data.rows || []);
    sendStatus("");
    $("lossHoursReportModal").classList.add("show");
  }

  async function openLossHoursReport() {
    try {
      const data = await requestReport();
      if (!Array.isArray(data.rows) || !data.rows.length) { alert("No loss hour records found for this selection."); return; }
      fillReport(data);
    } catch (err) {
      console.error("Loss hours report failed:", err);
      alert("Loss hours report failed: " + (err?.message || err));
    }
  }

  function markLossCard() {
    document.querySelectorAll(".kpi-card").forEach((card) => {
      const label = clean(card.querySelector(".kpi-label")?.textContent).toLowerCase();
      if (label !== "loss hours" || card.__spwtLossReportWired) return;
      card.__spwtLossReportWired = true;
      card.classList.add("loss-hours-kpi-clickable", "attendance-kpi-clickable");
      card.title = "Click to view detailed loss hours report";
      card.addEventListener("click", openLossHoursReport);
    });
  }

  function init() {
    injectStyles();
    ensureModal();
    markLossCard();
    document.addEventListener("click", () => setTimeout(markLossCard, 100), true);
    setInterval(markLossCard, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
