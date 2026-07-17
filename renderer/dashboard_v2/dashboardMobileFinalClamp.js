// renderer/dashboard_v2/dashboardMobileFinalClamp.js
// Last-loaded mobile clamp for Machine Dashboard filters and report controls.
(function () {
  const STYLE_ID = "dashboardMobileFinalClampStyle";

  const CSS = `
    @media (max-width: 700px) {
      html, body, .sp-app-shell, .sp-page, .dash-shell {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: hidden !important;
        box-sizing: border-box !important;
      }

      .dash-shell {
        padding: 8px !important;
      }

      .dash-topbar {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 0 14px 0 !important;
        padding: 14px 10px !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
        gap: 10px !important;
      }

      .brand-block,
      .filter-bar,
      .loss-filter-bar,
      #rwOtherMachineReportControls,
      .machine-completion-filter-bar,
      #machineCompletionReportBar {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }

      .filter-bar,
      .loss-filter-bar,
      .machine-completion-filter-bar,
      #rwOtherMachineReportControls {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
        gap: 7px !important;
        padding: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        overflow: hidden !important;
      }

      .filter-bar > *,
      .loss-filter-bar > *,
      #rwOtherMachineReportControls > *,
      .machine-completion-filter-bar > *,
      .filter-bar select,
      .loss-filter-bar select,
      .filter-bar input,
      .loss-filter-bar input,
      .filter-bar button,
      .loss-filter-bar button,
      .dash-select,
      .dash-btn,
      .dash-btn.primary,
      .dashboard-page .dash-btn,
      #refreshBtn,
      #showRwOtherMachineReportBtn,
      #showMachineCompletionReportBtn {
        display: block !important;
        flex: 0 1 auto !important;
        width: 100% !important;
        inline-size: 100% !important;
        max-width: 100% !important;
        max-inline-size: 100% !important;
        min-width: 0 !important;
        min-inline-size: 0 !important;
        box-sizing: border-box !important;
        justify-self: stretch !important;
        align-self: stretch !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }

      .dash-select,
      .filter-bar input,
      .loss-filter-bar input {
        height: 38px !important;
        min-height: 38px !important;
        padding: 0 9px !important;
        font-size: 10.5px !important;
        line-height: 1.15 !important;
        text-align: left !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .dash-btn,
      .dash-btn.primary,
      .filter-bar button,
      .loss-filter-bar button,
      #refreshBtn,
      #showRwOtherMachineReportBtn,
      #showMachineCompletionReportBtn {
        height: auto !important;
        min-height: 42px !important;
        padding: 8px 9px !important;
        font-size: 10.5px !important;
        line-height: 1.15 !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
        text-align: center !important;
        overflow: visible !important;
      }

      #showRwOtherMachineReportBtn,
      #showMachineCompletionReportBtn {
        min-height: 46px !important;
      }
    }
  `;

  function applyClamp() {
    const old = document.getElementById(STYLE_ID);
    if (old) old.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  applyClamp();
  window.addEventListener("load", applyClamp);
  setTimeout(applyClamp, 900);
  setTimeout(applyClamp, 1800);
  setTimeout(applyClamp, 3500);
})();
