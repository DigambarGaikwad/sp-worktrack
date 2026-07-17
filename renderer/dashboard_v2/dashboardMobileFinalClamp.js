// renderer/dashboard_v2/dashboardMobileFinalClamp.js
// Last-loaded mobile clamp for Machine Dashboard filters and report controls.
(function () {
  const STYLE_ID = "dashboardMobileFinalClampStyle";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
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
      .dash-btn,
      .filter-bar input,
      .loss-filter-bar input,
      .filter-bar button,
      .loss-filter-bar button,
      #showRwOtherMachineReportBtn,
      #showMachineCompletionReportBtn {
        height: 38px !important;
        min-height: 38px !important;
        padding: 0 9px !important;
        font-size: 10.5px !important;
        line-height: 1.15 !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        text-align: center !important;
      }

      .dash-select,
      .filter-bar select,
      .loss-filter-bar select,
      .filter-bar input,
      .loss-filter-bar input {
        text-align: left !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
    }
  `;
  document.head.appendChild(style);
})();
