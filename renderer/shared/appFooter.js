// Shared SP WorkTrack footer for all pages.
(function () {
  const FOOTER_STYLE_ID = "spwt-shared-footer-style";
  const FOOTER_HTML = `
    <div class="sp-footer-left">
      <div class="sp-footer-title">SP WorkTrack</div>
      <div class="sp-footer-note sp-footer-credit">&copy; 2026 Digambar Gaikwad</div>
    </div>
    <div class="sp-footer-right">
      <div class="sp-footer-title">Production &amp; Performance Management System</div>
      <div class="sp-footer-note">Developed for Sopan Process Technologies</div>
    </div>
  `;

  function ensureStyles() {
    if (document.getElementById(FOOTER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FOOTER_STYLE_ID;
    style.textContent = `
      .app-footer {
        width: calc(100% - 40px) !important;
        max-width: none !important;
        margin: 18px auto 14px !important;
        padding: 13px 18px !important;
        border: 1px solid rgba(249, 115, 22, 0.18) !important;
        border-left: 4px solid rgba(249, 115, 22, 0.75) !important;
        border-radius: 16px !important;
        background: linear-gradient(135deg, #ffffff 0%, #ffffff 58%, #fff7ed 100%) !important;
        color: #475569 !important;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.70) inset !important;
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 18px !important;
        align-self: stretch !important;
        flex: 0 0 auto !important;
        text-align: left !important;
      }
      .app-footer .sp-footer-left,
      .app-footer .sp-footer-right {
        min-width: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 5px !important;
      }
      .app-footer .sp-footer-left {
        align-items: flex-start !important;
        text-align: left !important;
      }
      .app-footer .sp-footer-right {
        align-items: flex-end !important;
        text-align: right !important;
      }
      .app-footer .sp-footer-title {
        color: #0f172a !important;
        font-size: 13px !important;
        font-weight: 900 !important;
        line-height: 1.2 !important;
      }
      .app-footer .sp-footer-note {
        color: #475569 !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        line-height: 1.2 !important;
      }
      .app-footer .sp-footer-credit {
        display: inline-flex !important;
        align-items: center !important;
        width: fit-content !important;
        max-width: 100% !important;
        padding: 3px 8px !important;
        border-radius: 999px !important;
        background: #fff7ed !important;
        color: #9a3412 !important;
        border: 1px solid rgba(249, 115, 22, 0.24) !important;
        box-shadow: 0 4px 12px rgba(249, 115, 22, 0.10) !important;
      }
      @media (max-width: 768px) {
        .app-footer {
          width: calc(100% - 20px) !important;
          margin: 14px auto 10px !important;
          padding: 11px 12px !important;
          grid-template-columns: 1fr !important;
          gap: 8px !important;
          text-align: center !important;
          border-left-width: 1px !important;
          border-top: 3px solid rgba(249, 115, 22, 0.65) !important;
        }
        .app-footer .sp-footer-left,
        .app-footer .sp-footer-right {
          align-items: center !important;
          text-align: center !important;
        }
      }
      @media print {
        .app-footer { display: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function preferredHost() {
    return document.querySelector(".sp-page") ||
      document.querySelector(".sp-app-shell") ||
      document.querySelector(".admin-page") ||
      document.querySelector(".app") ||
      document.body;
  }

  function renderAppFooter() {
    ensureStyles();
    let footer = document.querySelector(".app-footer");
    if (!footer) {
      footer = document.createElement("footer");
      footer.className = "app-footer";
      preferredHost().appendChild(footer);
    }
    footer.innerHTML = FOOTER_HTML;
  }

  window.SPWT = window.SPWT || {};
  window.SPWT.renderAppFooter = renderAppFooter;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderAppFooter, { once: true });
  } else {
    renderAppFooter();
  }
})();
