// renderer/admin/adminActionFlowPatch.js
// Restores Admin action buttons to normal document flow. No sticky/fixed bottom actions.
(function () {
  const STYLE_ID = "adminActionFlowPatchStyle";

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #adminPanel .admin-floating-actions {
        position: static !important;
        bottom: auto !important;
        top: auto !important;
        z-index: 1 !important;
        margin-top: 14px !important;
        padding: 12px 0 8px !important;
        background: transparent !important;
        border-top: 1px solid rgba(15, 23, 42, 0.08) !important;
        display: flex !important;
        justify-content: flex-end !important;
        align-items: center !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
      }

      #adminPanel > .row-between:last-child {
        position: static !important;
        bottom: auto !important;
        top: auto !important;
        z-index: 1 !important;
        margin-top: 18px !important;
        padding: 14px 0 0 !important;
        background: transparent !important;
        border-top: 1px solid rgba(15, 23, 42, 0.12) !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 12px !important;
      }

      #adminPanel > .row-between:last-child .row {
        display: flex !important;
        gap: 10px !important;
        align-items: center !important;
        justify-content: flex-end !important;
        flex-wrap: wrap !important;
      }

      @media (max-width: 700px) {
        #adminPanel .admin-floating-actions,
        #adminPanel > .row-between:last-child,
        #adminPanel > .row-between:last-child .row {
          width: 100% !important;
          max-width: 100% !important;
          flex-direction: column !important;
          align-items: stretch !important;
          justify-content: flex-start !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  addStyles();
  document.addEventListener("DOMContentLoaded", addStyles);
  window.addEventListener("load", addStyles);
  setTimeout(addStyles, 500);
  setTimeout(addStyles, 1500);
})();
