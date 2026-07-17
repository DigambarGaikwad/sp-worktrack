// renderer/dashboard_v2/reworkOtherPrintReportPatch.js
// Adds Print Rework / Other Report button to Machine Dashboard using the same button/report pattern as Quality Report.
(function () {
  const MACHINE_DETAIL_API = "/api/dashboard/machine-detail";
  let latestMachine = {};
  let latestRows = [];

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) {
    return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function hours(minutes) {
    const h = num(minutes) / 60;
    return Number.isInteger(h) ? String(h) : h.toFixed(1);
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
    try { return new URL(`../../assets/${fileName}`, window.location.href).href; }
    catch (_) { return ""; }
  }
  function employeeText(row = {}) {
    const name = clean(row.empName || row.employeeName || row.emp_name || row.doneByName);
    const code = clean(row.empCode || row.employeeCode || row.emp_code || row.doneByCode);
    if (name && code) return `${name} (${code})`;
    return name || code || "-";
  }

  function ensureButtonStyles() {
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

  function patchFetch() {
    if (window.__spwtReworkOtherPrintFetchPatched) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const response = await originalFetch(input, init);
      const url = typeof input === "string" ? input : clean(input?.url);
      if (url.includes(MACHINE_DETAIL_API)) {
        response.clone().json().then((payload) => {
          latestMachine = payload?.data?.machine || {};
          latestRows = Array.isArray(payload?.data?.reworkOtherDetails) ? payload.data.reworkOtherDetails : [];
        }).catch(() => {
          latestMachine = {};
          latestRows = [];
        });
      }
      return response;
    };
    window.__spwtReworkOtherPrintFetchPatched = true;
  }

  function rowsFromDom() {
    const body = $("reworkOtherTableBody");
    if (!body) return [];
    return Array.from(body.querySelectorAll("tr")).map((tr) => {
      const cells = Array.from(tr.children).map((td) => clean(td.textContent));
      if (cells.length < 7 || cells[0].toLowerCase().includes("no rework")) return null;
      return {
        workDate: cells[0],
        workNature: cells[1],
        employee: cells.length >= 8 ? cells[2] : "-",
        department: cells.length >= 8 ? cells[3] : cells[2],
        subwork: cells.length >= 8 ? cells[4] : cells[3],
        rootArea: cells.length >= 8 ? cells[5] : cells[4],
        hoursText: cells.length >= 8 ? cells[6] : cells[5],
        description: cells.length >= 8 ? cells[7] : cells[6]
      };
    }).filter(Boolean);
  }

  function getReportRows() {
    if (latestRows.length) {
      return latestRows.map((r) => ({
        workDate: displayDate(r.workDate || r.work_date),
        workNature: clean(r.workNature || r.work_nature) || "-",
        employee: employeeText(r),
        department: clean(r.department || r.department_name) || "-",
        subwork: clean(r.subwork || r.subwork_name || r.subWork) || "-",
        rootArea: clean(r.rootArea || r.root_area) || "-",
        hoursText: hours(r.actualMinutes ?? r.actual_minutes),
        description: clean(r.description || r.efficiencyReason || r.efficiency_reason || r.rootArea || "-")
      }));
    }
    return rowsFromDom();
  }

  function reportMeta() {
    const machineNo = clean(latestMachine.machineNo || latestMachine.machine_no || $("selectedMachineName")?.textContent || "-");
    const category = clean(latestMachine.machineCategory || latestMachine.machine_category || selectedMachine?.type || "-");
    const status = clean(latestMachine.status || selectedMachine?.status || "-");
    const period = clean(latestMachine.startDate || latestMachine.start_date)
      ? `${displayDate(latestMachine.startDate || latestMachine.start_date)} to ${displayDate(latestMachine.endDate || latestMachine.end_date || new Date().toISOString().slice(0, 10))}`
      : clean($("selectedMachineMeta")?.textContent || "-");
    return { machineNo, category, status, period };
  }

  function buildReportHtml() {
    const meta = reportMeta();
    const rows = getReportRows();
    const logo = assetUrl("logo%20(2).png") || assetUrl("app.ico");
    const reworkCount = rows.filter((r) => clean(r.workNature).toLowerCase() === "rework").length;
    const otherCount = rows.filter((r) => clean(r.workNature).toLowerCase() === "other").length;
    const totalHours = rows.reduce((sum, r) => sum + num(r.hoursText), 0);

    const rowsHtml = rows.map((r, index) => `
      <tr>
        <td class="sr">${index + 1}</td>
        <td>${esc(r.workDate)}</td>
        <td>${esc(r.workNature)}</td>
        <td>${esc(r.employee)}</td>
        <td>${esc(r.department)}</td>
        <td>${esc(r.subwork)}</td>
        <td>${esc(r.rootArea)}</td>
        <td class="time">${esc(r.hoursText)}</td>
        <td>${esc(r.description)}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="empty-row">No Rework / Other entries found</td></tr>`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>SP WorkTrack Rework Other Report</title><style>
      @page { size: A4 landscape; margin: 8mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      body { margin:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#111827; }
      .page { max-width: 1120px; margin: 12px auto; background:#ffffff; border:1px solid #111827; border-radius:8px; overflow:hidden; }
      .app-head { background:#111827 !important; color:#ffffff !important; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:3px solid #0b3f73; }
      .brand { display:flex; align-items:center; gap:10px; min-width:0; }
      .logo-img { width:86px; height:36px; object-fit:contain; background:#111827 !important; border:0; border-radius:3px; flex:0 0 auto; padding:0; }
      .app-title { font-size:18px; font-weight:800; line-height:1; color:#ffffff !important; }
      .app-sub { font-size:10.5px; margin-top:3px; color:#e5e7eb !important; }
      .header-report-title { font-size:13.5px; font-weight:800; text-align:right; white-space:nowrap; color:#ffffff !important; }
      .header-report-sub { font-size:9.6px; color:#d1d5db !important; margin-top:3px; text-align:right; }
      .content { padding:10px 14px 10px; }
      .subtitle { color:#334155; font-size:10px; font-weight:700; margin-bottom:6px; }
      .meta-grid { display:grid; grid-template-columns: 1fr 1fr 1fr 1.2fr; gap:5px; margin-top:5px; }
      .meta-card { border:1px solid #94a3b8; border-left:3px solid #0b3f73; border-radius:5px; padding:4px 7px; background:#ffffff !important; min-height:32px; }
      .label { color:#475569; font-size:8.2px; font-weight:800; text-transform:uppercase; letter-spacing:.24px; }
      .value { color:#111827; font-size:11px; font-weight:800; margin-top:2px; line-height:1.12; }
      .sum-grid { margin:7px 0 7px; display:grid; grid-template-columns: repeat(4,1fr); gap:5px; }
      .sum-card { border:1.4px solid #64748b; border-radius:5px; padding:4px 6px; background:#ffffff !important; display:flex; align-items:center; justify-content:space-between; min-height:28px; }
      .sum-card strong { font-size:15px; color:#0f172a; }
      .sum-card span { color:#334155; font-size:8px; font-weight:800; text-transform:uppercase; letter-spacing:.18px; }
      .sum-card.total { border-color:#1d4ed8; }
      .sum-card.rework { border-color:#b91c1c; }
      .sum-card.other { border-color:#f97316; }
      table { width:100%; border-collapse:collapse; margin-top:5px; font-size:8.4px; table-layout:fixed; border:1.4px solid #0b3f73; }
      th { background:#ffffff !important; color:#0b3f73 !important; border:1.4px solid #0b3f73 !important; padding:4px 3px; text-align:left; font-size:8.2px; }
      td { border:1px solid #cbd5e1; padding:4px 3px; vertical-align:top; word-break:break-word; line-height:1.15; color:#111827; }
      .sr { text-align:center; width:24px; }
      .time { text-align:right; font-weight:800; }
      .empty-row { text-align:center; color:#64748b; padding:14px; }
      .foot { padding:6px 14px 9px; color:#475569; font-size:8.2px; display:flex; justify-content:space-between; gap:8px; }
      .no-print { padding:8px 14px; display:flex; justify-content:flex-end; gap:8px; }
      .print-btn { border:1px solid #0b3f73; background:#ffffff !important; color:#0b3f73 !important; border-radius:6px; padding:7px 11px; font-weight:800; cursor:pointer; }
      @media print { body { background:#ffffff !important; } .page { margin:0; max-width:none; box-shadow:none; border-radius:0; border:1px solid #111827; } .no-print { display:none; } .content { padding:8px 7px 7px; } .app-head { padding:7px 8px; } .meta-grid, .sum-grid { gap:4px; } th, td { padding:3.4px 2.8px; } }
    </style></head><body><div class="page"><div class="app-head"><div class="brand"><img class="logo-img" src="${esc(logo)}" onerror="this.style.display='none'" /><div><div class="app-title">SP WorkTrack</div><div class="app-sub">Production & Performance Management System</div></div></div><div><div class="header-report-title">Rework / Other Report</div><div class="header-report-sub">Detailed loss/rework entries with reason visibility</div></div></div><div class="content"><div class="subtitle">Employee name, department, sub work, root area and reason are captured from production entries.</div><div class="meta-grid"><div class="meta-card"><div class="label">Machine No</div><div class="value">${esc(meta.machineNo)}</div></div><div class="meta-card"><div class="label">Machine Category</div><div class="value">${esc(meta.category)}</div></div><div class="meta-card"><div class="label">Status</div><div class="value">${esc(meta.status)}</div></div><div class="meta-card"><div class="label">Report Period</div><div class="value">${esc(meta.period)}</div></div></div><div class="sum-grid"><div class="sum-card total"><span>Total Entries</span><strong>${rows.length}</strong></div><div class="sum-card rework"><span>Rework Entries</span><strong>${reworkCount}</strong></div><div class="sum-card other"><span>Other Entries</span><strong>${otherCount}</strong></div><div class="sum-card total"><span>Total Hours</span><strong>${totalHours.toFixed(1)}</strong></div></div><table><thead><tr><th style="width:26px;">Sr</th><th style="width:8%;">Date</th><th style="width:7%;">Type</th><th style="width:15%;">Name</th><th style="width:10%;">Dept</th><th style="width:15%;">Sub Work</th><th style="width:10%;">Root Area</th><th style="width:6%;">Hours</th><th>Description / Reason</th></tr></thead><tbody>${rowsHtml}</tbody></table></div><div class="foot"><span>Generated from SP WorkTrack rework / other entry data.</span><span>Generated On: ${esc(nowText())}</span></div><div class="no-print"><button class="print-btn" onclick="window.print()">Print / Save PDF</button></div></div></body></html>`;
  }

  function printReport() {
    const html = buildReportHtml();
    const win = window.open("", "_blank", "width=1100,height=850");
    if (!win) return alert("Popup blocked. Allow popups for SP WorkTrack.");
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  function addButton() {
    const heads = Array.from(document.querySelectorAll(".panel-head"));
    const target = heads.find(h => clean(h.querySelector("h2")?.textContent) === "Rework / Other Description");
    if (!target || target.querySelector("#printReworkOtherReportBtn")) return;

    ensureButtonStyles();
    const actions = document.createElement("div");
    actions.className = "quality-report-actions";
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.flexWrap = "wrap";
    actions.innerHTML = `<button class="qr-action-btn qr-action-primary" id="printReworkOtherReportBtn" type="button">Print Rework / Other Report</button>`;
    target.appendChild(actions);
    $("printReworkOtherReportBtn")?.addEventListener("click", printReport);
  }

  function wire() {
    patchFetch();
    addButton();
    setTimeout(addButton, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
  document.addEventListener("click", () => setTimeout(addButton, 100), true);
})();
