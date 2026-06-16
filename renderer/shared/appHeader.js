(function () {
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
    });
  }

  document.addEventListener("click", () => closeMobileMenus());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileMenus();
  });

  window.SPWT = window.SPWT || {};
  window.SPWT.styleActionButtons = styleActionButtons;

  window.SPWT.renderAppHeader = function renderAppHeader(options = {}) {
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
          <button class="mobile-menu-btn" type="button" aria-label="Open navigation menu">☰</button>
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