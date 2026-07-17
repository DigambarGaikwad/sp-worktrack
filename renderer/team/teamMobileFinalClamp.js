// renderer/team/teamMobileFinalClamp.js
// Last-loaded mobile clamp for People Dashboard filters, including overtime controls.
(function () {
  const STYLE_ID = "teamMobileFinalClampStyle";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @media (max-width: 700px) {
      html, body, .sp-app-shell, .sp-page, .people-page {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: hidden !important;
        box-sizing: border-box !important;
      }

      .people-page {
        padding: 8px !important;
      }

      .people-hero {
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
        gap: 10px !important;
      }

      .people-hero > *,
      .people-hero > div,
      .people-filters,
      .people-filter-bar,
      #overtimeReportControls {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }

      .people-filters,
      .people-filter-bar,
      #overtimeReportControls {
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

      .people-filters > *,
      .people-filter-bar > *,
      #overtimeReportControls > *,
      .people-filters select,
      .people-filter-bar select,
      .people-filters input,
      .people-filter-bar input,
      .people-filters button,
      .people-filter-bar button,
      .people-select,
      .people-btn,
      .people-page .people-btn,
      .people-page .sp-action-btn,
      #overtimeReportControls .people-select,
      #overtimeReportControls .people-btn,
      #overtimeReportControls .sp-action-btn,
      #showPerformanceReportBtn,
      #showAbsentReportBtn,
      #showOvertimeReportBtn {
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

      .people-select,
      .people-btn,
      .people-page .people-btn,
      .people-page .sp-action-btn,
      .people-filters input,
      .people-filter-bar input,
      .people-filters button,
      .people-filter-bar button {
        height: 38px !important;
        min-height: 38px !important;
        padding: 0 9px !important;
        font-size: 10.5px !important;
        line-height: 1.15 !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        text-align: center !important;
      }

      .people-select,
      .people-filters select,
      .people-filter-bar select,
      .people-filters input,
      .people-filter-bar input {
        text-align: left !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
    }
  `;
  document.head.appendChild(style);
})();
