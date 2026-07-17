// renderer/shared/appHeaderPolish.js
// Final shared header polish: consistent font/size, small radius, slight top offset.
(function () {
  const STYLE_ID = "spwt-shared-header-final-polish";

  function injectHeaderPolish() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      :root {
        --sp-header-height: 84px !important;
      }

      #spAppHeader,
      #spAppHeader * {
        box-sizing: border-box !important;
        font-family: "Segoe UI", Arial, Helvetica, sans-serif !important;
      }

      #spAppHeader {
        padding: 6px 8px 0 !important;
        max-width: 100vw !important;
        overflow: visible !important;
      }

      #spAppHeader .shared-topbar {
        height: 70px !important;
        min-height: 70px !important;
        border-radius: 6px !important;
        padding: 0 18px !important;
      }

      #spAppHeader .shared-topbar .brand .title {
        font-family: "Segoe UI", Arial, Helvetica, sans-serif !important;
        font-size: 22px !important;
        line-height: 1.08 !important;
        font-weight: 900 !important;
        letter-spacing: -0.35px !important;
      }

      #spAppHeader .shared-topbar .brand .subtitle {
        font-family: "Segoe UI", Arial, Helvetica, sans-serif !important;
        font-size: 12px !important;
        line-height: 1.15 !important;
        font-weight: 500 !important;
      }

      #spAppHeader .shared-topbar #currentDate {
        font-family: "Segoe UI", Arial, Helvetica, sans-serif !important;
        font-size: 13px !important;
        line-height: 1 !important;
        font-weight: 850 !important;
      }

      #spAppHeader .shared-nav-btn,
      #spAppHeader .shared-nav-icon,
      #spAppHeader .shared-nav-label,
      #spAppHeader .mobile-menu-btn,
      #spAppHeader .mobile-menu-link,
      #spAppHeader .mobile-menu-date {
        font-family: "Segoe UI", Arial, Helvetica, sans-serif !important;
      }

      #spAppHeader .shared-nav-icon {
        font-size: 23px !important;
        line-height: 1 !important;
      }

      #spAppHeader .shared-nav-label {
        font-size: 10px !important;
        line-height: 1 !important;
        font-weight: 800 !important;
      }

      #spAppHeader .shared-nav-btn.settings {
        border-radius: 8px !important;
      }

      #spAppHeader .mobile-menu-btn {
        border-radius: 8px !important;
      }

      @media (max-width: 1220px) {
        #spAppHeader .shared-topbar .brand .title { font-size: 19px !important; }
        #spAppHeader .shared-topbar .brand .subtitle { font-size: 10.5px !important; }
      }

      @media (max-width: 900px), (pointer: coarse) and (max-width: 1180px) {
        :root { --sp-header-height: 60px !important; }
        #spAppHeader { padding: 6px 6px 0 !important; }
        #spAppHeader .shared-topbar {
          height: 52px !important;
          min-height: 52px !important;
          border-radius: 5px !important;
          padding: 0 10px !important;
        }
        #spAppHeader .shared-topbar .brand .title {
          font-size: 14px !important;
          line-height: 1.05 !important;
          font-weight: 900 !important;
        }
        #spAppHeader .shared-topbar .brand .subtitle {
          font-size: 7.6px !important;
          line-height: 1.05 !important;
          font-weight: 500 !important;
        }
        #spAppHeader .shared-topbar .mobile-menu-panel {
          top: 64px !important;
          border-radius: 8px !important;
        }
      }

      @media (max-width: 360px) {
        #spAppHeader .shared-topbar .brand .title { font-size: 13px !important; }
        #spAppHeader .shared-topbar .brand .subtitle { font-size: 7px !important; }
      }
    `;
  }

  injectHeaderPolish();
  document.addEventListener("DOMContentLoaded", injectHeaderPolish, { once: true });
  window.addEventListener("load", injectHeaderPolish);
})();
