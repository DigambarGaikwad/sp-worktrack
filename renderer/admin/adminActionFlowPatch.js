// renderer/admin/adminActionFlowPatch.js
// Keeps Admin add/action buttons floating near active tab content, not stuck at page bottom.
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
        position: sticky !important;
        top: var(--spwt-admin-action-top, 96px) !important;
        bottom: auto !important;
        z-index: 90 !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 10px 0 14px !important;
        padding: 10px 12px !important;
        background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.96)) !important;
        border: 1px solid rgba(15,23,42,.10) !important;
        border-radius: 16px !important;
        box-shadow: 0 10px 24px rgba(15,23,42,.10) !important;
        display: flex !important;
        justify-content: flex-end !important;
        align-items: center !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
        backdrop-filter: blur(8px);
      }

      #adminPanel .tab-page.hidden .admin-floating-actions,
      .admin-panel .tab-page.hidden .admin-floating-actions {
        display: none !important;
      }

      ${FOOTER_SELECTOR} {
        position: static !important;
        bottom: auto !important;
        top: auto !important;
        z-index: auto !important;
        margin-top: 18px !important;
        padding: 14px 0 0 !important;
        background: transparent !important;
        border-top: 1px solid rgba(15,23,42,.12) !important;
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
        ${ACTION_SELECTOR} {
          top: var(--spwt-admin-action-top-mobile, 70px) !important;
          align-items: stretch !important;
          justify-content: flex-start !important;
        }

        ${ACTION_SELECTOR} .btn,
        ${ACTION_SELECTOR} button {
          width: 100% !important;
        }

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

  function placeActionBarsNearContentTop() {
    document.querySelectorAll("#adminPanel .tab-page, .admin-panel .tab-page").forEach((page) => {
      const action = page.querySelector(":scope > .admin-floating-actions");
      if (!action) return;

      const workGrid = page.querySelector(":scope > .work-admin-grid");
      const list = page.querySelector(":scope > .list");
      const firstCard = page.querySelector(":scope > .card, :scope > .admin-db-card, :scope > .grid-2");
      const anchor = workGrid || list || firstCard;

      if (anchor && action.nextElementSibling !== anchor) {
        page.insertBefore(action, anchor);
      }
    });
  }

  function forceActionFlow() {
    addStyles();
    placeActionBarsNearContentTop();

    document.querySelectorAll(ACTION_SELECTOR).forEach((el) => {
      el.style.setProperty("position", "sticky", "important");
      el.style.setProperty("top", window.innerWidth <= 700 ? "70px" : "96px", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("z-index", "90", "important");
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("flex-wrap", "wrap", "important");
      el.style.setProperty("justify-content", window.innerWidth <= 700 ? "flex-start" : "flex-end", "important");
    });

    document.querySelectorAll(FOOTER_SELECTOR).forEach((el) => {
      el.style.setProperty("position", "static", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("z-index", "auto", "important");
      el.style.setProperty("background", "transparent", "important");
    });

    document.querySelectorAll(FOOTER_ROW_SELECTOR).forEach((el) => {
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("flex-wrap", "wrap", "important");
      el.style.setProperty("justify-content", window.innerWidth <= 700 ? "flex-start" : "flex-end", "important");
    });
  }

  function startObserver() {
    const panel = document.getElementById("adminPanel");
    if (!panel || panel.__spwtActionFlowObserver) return;
    panel.__spwtActionFlowObserver = true;
    const observer = new MutationObserver(() => requestAnimationFrame(forceActionFlow));
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  function init() {
    forceActionFlow();
    startObserver();
  }

  init();
  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("load", init);
  window.addEventListener("resize", () => requestAnimationFrame(forceActionFlow));
  document.addEventListener("click", () => setTimeout(forceActionFlow, 50), true);
  [100, 300, 700, 1200, 2500, 5000].forEach((ms) => setTimeout(init, ms));
})();
