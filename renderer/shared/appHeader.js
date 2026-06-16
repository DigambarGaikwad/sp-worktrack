(function () {
  const HEADER_STYLE_ID = "spwt-shared-header-style";

  function ensureHeaderStyles() {
    if (document.getElementById(HEADER_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = HEADER_STYLE_ID;
    style.textContent = `
      .mobile-menu-wrap { display: none; }
      .mobile-menu-panel { display: none; }
      .mobile-menu-wrap.open .mobile-menu-panel { display: block; }

      @media (min-width: 769px) {
        .shared-topbar { flex-direction: row !important; align-items: center !important; justify-content: space-between !important; }
        .shared-topbar .desktop-nav { display: flex !important; }
        .shared-topbar .mobile-menu-wrap { display: none !important; }
        .shared-topbar .mobile-menu-panel { display: none !important; }
      }

      @media (max-width: 768px) {
        .shared-topbar {
          height: 56px !important;
          min-height: 56px !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 8px !important;
          padding: 0 10px !important;
          overflow: visible !important;
          position: relative !important;
        }

        .shared-topbar .left {
          flex: 1 1 auto !important;
          min-width: 0 !important;
          max-width: calc(100% - 48px) !important;
          gap: 8px !important;
          overflow: hidden !important;
        }

        .shared-topbar .logo {
          width: 42px !important;
          height: 34px !important;
          flex: 0 0 42px !important;
          object-fit: contain !important;
        }

        .shared-topbar .brand {
          display: block !important;
          min-width: 0 !important;
          overflow: hidden !important;
        }

        .shared-topbar .brand .title {
          display: block !important;
          font-size: 14px !important;
          line-height: 1.05 !important;
          font-weight: 800 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }

        .shared-topbar .brand .subtitle {
          display: block !important;
          font-size: 8.4px !important;
          line-height: 1.05 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          opacity: 0.85 !important;
        }

        .shared-topbar .desktop-nav {
          display: none !important;
        }

        .shared-topbar .mobile-menu-wrap {
          display: block !important;
          position: relative !important;
          top: auto !important;
          right: auto !important;
          left: auto !important;
          transform: none !important;
          z-index: 1100 !important;
          flex: 0 0 38px !important;
        }

        .mobile-menu-btn {
          width: 38px !important;
          height: 38px !important;
          min-height: 38px !important;
          padding: 0 !important;
          border: 1px solid rgba(255, 255, 255, 0.28) !important;
          border-radius: 10px !important;
          background: rgba(255, 255, 255, 0.10) !important;
          color: #ffffff !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 24px !important;
          line-height: 1 !important;
          box-shadow: none !important;
        }

        .mobile-menu-panel {
          position: fixed !important;
          left: 10px !important;
          right: 10px !important;
          top: 62px !important;
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          max-height: calc(100vh - 76px) !important;
          overflow-y: auto !important;
          padding: 10px !important;
          border-radius: 14px !important;
          background: #ffffff !important;
          color: #0f172a !important;
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.28) !important;
          border: 1px solid rgba(15, 23, 42, 0.10) !important;
          z-index: 1099 !important;
        }

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
          background: #eaf2ff !important;
          color: #0b3f73 !important;
        }
      }

      @media (max-width: 360px) {
        .shared-topbar .brand .title { font-size: 13px !important; }
        .shared-topbar .brand .subtitle { font-size: 7.6px !important; }
      }
    `;

    document.head.appendChild(style);
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

    if (page === "home") {
      return p.endsWith("/index.html") || p.endsWith("/") || !p.includes("/renderer/");
    }

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

  function navLink(page, href, icon, label, extraClass = "") {
    return `<a class="shared-nav-btn ${extraClass} ${activeClass(page)}" href="${pagePath(href)}" title="${escapeHtml(label)}">${icon}</a>`;
  }

  function mobileMenuLink(page, href, icon, label) {
    return `<a class="mobile-menu-link ${activeClass(page)}" href="${pagePath(href)}"><span>${icon}</span><span>${escapeHtml(label)}</span></a>`;
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
    ensureHeaderStyles();

    const mount = document.getElementById("spAppHeader");
    if (!mount) return;

    const title = options.title || "SP WorkTrack";
    const subtitle = options.subtitle || "Production & Performance Management System";

    mount.innerHTML = `
      <div class="topbar shared-topbar">
        <div class="left">
          <img src="${pagePath("assets/logo (2).png")}" class="logo" alt="SP Logo" />
          <div class="brand">
            <div class="title">${escapeHtml(title)}</div>
            <div class="subtitle">${escapeHtml(subtitle)}</div>
          </div>
        </div>

        <div class="right desktop-nav">
          <span id="currentDate">${todayText()}</span>
          ${navLink("home", "index.html", "🏠", "Home / Production Entry")}
          ${navLink("machine", "renderer/dashboard_v2/dashboard.html", "📊", "Machine Dashboard")}
          ${navLink("team", "renderer/team/team.html", "👥", "Team Dashboard")}
          ${navLink("capacity", "renderer/capacity/capacity.html", "📈", "Capacity Planning")}
          ${navLink("info", "renderer/info/info.html", "ℹ", "Info")}
          ${navLink("admin", "renderer/admin/admin.html", "⚙", "Admin Settings", "settings")}
        </div>

        <div class="mobile-menu-wrap">
          <button class="mobile-menu-btn" type="button" aria-label="Open navigation menu" aria-expanded="false">☰</button>
          <div class="mobile-menu-panel">
            <div class="mobile-menu-date">${todayText()}</div>
            ${mobileMenuLink("home", "index.html", "🏠", "Home / Production Entry")}
            ${mobileMenuLink("machine", "renderer/dashboard_v2/dashboard.html", "📊", "Machine Dashboard")}
            ${mobileMenuLink("team", "renderer/team/team.html", "👥", "Team Dashboard")}
            ${mobileMenuLink("capacity", "renderer/capacity/capacity.html", "📈", "Capacity Planning")}
            ${mobileMenuLink("info", "renderer/info/info.html", "ℹ", "Info")}
            ${mobileMenuLink("admin", "renderer/admin/admin.html", "⚙", "Admin Settings")}
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