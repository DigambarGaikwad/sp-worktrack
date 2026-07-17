// renderer/dashboard_v2/dashboardMobileFinalClamp.js
// Last-loaded measured mobile clamp for Machine Dashboard filters and report controls.
(function () {
  const STYLE_ID = "dashboardMobileFinalClampStyle";
  const MOBILE_MAX = 700;

  const CSS = `
    @media (max-width: 700px) {
      *, *::before, *::after { box-sizing: border-box !important; }

      html,
      body {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        overflow-x: hidden !important;
      }

      .sp-app-shell,
      .sp-page,
      .dash-shell {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: hidden !important;
      }

      .dash-shell {
        padding: 8px !important;
      }

      .dash-topbar {
        width: auto !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 0 14px 0 !important;
        padding: 14px 10px !important;
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
        overflow: hidden !important;
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
        align-self: stretch !important;
        justify-self: stretch !important;
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

  function important(el, prop, value) {
    if (el?.style) el.style.setProperty(prop, value, "important");
  }

  function viewportWidth() {
    const a = document.documentElement?.clientWidth || 0;
    const b = window.innerWidth || 0;
    return Math.max(240, Math.min(a || b, b || a));
  }

  function applyCss() {
    const old = document.getElementById(STYLE_ID);
    if (old) old.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function clampElement(el, px) {
    if (!el) return;
    important(el, "box-sizing", "border-box");
    important(el, "min-width", "0");
    important(el, "min-inline-size", "0");
    important(el, "width", `${px}px`);
    important(el, "inline-size", `${px}px`);
    important(el, "max-width", `${px}px`);
    important(el, "max-inline-size", `${px}px`);
    important(el, "margin-left", "0");
    important(el, "margin-right", "0");
  }

  function measuredClamp() {
    if (viewportWidth() > MOBILE_MAX) return;

    const vw = viewportWidth();
    const shell = document.querySelector(".dash-shell");
    const topbar = document.querySelector(".dash-topbar");
    const shellMax = Math.max(240, vw - 16);

    important(document.documentElement, "overflow-x", "hidden");
    important(document.body, "overflow-x", "hidden");

    if (shell) {
      important(shell, "box-sizing", "border-box");
      important(shell, "width", `${shellMax}px`);
      important(shell, "max-width", `${shellMax}px`);
      important(shell, "min-width", "0");
      important(shell, "padding", "8px");
      important(shell, "overflow-x", "hidden");
    }

    if (topbar) {
      const topbarMax = Math.max(220, shellMax - 16);
      important(topbar, "box-sizing", "border-box");
      important(topbar, "width", `${topbarMax}px`);
      important(topbar, "max-width", `${topbarMax}px`);
      important(topbar, "min-width", "0");
      important(topbar, "overflow", "hidden");
      important(topbar, "display", "flex");
      important(topbar, "flex-direction", "column");
      important(topbar, "align-items", "stretch");
    }

    const bars = Array.from(document.querySelectorAll(
      ".dash-topbar .filter-bar, .loss-filter-bar, #rwOtherMachineReportControls, .machine-completion-filter-bar"
    ));

    bars.forEach((bar) => {
      const available = Math.max(190, Math.min(
        Math.floor(bar.parentElement?.clientWidth || topbar?.clientWidth || shellMax),
        shellMax - 36
      ));

      important(bar, "box-sizing", "border-box");
      important(bar, "display", "flex");
      important(bar, "flex-direction", "column");
      important(bar, "align-items", "stretch");
      important(bar, "width", `${available}px`);
      important(bar, "max-width", `${available}px`);
      important(bar, "min-width", "0");
      important(bar, "overflow", "hidden");

      Array.from(bar.children).forEach((child) => {
        if (child.id === "rwOtherMachineReportControls") return;
        clampElement(child, available);
      });
    });

    Array.from(document.querySelectorAll(
      ".dash-topbar .dash-select, .dash-topbar .dash-btn, #rwOtherMachineReportControls > *, #showRwOtherMachineReportBtn, #showMachineCompletionReportBtn"
    )).forEach((el) => {
      const host = el.closest("#rwOtherMachineReportControls") || el.closest(".filter-bar") || el.closest(".loss-filter-bar") || el.closest(".machine-completion-filter-bar") || topbar;
      const px = Math.max(190, Math.min(Math.floor(host?.clientWidth || shellMax - 36), shellMax - 36));
      clampElement(el, px);
      if (el.tagName === "BUTTON") {
        important(el, "height", "auto");
        important(el, "min-height", el.id === "showRwOtherMachineReportBtn" ? "46px" : "42px");
        important(el, "white-space", "normal");
        important(el, "overflow", "visible");
        important(el, "overflow-wrap", "anywhere");
        important(el, "text-align", "center");
      }
    });
  }

  function applyClamp() {
    applyCss();
    measuredClamp();
  }

  applyClamp();
  window.addEventListener("load", applyClamp);
  window.addEventListener("resize", () => requestAnimationFrame(applyClamp));
  setTimeout(applyClamp, 300);
  setTimeout(applyClamp, 900);
  setTimeout(applyClamp, 1800);
  setTimeout(applyClamp, 3500);
  setInterval(measuredClamp, 1200);
})();