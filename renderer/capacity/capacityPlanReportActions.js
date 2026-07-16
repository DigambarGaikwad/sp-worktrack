// renderer/capacity/capacityPlanReportActions.js
// Production plan print/send uses only section 6: Date-wise Employee Production Plan.

(function () {
  const API = window.SPWT_CONFIG?.API_BASE_URL || window.location.origin || "http://localhost:3032";
  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v ?? "").trim();
  const esc = (v) => clean(v).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));

  function dateText(value) {
    const text = clean(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.split("-").reverse().join("/") : text || "-";
  }

  function periodText() {
    return `${dateText($("fromDate")?.value)} to ${dateText($("toDate")?.value)}`;
  }

  function cloneSection(selector) {
    if (typeof window.SPWT_CAPACITY_APPLY_PLAN_DATES === "function") {
      try { window.SPWT_CAPACITY_APPLY_PLAN_DATES(); } catch (_) {}
    }
    const node = document.querySelector(selector);
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll("button,input,select").forEach((el) => {
      if (el.tagName === "INPUT" || el.tagName === "SELECT") {
        const span = document.createElement("span");
        span.textContent = el.type === "checkbox" ? (el.checked ? "Yes" : "No") : (el.value || "-");
        el.replaceWith(span);
      } else {
        el.remove();
      }
    });
    return clone.innerHTML;
  }

  function buildReportHtml() {
    const period = periodText();
    const planHtml = cloneSection(".plan-preview");
    if (!clean(planHtml) || /Production plan not generated yet|No assignment generated/i.test(planHtml)) {
      throw new Error("Generate Production Plan first, then print/send.");
    }

    return `<!DOCTYPE html><html><head><meta charset="UTF-8" />
      <title>SP WorkTrack Date-wise Production Plan</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { margin:0; font-family: Arial, sans-serif; color:#111827; background:#ffffff; font-size:11px; }
        .report-wrap { padding: 0; }
        .report-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:3px solid #0b3f73; padding-bottom:10px; margin-bottom:12px; }
        .brand { display:flex; align-items:center; gap:10px; }
        .logo-box { width:74px; height:44px; border-radius:6px; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:900; }
        h1 { margin:0; font-size:20px; color:#0b3f73; }
        .sub { margin-top:3px; font-size:11px; color:#64748b; font-weight:700; }
        .meta { text-align:right; font-size:11px; line-height:1.5; color:#334155; }
        .section-title, h2 { margin:0 0 8px; font-size:14px; color:#0b3f73; font-weight:900; }
        .sp-panel, .date-plan-card, .employee-card { border:1px solid #d8e2ef; border-radius:10px; padding:10px; margin:8px 0; box-shadow:none !important; background:#fff; break-inside: avoid; }
        .plan-preview { border:0; padding:0; margin:0; }
        .date-title { font-size:14px; color:#0b3f73; font-weight:900; margin:0 0 8px; background:#eaf2ff; padding:7px 9px; border-radius:7px; }
        .employee-head { display:flex; justify-content:space-between; gap:10px; background:#f8fbff; padding:7px 9px; border-radius:7px; border:1px solid #d8e2ef; margin-bottom:7px; }
        .employee-name { font-weight:900; color:#0f172a; }
        .employee-meta { color:#64748b; font-weight:700; }
        .plan-date-pill { display:inline-block; margin-left:8px; padding:3px 8px; border-radius:999px; background:#eaf2ff; color:#0b3f73; font-size:10px; font-weight:900; vertical-align:middle; }
        .employee-day-date { color:#0b3f73; font-weight:900; white-space:nowrap; }
        table, .cap-table { width:100%; border-collapse:collapse; min-width:0 !important; }
        th { background:#0b3f73 !important; color:#fff !important; text-align:left; padding:6px; font-size:10px; border:1px solid #0b3f73; }
        td { padding:5px 6px; border:1px solid #d8e2ef; vertical-align:top; font-size:10px; background:#fff !important; }
        .badge { display:inline-block; border-radius:999px; padding:2px 6px; background:#eaf2ff; color:#0b3f73; font-weight:900; }
        .complete-note { border:1px solid #bbf7d0; color:#166534; background:#f0fdf4; border-radius:8px; padding:7px; font-weight:800; }
        .hero-actions, .plan-control, .setup-card, .dependency-form, .subsection-row, .checkbox-flex, .empty-state { display:none !important; }
      </style></head><body><div class="report-wrap">
        <div class="report-head">
          <div class="brand"><div class="logo-box">SP</div><div><h1>SP WorkTrack Production Plan</h1><div class="sub">Date-wise Employee Production Plan</div></div></div>
          <div class="meta"><b>Period:</b> ${esc(period)}<br/><b>Generated:</b> ${esc(new Date().toLocaleString("en-IN"))}</div>
        </div>
        ${planHtml}
      </div></body></html>`;
  }

  function openPrintReport() {
    try {
      const html = buildReportHtml();
      const win = window.open("", "_blank", "width=1200,height=800");
      if (!win) throw new Error("Popup blocked. Allow popup for print preview.");
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    } catch (err) {
      alert(err.message || err);
    }
  }

  async function sendReport() {
    try {
      const html = buildReportHtml();
      const period = periodText();
      const btn = $("copyPlanBtn");
      if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
      const res = await fetch(`${API}/api/email/capacity-plan/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, html, pdfHtml: html })
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Email API error ${res.status}`);
      const to = (payload.data?.mainRecipients || []).join(", ");
      const cc = (payload.data?.ccRecipients || []).join(", ");
      alert(`Production plan sent.\nTo: ${to || "-"}${cc ? "\nCC: " + cc : ""}`);
    } catch (err) {
      alert(`Production plan send failed:\n${err.message || err}\n\nCheck Admin → Report Emails → Production Plan Email Recipients.`);
    } finally {
      const btn = $("copyPlanBtn");
      if (btn) { btn.disabled = false; btn.textContent = "Copy / Send"; }
    }
  }

  function wire() {
    const printBtn = $("printPlanBtn");
    const sendBtn = $("copyPlanBtn");
    if (printBtn && !printBtn.__capacityReportWired) {
      printBtn.__capacityReportWired = true;
      printBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); openPrintReport(); }, true);
    }
    if (sendBtn && !sendBtn.__capacityReportWired) {
      sendBtn.__capacityReportWired = true;
      sendBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); sendReport(); }, true);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();