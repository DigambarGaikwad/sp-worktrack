// renderer/dashboard_v2/qualityReportSendObservationPatch.js
// Ensures Send Quality Report uses the same polished report HTML as Print Report, including observation text.

(function () {
  const REQUEST_TIMEOUT_MS = 60000;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function displayDate(value) {
    const s = clean(value).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s || "-";
  }

  function getReportData() {
    const machine = latestMachineDetails?.raw?.machine || {};
    const machineNo = clean(machine.machineNo || selectedMachine?.machineName || document.getElementById("selectedMachineName")?.textContent || "-");
    const machineCategory = clean(machine.machineCategory || selectedMachine?.type || "-");
    const fromDate = clean(machine.startDate || "");
    const toDate = clean(machine.endDate || new Date().toISOString().slice(0, 10));
    return { machineNo, machineCategory, fromDate, toDate };
  }

  function syncObservationBeforeSend() {
    const textarea = document.getElementById("qualityReportObservationText");
    if (textarea) {
      window.__SPWT_QUALITY_REPORT_OBSERVATION = clean(textarea.value);
    }
    return clean(window.__SPWT_QUALITY_REPORT_OBSERVATION || "");
  }

  async function requestSend(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/email/quality-report/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `API error ${res.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendQualityReportWithObservation() {
    const data = getReportData();
    const observation = syncObservationBeforeSend();

    if (typeof window.SPWT_BUILD_QUALITY_REPORT_HTML !== "function") {
      alert("Report builder is not ready. Please reopen the dashboard and try again.");
      return;
    }

    const pdfHtml = window.SPWT_BUILD_QUALITY_REPORT_HTML();
    const period = `${displayDate(data.fromDate)} to ${displayDate(data.toDate)}`;
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;">
        <h2>SP WorkTrack Quality Report</h2>
        <p><b>Machine:</b> ${esc(data.machineNo)}</p>
        <p><b>Category:</b> ${esc(data.machineCategory)}</p>
        <p><b>Period:</b> ${esc(period)}</p>
        ${observation ? `<p><b>Observation:</b><br>${esc(observation).replace(/\n/g, "<br>")}</p>` : ""}
        <p>Please find attached PDF report.</p>
      </div>`;

    try {
      await requestSend({
        machineNo: data.machineNo,
        machineCategory: data.machineCategory,
        period,
        html,
        pdfHtml
      });
      alert("Quality report email sent successfully with observation in PDF attachment.");
    } catch (err) {
      alert("Send quality report failed: " + (err?.message || err));
    }
  }

  function interceptSend(e) {
    if (!e.target?.closest?.("#sendQualityReportBtn")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sendQualityReportWithObservation();
  }

  document.addEventListener("click", interceptSend, true);
})();
