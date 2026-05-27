// renderer/dashboard_v2/dashboardButtonsPolishPatch.js
// Unifies dashboard button styling and replaces observation prompt with inline DB-saved field.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let lastSavedObservation = "";
  let loadedMachineNo = "";

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function getMachineNo() {
    try {
      return clean(latestMachineDetails?.raw?.machine?.machineNo || selectedMachine?.machineName || document.getElementById("selectedMachineName")?.textContent || "");
    } catch (err) {
      return "";
    }
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function addButtonStyles() {
    if (document.getElementById("dashboardButtonsPolishStyles")) return;
    const style = document.createElement("style");
    style.id = "dashboardButtonsPolishStyles";
    style.textContent = `
      .dash-btn,
      .tab-btn,
      .loss-apply-btn,
      .quality-report-actions .qr-action-btn {
        border: 0 !important;
        border-radius: 10px !important;
        min-height: 32px !important;
        padding: 7px 12px !important;
        font-size: 12px !important;
        line-height: 1 !important;
        font-weight: 800 !important;
        letter-spacing: .1px !important;
        cursor: pointer !important;
        transition: transform .14s ease, box-shadow .14s ease, opacity .14s ease, background .14s ease !important;
        box-shadow: 0 6px 14px rgba(15,23,42,.08) !important;
        white-space: nowrap !important;
      }
      .dash-btn:hover,
      .tab-btn:hover,
      .loss-apply-btn:hover,
      .quality-report-actions .qr-action-btn:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 10px 20px rgba(15,23,42,.13) !important;
      }
      .dash-btn:active,
      .tab-btn:active,
      .loss-apply-btn:active,
      .quality-report-actions .qr-action-btn:active {
        transform: translateY(0) !important;
        box-shadow: 0 5px 10px rgba(15,23,42,.10) !important;
      }
      .dash-btn.primary,
      .loss-apply-btn,
      .tab-btn.active,
      #printQualityReportBtn {
        background: #0b3f73 !important;
        color: #ffffff !important;
      }
      .tab-btn:not(.active),
      .dash-btn:not(.primary),
      #addQualityObservationBtn {
        background: #e5e7eb !important;
        color: #111827 !important;
      }
      #sendQualityReportBtn { background: #f97316 !important; color: #ffffff !important; }
      .dash-btn:disabled,
      .tab-btn:disabled,
      .loss-apply-btn:disabled,
      .quality-report-actions .qr-action-btn:disabled {
        opacity: .55 !important;
        cursor: not-allowed !important;
        transform: none !important;
      }
      .qr-observation-box {
        width: 100%;
        margin-top: 10px;
        padding: 10px;
        border: 1px solid #dbe3ee;
        border-radius: 12px;
        background: #f8fafc;
        display: none;
      }
      .qr-observation-box.open { display: block; }
      .qr-observation-label { font-size: 12px; font-weight: 800; color: #334155; margin-bottom: 6px; }
      .qr-observation-machine { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 6px; }
      .qr-observation-textarea {
        width: 100%;
        min-height: 76px;
        resize: vertical;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
        color: #111827;
        padding: 9px 10px;
        outline: none;
        font-size: 13px;
        line-height: 1.4;
      }
      .qr-observation-textarea:focus { border-color: #0b3f73; box-shadow: 0 0 0 3px rgba(11,63,115,.12); }
      .qr-observation-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      .qr-save-observation-btn {
        border: 0;
        border-radius: 10px;
        padding: 7px 12px;
        min-height: 32px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        background: #16a34a;
        color: #ffffff;
        box-shadow: 0 6px 14px rgba(15,23,42,.08);
        transition: transform .14s ease, box-shadow .14s ease;
      }
      .qr-save-observation-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(15,23,42,.13); }
      .qr-clear-observation-btn {
        border: 0;
        border-radius: 10px;
        padding: 7px 12px;
        min-height: 32px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        background: #e5e7eb;
        color: #111827;
      }
      .qr-observation-status { font-size: 12px; color: #15803d; font-weight: 800; }
      .qr-observation-status.error { color: #b91c1c; }
    `;
    document.head.appendChild(style);
  }

  function setStatus(message, type = "") {
    const status = document.getElementById("qualityObservationStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", type === "error");
  }

  function ensureObservationBox() {
    const qualityPanelHead = Array.from(document.querySelectorAll(".panel-head"))
      .find(h => clean(h.querySelector("h2")?.textContent) === "Quality Point Checklist");
    const qualityPanel = qualityPanelHead?.closest(".panel");
    if (!qualityPanel || document.getElementById("qualityReportObservationBox")) return;

    const tableWrap = qualityPanel.querySelector(".table-wrap");
    const box = document.createElement("div");
    box.id = "qualityReportObservationBox";
    box.className = "qr-observation-box";
    box.innerHTML = `
      <div class="qr-observation-label">Observation / Deviation / Remarks</div>
      <div id="qualityReportObservationMachine" class="qr-observation-machine"></div>
      <textarea id="qualityReportObservationText" class="qr-observation-textarea" placeholder="Type observation, deviation, remark or special note for the quality report..."></textarea>
      <div class="qr-observation-actions">
        <button id="saveQualityObservationBtn" class="qr-save-observation-btn" type="button">Save Observation</button>
        <button id="clearQualityObservationBtn" class="qr-clear-observation-btn" type="button">Clear</button>
        <span id="qualityObservationStatus" class="qr-observation-status"></span>
      </div>`;

    if (tableWrap) qualityPanel.insertBefore(box, tableWrap);
    else qualityPanel.appendChild(box);

    wireObservationButtons();
  }

  async function loadObservationFromDb(machineNo) {
    if (!machineNo) return "";
    const payload = await requestJson(`/api/email/quality-report/observation?machineNo=${encodeURIComponent(machineNo)}`, { method: "GET" });
    return clean(payload.data?.observation || "");
  }

  async function saveObservationToDb(machineNo, observation) {
    const payload = await requestJson("/api/email/quality-report/observation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineNo, observation })
    });
    return clean(payload.data?.observation || "");
  }

  function wireObservationButtons() {
    const textarea = document.getElementById("qualityReportObservationText");
    const saveBtn = document.getElementById("saveQualityObservationBtn");
    const clearBtn = document.getElementById("clearQualityObservationBtn");
    if (!textarea || !saveBtn || !clearBtn || saveBtn.__wired) return;
    saveBtn.__wired = true;

    saveBtn.addEventListener("click", async () => {
      const machineNo = getMachineNo();
      if (!machineNo || machineNo.toLowerCase() === "select machine") {
        setStatus("Select machine first.", "error");
        return;
      }
      try {
        saveBtn.disabled = true;
        setStatus("Saving observation...");
        lastSavedObservation = await saveObservationToDb(machineNo, clean(textarea.value));
        loadedMachineNo = machineNo;
        window.__SPWT_QUALITY_REPORT_OBSERVATION = lastSavedObservation;
        setStatus(lastSavedObservation ? "Observation saved to DB." : "Observation cleared in DB.");
        setTimeout(() => setStatus(""), 2500);
      } catch (err) {
        setStatus("Save failed: " + (err?.message || err), "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    clearBtn.addEventListener("click", async () => {
      textarea.value = "";
      textarea.focus();
      setStatus("Click Save Observation to clear in DB.");
    });
  }

  async function openObservationBox() {
    ensureObservationBox();
    const box = document.getElementById("qualityReportObservationBox");
    const textarea = document.getElementById("qualityReportObservationText");
    const machineLine = document.getElementById("qualityReportObservationMachine");
    if (!box || !textarea) return;

    const machineNo = getMachineNo();
    box.classList.add("open");
    if (machineLine) machineLine.textContent = machineNo ? `Machine: ${machineNo}` : "Select machine first";

    try {
      if (machineNo && machineNo !== loadedMachineNo) {
        setStatus("Loading saved observation...");
        lastSavedObservation = await loadObservationFromDb(machineNo);
        loadedMachineNo = machineNo;
        window.__SPWT_QUALITY_REPORT_OBSERVATION = lastSavedObservation;
        setStatus(lastSavedObservation ? "Saved observation loaded." : "No saved observation for this machine.");
        setTimeout(() => setStatus(""), 2000);
      }
      textarea.value = window.__SPWT_QUALITY_REPORT_OBSERVATION || lastSavedObservation || "";
    } catch (err) {
      setStatus("Load failed: " + (err?.message || err), "error");
    }

    setTimeout(() => textarea.focus(), 80);
  }

  function interceptObservationButton(e) {
    if (!e.target?.closest?.("#addQualityObservationBtn")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openObservationBox();
  }

  function init() {
    addButtonStyles();
    ensureObservationBox();
  }

  document.addEventListener("click", interceptObservationButton, true);
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 800));
  document.addEventListener("click", () => setTimeout(init, 150), true);
})();
