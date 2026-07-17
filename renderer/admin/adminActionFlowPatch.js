// renderer/admin/adminActionFlowPatch.js
// Only Work & Sub Work add buttons float at the bottom; other Admin actions stay normal.
(function () {
  const STYLE_ID = "adminActionFlowPatchStyle";
  const ALL_ACTION_SELECTOR = "#adminPanel .admin-floating-actions, .admin-panel .admin-floating-actions";
  const WORK_ACTION_SELECTOR = "#tabWork > .admin-floating-actions, #adminPanel #tabWork > .admin-floating-actions, .admin-panel #tabWork > .admin-floating-actions";
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
      ${ALL_ACTION_SELECTOR} {
        position: static !important;
        top: auto !important;
        bottom: auto !important;
        z-index: auto !important;
        margin-top: 14px !important;
        padding: 12px 0 8px !important;
        background: transparent !important;
        border-top: 1px solid rgba(15, 23, 42, .08) !important;
        display: flex !important;
        justify-content: flex-end !important;
        align-items: center !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
        box-shadow: none !important;
      }

      ${WORK_ACTION_SELECTOR} {
        position: sticky !important;
        bottom: 12px !important;
        top: auto !important;
        z-index: 95 !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 12px 0 14px !important;
        padding: 10px 12px !important;
        background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,252,.98)) !important;
        border: 1px solid rgba(15,23,42,.10) !important;
        border-radius: 16px !important;
        box-shadow: 0 -10px 28px rgba(15,23,42,.12) !important;
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
        ${ALL_ACTION_SELECTOR},
        ${FOOTER_SELECTOR},
        ${FOOTER_ROW_SELECTOR} {
          width: 100% !important;
          max-width: 100% !important;
          flex-direction: column !important;
          align-items: stretch !important;
          justify-content: flex-start !important;
        }

        ${WORK_ACTION_SELECTOR} {
          bottom: 8px !important;
        }
      }
    `;
  }

  function restoreWorkActionOriginalPlace() {
    const workTab = document.getElementById("tabWork");
    const action = workTab?.querySelector(":scope > .admin-floating-actions");
    if (!workTab || !action) return;

    // Keep Work buttons after the Work & Sub Work grid so sticky-bottom works from start to end.
    const grid = workTab.querySelector(":scope > .work-admin-grid");
    if (grid && grid.nextElementSibling !== action) grid.insertAdjacentElement("afterend", action);
  }

  function forceActionFlow() {
    addStyles();
    restoreWorkActionOriginalPlace();

    document.querySelectorAll(ALL_ACTION_SELECTOR).forEach((el) => {
      const isWork = el.closest("#tabWork");
      el.style.setProperty("position", isWork ? "sticky" : "static", "important");
      el.style.setProperty("bottom", isWork ? (window.innerWidth <= 700 ? "8px" : "12px") : "auto", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("z-index", isWork ? "95" : "auto", "important");
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
