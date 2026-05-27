// renderer/dashboard_v2/qualityReportObservationAutoLoadPatch.js
// Auto-loads saved quality report observation for the selected machine, even when Add Observation is not opened.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  const LS_PREFIX = "spwt_quality_observation_";
  let lastMachineNo = "";
  let isLoading = false;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function storageKey(machineNo) { return LS_PREFIX + clean(machineNo).toUpperCase(); }

  function getMachineNo() {
    try {
      return clean(latestMachineDetails?.raw?.machine?.machineNo || selectedMachine?.machineName || document.getElementById("selectedMachineName")?.textContent || "");
    } catch (err) {
      return "";
    }
  }

  function isValidMachine(machineNo) {
    const s = clean(machineNo).toLowerCase();
    return Boolean(s && s !== "select machine" && s !== "machine dashboard");
  }

  function loadLocal(machineNo) {
    try { return clean(localStorage.getItem(storageKey(machineNo)) || ""); } catch (err) { return ""; }
  }

  function saveLocal(machineNo, observation) {
    if (!isValidMachine(machineNo)) return;
    try { localStorage.setItem(storageKey(machineNo), clean(observation)); } catch (err) {}
  }

  function applyObservation(machineNo, observation) {
    const value = clean(observation);
    window.__SPWT_QUALITY_REPORT_OBSERVATION = value;
    window.__SPWT_QUALITY_REPORT_OBSERVATION_MACHINE = clean(machineNo);
    saveLocal(machineNo, value);

    const textarea = document.getElementById("qualityReportObservationText");
    if (textarea && (!textarea.matches(":focus") || !textarea.value.trim())) {
      textarea.value = value;
    }
  }

  async function requestObservation(machineNo) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/email/quality-report/observation?machineNo=${encodeURIComponent(machineNo)}`, {
        method: "GET",
        signal: controller.signal
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return clean(payload.data?.observation || "");
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadForMachine(machineNo = getMachineNo(), force = false) {
    machineNo = clean(machineNo);
    if (!isValidMachine(machineNo)) return "";
    if (isLoading) return clean(window.__SPWT_QUALITY_REPORT_OBSERVATION || loadLocal(machineNo));
    if (!force && lastMachineNo === machineNo && window.__SPWT_QUALITY_REPORT_OBSERVATION_MACHINE === machineNo) {
      return clean(window.__SPWT_QUALITY_REPORT_OBSERVATION || loadLocal(machineNo));
    }

    isLoading = true;
    lastMachineNo = machineNo;

    const localValue = loadLocal(machineNo);
    if (localValue) applyObservation(machineNo, localValue);

    try {
      const dbValue = await requestObservation(machineNo);
      applyObservation(machineNo, dbValue || localValue);
      return clean(window.__SPWT_QUALITY_REPORT_OBSERVATION || "");
    } catch (err) {
      applyObservation(machineNo, localValue);
      return localValue;
    } finally {
      isLoading = false;
    }
  }

  window.SPWT_LOAD_QUALITY_REPORT_OBSERVATION = loadForMachine;
  window.SPWT_GET_QUALITY_REPORT_OBSERVATION = function () {
    const machineNo = getMachineNo();
    const textarea = document.getElementById("qualityReportObservationText");
    return clean(textarea?.value || window.__SPWT_QUALITY_REPORT_OBSERVATION || loadLocal(machineNo) || "");
  };

  function scheduleLoad(force = false) {
    setTimeout(() => loadForMachine(getMachineNo(), force), 300);
  }

  document.addEventListener("DOMContentLoaded", () => scheduleLoad(true));
  document.addEventListener("click", () => scheduleLoad(false), true);
  setInterval(() => {
    const machineNo = getMachineNo();
    if (isValidMachine(machineNo) && machineNo !== lastMachineNo) loadForMachine(machineNo, true);
  }, 1200);
})();
