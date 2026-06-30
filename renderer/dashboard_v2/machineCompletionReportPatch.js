// renderer/dashboard_v2/machineCompletionReportPatch.js
// Adds filters + printable Machine Completion Report popup.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 30000;

  function $(id) { return document.getElementById(id); }
  function clean(v) { return String(v ?? "").trim(); }
  function num(v) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }
  function esc(v) { return String(v ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function dateText(v) { const s = clean(v).slice(0, 10); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "-"; }
  function currentYear() { return new Date().getFullYear(); }
  function currentMonth() { return new Date().getMonth() + 1; }

  function addStyles() {
    if ($("machineCompletionReportStyles")) return;
    const st = document.createElement("style");
    st.id = "machineCompletionReportStyles";
    st.textContent = `
      .machine-completion-filter-bar{display:grid;grid-template-columns:minmax(170px,230px) minmax(110px,145px) minmax(145px,175px) minmax(145px,175px) max-content auto;gap:9px;align-items:stretch;margin-top:8px}
      .machine-completion-filter-bar .dash-select{width:100%;min-width:0}
      #showMachineCompletionReportBtn{width:auto!important;max-width:max-content!important;min-width:0!important;min-height:40px!important;padding:8px 12px!important;white-space:nowrap!important;background:#0b3f73!important;color:#fff!important;border-color:#0b3f73!important;justify-self:start!important}
      #showMachineCompletionReportBtn:hover{background:#0a3561!important;border-color:#0a3561!important}
      #machineCompletionReportStatus{align-self:center;font-weight:900;color:#64748b}
      @media(max-width:1200px){.machine-completion-filter-bar{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.machine-completion-filter-bar{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  async function getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } finally { clearTimeout(timer); }
  }

  function status(msg, type) {
    const el = $("machineCompletionReportStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function populateYears() {
    const sel = $("machineCompletionYear");
    if (!sel || sel.options.length) return;
    const y = currentYear();
    sel.innerHTML = Array.from({ length: 6 }, (_, i) => `<option value="${y - i}">${y - i}</option>`).join("");
  }

  function apiUrl() {
    const range = clean($("machineCompletionRange")?.value || "currentMonth");
    const year = clean($("machineCompletionYear")?.value || currentYear());
    const qs = new URLSearchParams({ range, year });
    if (range === "currentMonth") qs.set("month", String(currentMonth()));
    if (range === "custom") {
      qs.set("from", clean($("machineCompletionFrom")?.value));
      qs.set("to", clean($("machineCompletionTo")?.value));
    }
    return `${API_BASE_URL}/api/dashboard/machine-completion-report?${qs.toString()}`;
  }

  function table(rows, cols, emptyText) {
    if (!rows?.length) return `<tr><td colspan="${cols.length}">${esc(emptyText || "No records found")}</td></tr>`;
    return rows.map(row => `<tr>${cols.map(c => `<td style="${c.style || ""}">${esc(c.value(row))}</td>`).join("")}</tr>`).join("");
  }

  function reportHtml(data) {
    const s = data.summary || {};
    const r = data.range || {};
    const period = `${r.label || "Selected Period"} (${dateText(r.from)} to ${dateText(r.to)})`;
    const rows = data.rows || [];
    const cats = data.byCategory || [];
    const months = data.monthWise || [];
    const now = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Machine Completion Report</title><style>
      @page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827}.page{margin:14px auto;max-width:1180px;background:#fff;border:1px solid #0f172a;border-radius:10px;overflow:hidden}.head{background:#111827;color:#fff;padding:14px 16px;display:flex;justify-content:space-between}.title{font-size:18px;font-weight:900}.sub{font-size:11px;color:#e5e7eb;margin-top:3px}.actions{padding:9px 14px;text-align:right}.btn{border:0;border-radius:8px;padding:8px 12px;font-weight:900;cursor:pointer}.print{background:#15803d;color:#fff}.close{background:#e5e7eb}.body{padding:12px 14px}.meta,.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}.card{border:1px solid #cbd5e1;border-left:4px solid #0b3f73;border-radius:8px;padding:8px;background:#f8fafc}.lbl{font-size:9px;text-transform:uppercase;color:#475569;font-weight:900}.val{font-size:18px;font-weight:900;color:#0b3f73;margin-top:2px}.meta .val{font-size:12px;color:#111827}.split{display:grid;grid-template-columns:2fr 1fr;gap:10px}h2{font-size:14px;color:#0b3f73;margin:12px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#0b3f73;color:#fff;text-align:left;padding:6px;border:1px solid #0b3f73}td{padding:6px;border:1px solid #dbe3ee}.right{text-align:right}.note{font-size:9px;color:#64748b;margin-top:8px}.foot{padding:8px 14px;border-top:1px solid #cbd5e1;font-size:9px;color:#64748b;display:flex;justify-content:space-between}@media print{body{background:#fff}.page{margin:0;max-width:none;border-radius:0}.actions{display:none}td,th{font-size:8.8px;padding:4px}.body{padding:8px}}
    </style></head><body><div class="page"><div class="head"><div><div class="title">SP WorkTrack</div><div class="sub">Production & Performance Management System</div></div><div><div class="title">Machine Completion Report</div><div class="sub">Completed machines with monthly completion count</div></div></div><div class="actions"><button class="btn print" onclick="window.print()">Print / Save PDF</button> <button class="btn close" onclick="window.close()">Close</button></div><div class="body"><div class="meta"><div class="card"><div class="lbl">Period</div><div class="val">${esc(period)}</div></div><div class="card"><div class="lbl">Generated</div><div class="val">${esc(now)}</div></div><div class="card"><div class="lbl">Date Rule</div><div class="val">${esc(data.meta?.dateRule || "Completion date")}</div></div><div class="card"><div class="lbl">Records</div><div class="val">${rows.length}</div></div><div class="card"><div class="lbl">Year</div><div class="val">${esc(data.meta?.monthlyYear || r.year || currentYear())}</div></div></div><div class="kpis"><div class="card"><div class="lbl">Completed in Period</div><div class="val">${num(s.completedInPeriod)}</div></div><div class="card"><div class="lbl">Completed Current Year</div><div class="val">${num(s.completedCurrentYear)}</div></div><div class="card"><div class="lbl">Total Completed</div><div class="val">${num(s.completedTotal)}</div></div><div class="card"><div class="lbl">Std Hours</div><div class="val">${num(s.standardHours).toFixed(2)}</div></div><div class="card"><div class="lbl">Actual Hours</div><div class="val">${num(s.actualHours).toFixed(2)}</div></div></div><div class="split"><div><h2>Category Summary</h2><table><thead><tr><th>Category</th><th>Count</th><th>Std Hrs</th><th>Actual Hrs</th></tr></thead><tbody>${table(cats, [{value:x=>x.name},{value:x=>x.count,style:"text-align:right;font-weight:900"},{value:x=>num(x.standardHours).toFixed(2),style:"text-align:right"},{value:x=>num(x.actualHours).toFixed(2),style:"text-align:right"}], "No category summary")}</tbody></table></div><div><h2>Month-wise Completion</h2><table><thead><tr><th>Month</th><th>Completed</th></tr></thead><tbody>${table(months, [{value:x=>`${x.month} ${x.year}`},{value:x=>x.count,style:"text-align:right;font-weight:900"}], "No month summary")}</tbody></table></div></div><h2>Completed Machine Details</h2><table><thead><tr><th>Completion Date</th><th>Machine</th><th>Category</th><th>Std Hrs</th><th>Actual Hrs</th><th>Lines</th><th>Date Source</th></tr></thead><tbody>${table(rows, [{value:x=>dateText(x.completionDate)},{value:x=>x.machineNo},{value:x=>x.machineCategory},{value:x=>num(x.standardHours).toFixed(2),style:"text-align:right"},{value:x=>num(x.actualHours).toFixed(2),style:"text-align:right"},{value:x=>x.entryLines,style:"text-align:right"},{value:x=>x.dateSource}], "No completed machines found for selected period")}</tbody></table><div class="note">If explicit completion date is not available, report uses machine updated date, then latest work date as fallback.</div></div><div class="foot"><span>Generated from SP WorkTrack machine master and production lines.</span><span>${esc(period)}</span></div></div></body></html>`;
  }

  async function openReport() {
    const range = clean($("machineCompletionRange")?.value || "currentMonth");
    if (range === "custom" && (!$("machineCompletionFrom")?.value || !$("machineCompletionTo")?.value)) {
      status("Select From and To date first.", "error");
      return;
    }
    try {
      status("Preparing completion report...");
      const data = await getJson(apiUrl());
      const w = window.open("", "_blank", "width=1220,height=850");
      if (!w) throw new Error("Popup blocked. Allow popups for this app.");
      w.document.open();
      w.document.write(reportHtml(data));
      w.document.close();
      status(`Report opened. Completed: ${data.summary?.completedInPeriod || 0}`, "success");
    } catch (err) {
      status(err?.message || String(err), "error");
      alert("Machine completion report failed:\n\n" + (err?.message || err));
    }
  }

  function addUi() {
    addStyles();
    const host = document.querySelector(".dash-topbar");
    if (!host || $("machineCompletionReportBar")) return;
    const bar = document.createElement("div");
    bar.id = "machineCompletionReportBar";
    bar.className = "machine-completion-filter-bar";
    bar.innerHTML = `
      <select id="machineCompletionRange" class="dash-select"><option value="currentMonth">Completed: Current Month</option><option value="currentYear">Completed: Current Year</option><option value="custom">Completed: Selected Date Range</option></select>
      <select id="machineCompletionYear" class="dash-select"></select>
      <input id="machineCompletionFrom" class="dash-select" type="date" />
      <input id="machineCompletionTo" class="dash-select" type="date" />
      <button id="showMachineCompletionReportBtn" class="dash-btn primary" type="button">Show Machine Completion Report</button>
      <span id="machineCompletionReportStatus" class="small-hint"></span>`;
    host.appendChild(bar);
    populateYears();
    $("showMachineCompletionReportBtn")?.addEventListener("click", openReport);
    $("machineCompletionRange")?.addEventListener("change", () => {
      const custom = $("machineCompletionRange")?.value === "custom";
      [$("machineCompletionFrom"), $("machineCompletionTo")].forEach(el => { if (el) el.style.display = custom ? "" : "none"; });
    });
    $("machineCompletionRange")?.dispatchEvent(new Event("change"));
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(addUi, 900));
  document.addEventListener("click", () => setTimeout(addUi, 180), true);
  setInterval(addUi, 1500);
})();
