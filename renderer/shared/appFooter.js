// Shared SP WorkTrack footer for all pages.
(function () {
  const FOOTER_STYLE_ID = "spwt-shared-footer-style";
  const FOOTER_HTML = `
    <div class="footer-top">
      <span>SP WorkTrack</span>
      <span>Production &amp; Performance Management System</span>
    </div>
    <div class="footer-bottom">
      <span>&copy; 2026 Digambar Gaikwad</span>
      <span>Developed for Sopan Process Technologies</span>
    </div>
  `;

  function ensureStyles() {
    if (document.getElementById(FOOTER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FOOTER_STYLE_ID;
    style.textContent = `
      .app-footer {
        width: calc(100% - 40px);
        margin: 18px auto 14px;
        padding: 12px 18px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 16px;
        background: #ffffff;
        color: #475569;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
      }
      .app-footer .footer-top,
      .app-footer .footer-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .app-footer .footer-top {
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
        margin-bottom: 4px;
      }
      .app-footer .footer-bottom {
        font-size: 12px;
        font-weight: 700;
      }
      @media (max-width: 768px) {
        .app-footer {
          width: calc(100% - 20px);
          margin: 14px auto 10px;
          padding: 10px 12px;
        }
        .app-footer .footer-top,
        .app-footer .footer-bottom {
          justify-content: center;
          text-align: center;
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
