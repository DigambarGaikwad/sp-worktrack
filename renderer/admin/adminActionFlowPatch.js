// renderer/admin/adminActionFlowPatch.js
// Only Work & Sub Work add buttons float at the viewport bottom; other Admin actions stay normal.
(function () {
  const STYLE_ID = "adminActionFlowPatchStyle";
  const ALL_ACTION_SELECTOR = "#adminPanel .admin-floating-actions, .admin-panel .admin-floating-actions";
  const WORK_ACTION_SELECTOR = "#tabWork:not(.hidden) > .admin-floating-actions, #adminPanel #tabWork:not(.hidden) > .admin-floating-actions, .admin-panel #tabWork:not(.hidden) > .admin-floating-actions";
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
        left: auto !important;
        right: auto !important;
        z-index: auto !important;
        width: auto !important;
        max-width: 100% !important;
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
        position: fixed !important;
        left: 18px !important;
        right: 34px !important;
        bottom: 16px !important;
        top: auto !important;
        z-index: 9998 !important;
        width: auto !important;
        max-width: calc(100vw - 52px) !important;
        margin: 0 !important;
        padding: 10px 12px !important;
        background: linear-gradient(180deg, rgba(255,255,255,.97), rgba(248,250,252,.99)) !important;
        border: 1px solid rgba(15,23,42,.12) !important;
        border-radius: 16px !important;
        box-shadow: 0 -10px 28px rgba(15,23,42,.16) !important;
        display: flex !important;
        justify-content: flex-end !important;
        align-items: center !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
        backdrop-filter: blur(8px);
      }

      #tabWork:not(.hidden) {
        padding-bottom: 92px !important;
      }

      #adminPanel .tab-page.hidden .admin-floating-actions,
      .admin-panel .tab-page.hidden .admin-floating-actions {
        display: none !important;
      }

      ${FOOTER_SELECTOR} {
        position: static !important;
        bottom: auto !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
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
          left: 10px !important;
          right: 10px !important;
          bottom: 10px !important;
          width: auto !important;
          max-width: calc(100vw - 20px) !important;
        }

        #tabWork:not(.hidden) {
          padding-bottom: 160px !important;
        }
      }
    `;
  }

  function forceActionFlow() {
    addStyles();

    document.querySelectorAll(ALL_ACTION_SELECTOR).forEach((el) => {
      const isWorkVisible = !!el.closest("#tabWork:not(.hidden)");
      el.style.setProperty("position", isWorkVisible ? "fixed" : "static", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("bottom", isWorkVisible ? (window.innerWidth <= 700 ? "10px" : "16px") : "auto", "important");
      el.style.setProperty("left", isWorkVisible ? (window.innerWidth <= 700 ? "10px" : "18px") : "auto", "important");
      el.style.setProperty("right", isWorkVisible ? (window.innerWidth <= 700 ? "10px" : "34px") : "auto", "important");
      el.style.setProperty("z-index", isWorkVisible ? "9998" : "auto", "important");
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("flex-wrap", "wrap", "important");
      el.style.setProperty("justify-content", window.innerWidth <= 700 ? "flex-start" : "flex-end", "important");
    });

    const workTab = document.getElementById("tabWork");
    if (workTab && !workTab.classList.contains("hidden")) {
      workTab.style.setProperty("padding-bottom", window.innerWidth <= 700 ? "160px" : "92px", "important");
    }

    document.querySelectorAll(FOOTER_SELECTOR).forEach((el) => {
      el.style.setProperty("position", "static", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("left", "auto", "important");
      el.style.setProperty("right", "auto", "important");
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