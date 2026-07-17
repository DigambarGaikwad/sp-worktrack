(function () {
  const HEADER_STYLE_ID = "spwt-shared-header-style";

  function ensureViewportMeta() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    meta.content = "width=device-width, initial-scale=1.0";
  }

  function ensureHeaderStyles() {
    let style = document.getElementById(HEADER_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = HEADER_STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      :root {
        --sp-header-height: 86px;
        --sp-header-bg-1: #061628;
        --sp-header-bg-2: #0a2742;
        --sp-header-bg-3: #07111f;
        --sp-header-accent: #22d3ee;
        --sp-header-accent-2: #f97316;
      }

      #spAppHeader {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        z-index: 50000 !important;
        isolation: isolate !important;
        transform: translateZ(0) !important;
        padding: 8px 14px 0 !important;
        pointer-events: none !important;
      }

      #spAppHeader + * { margin-top: var(--sp-header-height) !important; }
      #spAppHeader + .content {
        height: auto !important;
        min-height: calc(100vh - var(--sp-header-height)) !important;
        overflow-y: visible !important;
      }

      .sp-app-shell,
      .sp-page,
      .app { overflow: visible !important; }

      .app {
        height: auto !important;
        min-height: 100vh !important;
        display: block !important;
      }

      .shared-topbar {
        pointer-events: auto !important;
        height: 72px !important;
        min-height: 72px !important;
        width: 100% !important;
        max-width: none !important;
        margin: 0 auto !important;
        padding: 0 22px 0 18px !important;
        border-radius: 0 0 18px 18px !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 22px !important;
        position: relative !important;
        overflow: hidden !important;
        background:
          radial-gradient(circle at 7% 20%, rgba(34, 211, 238, 0.22), transparent 22%),
          radial-gradient(circle at 98% 18%, rgba(249, 115, 22, 0.10), transparent 18%),
          linear-gradient(115deg, var(--sp-header-bg-1) 0%, var(--sp-header-bg-2) 48%, var(--sp-header-bg-3) 100%) !important;
        border: 1px solid rgba(148, 163, 184, 0.16) !important;
        box-shadow: 0 14px 34px rgba(2, 6, 23, 0.24), inset 0 1px 0 rgba(255,255,255,0.08) !important;
      }

      .shared-topbar::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 250px;
        background:
          linear-gradient(120deg, rgba(34, 211, 238, 0.15), transparent 56%),
          repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 14px);
        clip-path: polygon(0 0, 84% 0, 62% 100%, 0 100%);
        opacity: 0.95;
        pointer-events: none;
      }

      .shared-topbar::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        background: linear-gradient(90deg, var(--sp-header-accent-2), var(--sp-header-accent), transparent 72%);
        opacity: 0.78;
        pointer-events: none;
      }

      .shared-topbar .left,
      .shared-topbar .right,
      .shared-nav-btn,
      .shared-topbar .about-btn {
        display: flex !important;
        align-items: center !important;
      }

      .shared-topbar .left {
        position: relative !important;
        z-index: 2 !important;
        gap: 16px !important;
        min-width: 270px !important;
        flex: 1 1 auto !important;
      }

      .shared-logo-box {
        width: 128px !important;
        height: 52px !important;
        flex: 0 0 128px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 14px !important;
        background: linear-gradient(135deg, rgba(255,255,255,0.12), rgba(34,211,238,0.04)) !important;
        border: 1px solid rgba(255,255,255,0.10) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08) !important;
        overflow: hidden !important;
      }

      .shared-topbar .logo {
        width: 116px !important;
        height: 46px !important;
        object-fit: contain !important;
        filter: drop-shadow(0 2px 5px rgba(0,0,0,0.35)) !important;
      }

      .shared-brand-divider {
        width: 1px !important;
        height: 42px !important;
        background: linear-gradient(180deg, transparent, rgba(255,255,255,0.26), transparent) !important;
        flex: 0 0 1px !important;
      }

      .shared-topbar .brand {
        min-width: 0 !important;
        overflow: hidden !important;
      }

      .shared-topbar .brand .title {
        font-size: 23px !important;
        font-weight: 900 !important;
        letter-spacing: -0.45px !important;
        line-height: 1.08 !important;
        color: #fff !important;
        text-shadow: 0 2px 8px rgba(0,0,0,0.32) !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .shared-topbar .brand .subtitle {
        margin-top: 4px !important;
        font-size: 12.6px !important;
        line-height: 1.15 !important;
        color: rgba(226, 232, 240, 0.92) !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .shared-topbar .desktop-nav {
        position: relative !important;
        z-index: 2 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 10px !important;
        flex: 0 0 auto !important;
      }

      .shared-topbar #currentDate {
        height: 42px !important;
        padding: 0 18px !important;
        margin: 0 12px 0 0 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 9px !important;
        color: #f8fafc !important;
        font-size: 14px !important;
        font-weight: 850 !important;
        border: 1px solid rgba(34, 211, 238, 0.24) !important;
        background: rgba(15, 23, 42, 0.38) !important;
        border-radius: 999px !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08) !important;
        white-space: nowrap !important;
      }

      .shared-topbar #currentDate::before {
        content: "▣";
        color: var(--sp-header-accent);
        font-size: 12px;
        line-height: 1;
      }

      .shared-nav-btn {
        position: relative !important;
        width: 70px !important;
        height: 58px !important;
        padding: 8px 6px 7px !important;
        border: 0 !important;
        border-left: 1px solid rgba(255,255,255,0.10) !important;
        background: transparent !important;
        color: rgba(226, 232, 240, 0.84) !important;
        border-radius: 0 !important;
        cursor: pointer !important;
        text-decoration: none !important;
        justify-content: center !important;
        flex-direction: column !important;
        gap: 4px !important;
        font-weight: 800 !important;
        transition: color 0.14s ease, transform 0.14s ease, background 0.14s ease, filter 0.14s ease !important;
      }

      .shared-nav-btn:hover,
      .shared-nav-btn.active {
        color: #ffffff !important;
        background: linear-gradient(180deg, rgba(34,211,238,0.09), rgba(34,211,238,0.02)) !important;
        transform: translateY(-1px) !important;
        filter: drop-shadow(0 0 12px rgba(34,211,238,0.28)) !important;
      }

      .shared-nav-icon {
        font-size: 24px !important;
        line-height: 1 !important;
      }

      .shared-nav-label {
        font-size: 11px !important;
        line-height: 1 !important;
        white-space: nowrap !important;
      }

      .shared-nav-btn.active::after {
        content: "";
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 2px;
        height: 3px;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--sp-header-accent), #60a5fa);
        box-shadow: 0 0 14px rgba(34,211,238,0.68);
      }

      .shared-nav-btn.settings {
        width: 58px !important;
        margin-left: 6px !important;
        border: 1px solid rgba(34,211,238,0.24) !important;
        border-radius: 15px !important;
        background: rgba(15, 23, 42, 0.30) !important;
      }

      .shared-nav-btn.settings .shared-nav-label { display: none !important; }
      .shared-nav-btn.settings .shared-nav-icon { font-size: 26px !important; }

      .shared-topbar .mobile-menu-wrap,
      .shared-topbar .mobile-menu-panel { display: none !important; }

      @media (max-width: 1180px) {
        .shared-topbar { gap: 12px !important; padding-right: 14px !important; }
        .shared-logo-box { width: 104px !important; flex-basis: 104px !important; }
        .shared-topbar .logo { width: 96px !important; }
        .shared-topbar .brand .title { font-size: 20px !important; }
        .shared-topbar .brand .subtitle { font-size: 11px !important; }
        .shared-nav-btn { width: 50px !important; }
        .shared-nav-label { display: none !important; }
        .shared-topbar #currentDate { padding: 0 12px !important; font-size: 12px !important; margin-right: 5px !important; }
      }

      @media (max-width: 900px), (pointer: coarse) and (max-width: 1180px) {
        :root { --sp-header-height: 58px; }
        #spAppHeader { padding: 7px 10px 0 !important; }

        .shared-topbar {
          height: 50px !important;
          min-height: 50px !important;
          padding: 0 10px !important;
          border-radius: 0 0 14px 14px !important;
          justify-content: flex-start !important;
          flex-wrap: nowrap !important;
          gap: 8px !important;
          overflow: hidden !important;
        }

        .shared-topbar::before { width: 132px !important; opacity: 0.58 !important; }

        .shared-topbar .left {
          flex: 1 1 auto !important;
          min-width: 0 !important;
          max-width: calc(100% - 48px) !important;
          gap: 7px !important;
          overflow: hidden !important;
        }

        .shared-logo-box {
          width: 50px !important;
          height: 36px !important;
          flex: 0 0 50px !important;
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }

        .shared-topbar .logo {
          width: 48px !important;
          height: 34px !important;
        }

        .shared-brand-divider { display: none !important; }
        .shared-topbar .brand { min-width: 0 !important; overflow: hidden !important; }

        .shared-topbar .brand .title {
          font-size: 14px !important;
          line-height: 1.05 !important;
          font-weight: 900 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }

        .shared-topbar .brand .subtitle {
          font-size: 7.6px !important;
          line-height: 1.05 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          opacity: 0.86 !important;
        }

        .shared-topbar .desktop-nav { display: none !important; }

        .shared-topbar .mobile-menu-wrap {
          display: block !important;
          flex: 0 0 38px !important;
          position: relative !important;
          z-index: 52000 !important;
          margin-left: auto !important;
        }

        .shared-topbar .mobile-menu-btn {
          width: 38px !important;
          height: 38px !important;
          min-height: 38px !important;
          padding: 0 !important;
          border: 1px solid rgba(34, 211, 238, 0.35) !important;
          border-radius: 12px !important;
          background: rgba(15, 23, 42, 0.32) !important;
          color: #ffffff !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 24px !important;
          line-height: 1 !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 0 16px rgba(34,211,238,0.12) !important;
        }

        .shared-topbar .mobile-menu-panel {
          display: none !important;
          position: fixed !important;
          left: 10px !important;
          right: 10px !important;
          top: 64px !important;
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          max-height: calc(100vh - 78px) !important;
          overflow-y: auto !important;
          padding: 10px !important;
          border-radius: 16px !important;
          background: linear-gradient(180deg, #ffffff, #f8fbff) !important;
          color: #0f172a !important;
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.28) !important;
          border: 1px solid rgba(15, 23, 42, 0.10) !important;
          z-index: 51000 !important;
        }

        .shared-topbar .mobile-menu-wrap.open .mobile-menu-panel { display: block !important; }

        .mobile-menu-date {
          padding: 8px 10px 10px !important;
          color: #64748b !important;
          font-size: 12px !important;
          font-weight: 800 !important;
          border-bottom: 1px solid rgba(15, 23, 42, 0.08) !important;
          margin-bottom: 6px !important;
        }

        .mobile-menu-link {
          min-height: 44px !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          padding: 9px 10px !important;
          border-radius: 10px !important;
          color: #0f172a !important;
          text-decoration: none !important;
          font-size: 14px !important;
          font-weight: 850 !important;
          line-height: 1.2 !important;
        }

        .mobile-menu-link.active,
        .mobile-menu-link:hover {
          background: #eaf8ff !important;
          color: #075985 !important;
        }
      }

      @media (max-width: 360px) {
        .shared-topbar .brand .title { font-size: 13px !important; }
        .shared-topbar .brand .subtitle { font-size: 7px !important; }
        .shared-logo-box { width: 44px !important; flex-basis: 44px !important; }
        .shared-topbar .logo { width: 42px !important; }
      }
    `;
  }

  function pathText() {
    return window.location.pathname.replaceAll("\\", "/").toLowerCase();
  }

  function getBasePath() {
    const p = pathText();
    if (p.includes("/renderer/dashboard_v2/")) return "../../";
    if (p.includes("/renderer/info/")) return "../../";
    if (p.includes("/renderer/admin/")) return "../../";
    if (p.includes("/renderer/team/")) return "../../";
    if (p.includes("/renderer/capacity/")) return "../../";
    if (p.includes("/renderer/")) return "../";
    return "";
  }

  function pagePath(relativePath) {
    return getBasePath() + relativePath;
  }

  function todayText() {
    return new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function isActive(page) {
    const p = pathText();
    if (page === "home") return p.endsWith("/index.html") || p.endsWith("/") || !p.includes("/renderer/");
    if (page === "machine") return p.includes("/renderer/dashboard_v2/");
    if (page === "team") return p.includes("/renderer/team/");
    if (page === "capacity") return p.includes("/renderer/capacity/");
    if (page === "info") return p.includes("/renderer/info/");
    if (page === "admin") return p.includes("/renderer/admin/");
    return false;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function activeClass(page) {
    return isActive(page) ? "active" : "";
  }

  const BUTTON_TONES = ["primary", "send", "success", "danger", "edit", "neutral"];
  const BUTTON_SELECTOR = "button, a.btn, input[type='button'], input[type='submit']";
  const BUTTON_IGNORE_SELECTOR = [
    ".shared-nav-btn",
    ".mobile-menu-btn",
    ".mobile-menu-link",
    ".icon-btn",
    ".tab",
    ".tab-btn",
    ".pin-recovery-eye",
    ".absent-date-btn",
    ".absent-modal-close",
    "[data-sp-button='ignore']"
  ].join(",");

  const BUTTON_RULES = [
    { tone: "danger", words: ["delete", "remove", "clear", "empty", "reset", "logout", "revoke", "discard"] },
    { tone: "neutral", words: ["close", "cancel", "back"] },
    { tone: "send", words: ["send", "sync", "email", "mail", "otp", "notify"] },
    { tone: "success", words: ["save", "submit", "add", "create", "apply", "import", "restore", "confirm", "continue", "new entry", "backup"] },
    { tone: "edit", words: ["edit", "change", "update", "test", "retry", "reload", "default"] },
    { tone: "primary", words: ["print", "report", "show", "view", "load", "refresh", "preview", "analyze", "choose", "login", "verify", "open", "download"] }
  ];

  function buttonText(element) {
    return [
      element.dataset?.spButtonTone,
      element.textContent,
      element.value,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.id
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function inferButtonTone(element) {
    const explicitTone = String(element.dataset?.spButtonTone || "").toLowerCase();
    if (BUTTON_TONES.includes(explicitTone)) return explicitTone;

    const text = buttonText(element);
    const tokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
    const matchingRule = BUTTON_RULES.find((rule) => rule.words.some((word) => (
      word.includes(" ") ? text.includes(word) : tokens.has(word)
    )));
    if (matchingRule) return matchingRule.tone;

    if (element.classList.contains("red")) return "danger";
    if (element.classList.contains("green")) return "success";
    if (element.classList.contains("orange")) return "send";
    if (element.classList.contains("blue") || element.classList.contains("primary")) return "primary";
    return "neutral";
  }

  function styleActionButton(element) {
    if (!(element instanceof Element) || element.matches(BUTTON_IGNORE_SELECTOR)) return;
    element.classList.add("sp-action-btn");
    BUTTON_TONES.forEach((tone) => element.classList.remove(`sp-action-${tone}`));
    element.classList.add(`sp-action-${inferButtonTone(element)}`);
  }

  function styleActionButtons(root = document) {
    if (root.matches?.(BUTTON_SELECTOR)) styleActionButton(root);
    root.querySelectorAll?.(BUTTON_SELECTOR).forEach(styleActionButton);
  }

  function observeActionButtons() {
    styleActionButtons();
    if (!document.body || window.SPWT_BUTTON_OBSERVER) return;

    let pending = false;
    const observer = new MutationObserver((mutations) => {
      if (pending || !mutations.some((mutation) => mutation.addedNodes.length)) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) styleActionButtons(node);
        }));
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.SPWT_BUTTON_OBSERVER = observer;
  }

  const NAV = [
    { page: "home", href: "index.html", icon: "⌂", label: "Home" },
    { page: "machine", href: "renderer/dashboard_v2/dashboard.html", icon: "▥", label: "Dashboard" },
    { page: "team", href: "renderer/team/team.html", icon: "●●●", label: "People" },
    { page: "capacity", href: "renderer/capacity/capacity.html", icon: "⌁", label: "Reports" },
    { page: "info", href: "renderer/info/info.html", icon: "i", label: "Info" },
    { page: "admin", href: "renderer/admin/admin.html", icon: "⚙", label: "Settings", extraClass: "settings" }
  ];

  function navLink(item) {
    return `<a class="shared-nav-btn ${item.extraClass || ""} ${activeClass(item.page)}" href="${pagePath(item.href)}" title="${escapeHtml(item.label)}"><span class="shared-nav-icon">${item.icon}</span><span class="shared-nav-label">${escapeHtml(item.label)}</span></a>`;
  }

  function mobileMenuLink(item) {
    return `<a class="mobile-menu-link ${activeClass(item.page)}" href="${pagePath(item.href)}"><span>${item.icon}</span><span>${escapeHtml(item.label)}</span></a>`;
  }

  function closeMobileMenus(except) {
    document.querySelectorAll(".mobile-menu-wrap.open").forEach((menu) => {
      if (menu !== except) menu.classList.remove("open");
    });
  }

  function wireMobileMenu(mount) {
    const wrap = mount.querySelector(".mobile-menu-wrap");
    const btn = mount.querySelector(".mobile-menu-btn");
    if (!wrap || !btn || btn.__spwtMenuWired) return;

    btn.__spwtMenuWired = true;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !wrap.classList.contains("open");
      closeMobileMenus(wrap);
      wrap.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  document.addEventListener("click", () => closeMobileMenus());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileMenus();
  });

  window.SPWT = window.SPWT || {};
  window.SPWT.styleActionButtons = styleActionButtons;

  window.SPWT.renderAppHeader = function renderAppHeader(options = {}) {
    ensureViewportMeta();
    ensureHeaderStyles();

    const mount = document.getElementById("spAppHeader");
    if (!mount) return;

    const title = options.title || "SP WorkTrack";
    const subtitle = options.subtitle || "Production & Performance Management System";
    const navHtml = NAV.map(navLink).join("");
    const mobileNavHtml = NAV.map(mobileMenuLink).join("");

    mount.innerHTML = `
      <div class="topbar shared-topbar">
        <div class="left">
          <div class="shared-logo-box"><img src="${pagePath("assets/logo (2).png")}" class="logo" alt="SP Logo" /></div>
          <div class="shared-brand-divider"></div>
          <div class="brand">
            <div class="title">${escapeHtml(title)}</div>
            <div class="subtitle">${escapeHtml(subtitle)}</div>
          </div>
        </div>

        <div class="right desktop-nav">
          <span id="currentDate">${todayText()}</span>
          ${navHtml}
        </div>

        <div class="mobile-menu-wrap">
          <button class="mobile-menu-btn" type="button" aria-label="Open navigation menu" aria-expanded="false">☰</button>
          <div class="mobile-menu-panel">
            <div class="mobile-menu-date">${todayText()}</div>
            ${mobileNavHtml}
          </div>
        </div>
      </div>
    `;

    wireMobileMenu(mount);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeActionButtons, { once: true });
  } else {
    observeActionButtons();
  }
})();