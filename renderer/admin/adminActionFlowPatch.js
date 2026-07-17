// renderer/admin/adminActionFlowPatch.js
// Restores Admin action buttons to normal document flow. No sticky/fixed bottom actions.
(function () {
  const STYLE_ID = "adminActionFlowPatchStyle";
  const ACTION_SELECTOR = "#adminPanel .admin-floating-actions, .admin-panel .admin-floating-actions";
  const FOOTER_SELECTOR = "#adminPanel > .row-between:last-child, .admin-panel > .row-between:last-child";
  const FOOTER_ROW_SELECTOR = "#adminPanel > .row-between:last-child .row, .admin-panel > .row-between:last-child .row";

  function addStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      ${ACTION_SELECTOR} {
        position: static !important;
        bottom: auto !important;
        top: auto !important;
        z-index: auto !important;
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

      ${FOOTER_SELECTOR} {
        position: static !important;
        bottom: auto !important;
        top: auto !important;
        z-index: auto !important;
        margin-top: 18px !important;
        padding: 14px 0 0 !important;
        background: transparent !important;
        border-top: 1px solid rgba(15, 23, 42, 0.12) !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 12px !important;
      }

      ${FOOTER_ROW_SELECTOR} {
        display: flex !important;
        gap: 10px !important;
        align-items: center !important;
        justify-content: flex-end !important;
        flex-wrap: wrap !important;
      }

      @media (max-width: 700px) {
        ${ACTION_SELECTOR},
        ${FOOTER_SELECTOR},
        ${FOOTER_ROW_SELECTOR} {
          width: 100% !important;
          max-width: 100% !important;
          flex-direction: column !important;
          align-items: stretch !important;
          justify-content: flex-start !important;
        }
      }
    `;
  }

  function forceNormalFlow() {
    addStyles();

    document.querySelectorAll(`${ACTION_SELECTOR}, ${FOOTER_SELECTOR}`).forEach((el) => {
      el.style.setProperty("position", "static", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("z-index", "auto", "important");
      el.style.setProperty("background", "transparent", "important");
    });

    document.querySelectorAll(ACTION_SELECTOR).forEach((el) => {
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("flex-wrap", "wrap", "important");
      el.style.setProperty("justify-content", "flex-end", "important");
    });

    document.querySelectorAll(FOOTER_ROW_SELECTOR).forEach((el) => {
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("flex-wrap", "wrap", "important");
      el.style.setProperty("justify-content", "flex-end", "important");
    });
  }

  function startObserver() {
    const panel = document.getElementById("adminPanel");
    if (!panel || panel.__spwtActionFlowObserver) return;
    panel.__spwtActionFlowObserver = true;
    const observer = new MutationObserver(() => requestAnimationFrame(forceNormalFlow));
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  function init() {
    forceNormalFlow();
    startObserver();
  }

  init();
  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("load", init);
  document.addEventListener("click", () => setTimeout(forceNormalFlow, 50), true);
  [100, 300, 700, 1200, 2500, 5000].forEach((ms) => setTimeout(init, ms));
})();
