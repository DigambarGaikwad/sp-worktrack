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

  window.SPWT = window.SPWT || {};

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

        <div class="right">
          <span id="currentDate">${todayText()}</span>

          <a class="shared-nav-btn ${activeClass("home")}" href="${pagePath("index.html")}" title="Home / Production Entry">🏠</a>
          <a class="shared-nav-btn ${activeClass("machine")}" href="${pagePath("renderer/dashboard_v2/dashboard.html")}" title="Machine Dashboard">📊</a>
          <a class="shared-nav-btn ${activeClass("team")}"href="${pagePath("renderer/team/team.html")}" title="Team Dashboard">👥</a>
          <a class="shared-nav-btn ${activeClass("capacity")}" href="${pagePath("renderer/capacity/capacity.html")}" title="Capacity Planning">📈</a>
          <a class="shared-nav-btn ${activeClass("info")}" href="${pagePath("renderer/info/info.html")}" title="Info">ℹ</a>
          <a class="shared-nav-btn settings ${activeClass("admin")}" href="${pagePath("renderer/admin/admin.html")}" title="Admin Settings">⚙</a>
        </div>
      </div>
    `;
  };
})();
