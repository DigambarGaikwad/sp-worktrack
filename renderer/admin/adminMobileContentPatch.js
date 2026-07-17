// renderer/admin/adminMobileContentPatch.js
// Mobile content clamp for Admin tabs. Keeps desktop unchanged.
(function () {
  const STYLE_ID = "adminMobileContentPatchStyle";
  const MOBILE_MAX = 700;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    ensureViewportMeta();
    addStyles();
    applyTableScroll();
    startObserver();
    [300, 900, 1800, 3500].forEach((ms) => setTimeout(applyTableScroll, ms));
  }

  function ensureViewportMeta() {
    if (document.querySelector('meta[name="viewport"]')) return;
    const meta = document.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1.0";
    document.head.appendChild(meta);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @media (max-width: 700px) {
        *, *::before, *::after { box-sizing: border-box !important; }

        html, body {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          margin: 0 !important;
          overflow-x: hidden !important;
        }

        .sp-app-shell,
        .sp-page,
        .admin-page,
        .admin-page-card,
        .admin-page-body,
        #adminPanel,
        .tab-page {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: hidden !important;
        }

        .admin-page { padding: 8px !important; }
        .admin-page-card { margin: 0 !important; border-radius: 16px !important; }
        .admin-page-body { padding: 0 !important; }
        .admin-panel { padding: 0 !important; }
        .tab-page { padding: 0 !important; }

        .admin-page-head h1 {
          font-size: 30px !important;
          line-height: 1.05 !important;
          margin: 0 0 8px !important;
          overflow-wrap: anywhere !important;
        }

        .section-title {
          font-size: 18px !important;
          line-height: 1.2 !important;
          margin: 10px 0 !important;
          overflow-wrap: anywhere !important;
        }

        .small-hint,
        .admin-page label,
        .admin-panel label {
          max-width: 100% !important;
          overflow-wrap: anywhere !important;
          line-height: 1.35 !important;
        }

        .grid,
        .grid-2,
        .admin-grid,
        .work-admin-grid,
        .skill-grid,
        .skill-grid-2,
        .skill-metrics,
        .summary-cards,
        .work-admin-grid .work-admin-panel:nth-child(3) {
          display: grid !important;
          grid-template-columns: 1fr !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          gap: 10px !important;
        }

        .field,
        .row,
        .row-between,
        .planned-row,
        .planned-row-actions,
        .admin-controls-actions,
        .spwt-access-actions,
        .admin-floating-actions,
        #adminPanel > .row-between:last-child,
        #adminPanel > .row-between:last-child .row {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          justify-content: flex-start !important;
          gap: 8px !important;
        }

        #adminPanel > .row-between:last-child,
        .admin-floating-actions {
          position: static !important;
          bottom: auto !important;
          padding: 10px 0 !important;
          margin-top: 12px !important;
          background: transparent !important;
          border-top: 1px solid rgba(15,23,42,.08) !important;
        }

        .btn,
        .admin-page button,
        .admin-page a.btn,
        .admin-panel button,
        .admin-panel a.btn,
        .admin-input,
        .admin-select,
        input,
        select,
        textarea {
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }

        .admin-page button,
        .admin-page a.btn,
        .admin-panel button,
        .admin-panel a.btn {
          width: 100% !important;
          min-height: 42px !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
          text-align: center !important;
        }

        .admin-input,
        .admin-select,
        .admin-page input:not([type="checkbox"]):not([type="radio"]),
        .admin-page select,
        .admin-page textarea {
          width: 100% !important;
          height: 42px !important;
          font-size: 13px !important;
        }

        .admin-page textarea { height: auto !important; min-height: 72px !important; }

        .quality-recheck-line,
        .spwt-permission-check,
        .mini-check {
          display: flex !important;
          flex-direction: row !important;
          align-items: flex-start !important;
          justify-content: flex-start !important;
          width: 100% !important;
          white-space: normal !important;
          gap: 8px !important;
        }

        .quality-recheck-line input,
        .spwt-permission-check input,
        .mini-check input,
        input[type="checkbox"],
        input[type="radio"] {
          width: 16px !important;
          min-width: 16px !important;
          height: 16px !important;
          margin-top: 2px !important;
        }

        .list,
        .table-wrap,
        .sum-table,
        .sum-table-wrap,
        .spwt-access-list,
        .spwt-mobile-scrollwrap,
        #machinesList,
        #employeesList,
        #shiftsList,
        #lossReasonsList,
        #rootAreasList,
        #accessUsersList,
        #qualityReportRecipientsTable,
        #capacityPlanRecipientsTable,
        #rwReportRecipientsTable,
        #overtimeReportRecipientsTable,
        #skillMatrixBody,
        #backupLastSummaryTable {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: auto !important;
          overflow-y: visible !important;
          -webkit-overflow-scrolling: touch !important;
        }

        .admin-table,
        .mini-table table,
        .sum-table table,
        #adminPanel table {
          width: max-content !important;
          min-width: 680px !important;
          max-width: none !important;
          table-layout: auto !important;
        }

        #machinesList table { min-width: 760px !important; }
        #employeesList table { min-width: 900px !important; }
        #shiftsList table { min-width: 760px !important; }
        #tabUsersAccess table { min-width: 980px !important; }
        #tabSkillMatrix table { min-width: 980px !important; }
        #tabQualityReportEmails table,
        #tabReportEmails table,
        #qualityReportRecipientsTable table,
        #capacityPlanRecipientsTable table,
        #rwReportRecipientsTable,
        #overtimeReportRecipientsTable { min-width: 900px !important; }

        .admin-table th,
        .admin-table td,
        #adminPanel table th,
        #adminPanel table td {
          white-space: nowrap !important;
          vertical-align: middle !important;
          padding: 9px 10px !important;
        }

        .admin-table td input,
        .admin-table td select,
        #adminPanel table td input,
        #adminPanel table td select {
          min-width: 120px !important;
        }

        #employeesList table td:nth-child(2) input { min-width: 220px !important; }
        #employeesList table td:nth-child(4) input { min-width: 170px !important; }

        .work-admin-panel,
        .admin-db-card,
        .admin-controls-card,
        .skill-matrix-card,
        .admin-subwork-card,
        .wide-admin-card,
        .sum-table-wrap,
        .card {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
          padding: 12px !important;
        }

        .work-admin-item,
        .admin-subwork-head,
        .mini-row,
        .mini-row.booking-row,
        .mini-row.quality-row {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          display: grid !important;
          grid-template-columns: 1fr !important;
          grid-template-areas: none !important;
          gap: 8px !important;
        }

        .mini-row.quality-row input.admin-input,
        .mini-row.quality-row select.admin-select,
        .mini-row.quality-row .mini-check,
        .mini-row.quality-row button,
        .mini-row.booking-row > * {
          grid-area: auto !important;
          width: 100% !important;
          justify-self: stretch !important;
        }

        .admin-subwork-list,
        .skill-coverage,
        .skill-chip-wrap,
        .spwt-extra-permissions {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 8px !important;
        }

        .skill-chip,
        .skill-type-pill {
          max-width: 100% !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        .app-footer {
          width: 100% !important;
          max-width: 100% !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function applyTableScroll() {
    if (window.innerWidth > MOBILE_MAX) return;
    document.querySelectorAll("#adminPanel table").forEach((table) => {
      const parent = table.parentElement;
      if (!parent || parent === document.body || parent.classList.contains("spwt-mobile-scrollwrap")) return;
      parent.classList.add("spwt-mobile-scrollwrap");
    });
  }

  function startObserver() {
    const panel = document.getElementById("adminPanel");
    if (!panel || panel.__spwtAdminContentObserver) return;
    panel.__spwtAdminContentObserver = true;
    const observer = new MutationObserver(() => requestAnimationFrame(applyTableScroll));
    observer.observe(panel, { childList: true, subtree: true });
    window.addEventListener("resize", () => requestAnimationFrame(applyTableScroll));
    document.addEventListener("click", () => setTimeout(applyTableScroll, 120), true);
  }
})();
