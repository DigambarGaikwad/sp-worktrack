(function () {
  function pathText() {
    return window.location.pathname.replaceAll("\\", "/").toLowerCase();
  }

  function getBasePath() {
    const p = pathText();

    if (p.includes("/renderer/dashboard_v2/")) return "../../";
    if (p.includes("/renderer/")) return "../";
    return "";
  }

  function navTo(relativePath) {
    window.location.href = getBasePath() + relativePath;
  }

  function assetPath(relativePath) {
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

    if (page === "machine") {
      return p.includes("/renderer/dashboard_v2/");
    }

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

  window.SPWT = window.SPWT || {};

  window.SPWT.renderAppHeader = function renderAppHeader(options = {}) {
    const mount = document.getElementById("spAppHeader");
    if (!mount) return;

    const title = options.title || "SP WorkTrack";
    const subtitle = options.subtitle || "Production Management System";

    mount.innerHTML = `
      <div class="topbar shared-topbar">
        <div class="left">
          <img src="${assetPath("assets/logo (2).png")}" class="logo" alt="SP Logo" />
          <div class="brand">
            <div class="title">${escapeHtml(title)}</div>
            <div class="subtitle">${escapeHtml(subtitle)}</div>
          </div>
        </div>

        <div class="right">
          <span id="currentDate">${todayText()}</span>

          <button type="button" class="shared-nav-btn ${isActive("home") ? "active" : ""}" data-nav="home" title="Home / Production Entry">🏠</button>
          <button type="button" class="shared-nav-btn ${isActive("machine") ? "active" : ""}" data-nav="machine" title="Machine Dashboard">📊</button>
          <button type="button" class="shared-nav-btn" data-nav="team" title="Team Dashboard">👥</button>
          <button type="button" class="shared-nav-btn" data-nav="capacity" title="Capacity Planning">📈</button>
          <button type="button" class="shared-nav-btn" data-nav="info" title="About">ℹ</button>
          <button type="button" class="shared-nav-btn settings" data-nav="admin" title="Settings">⚙</button>
        </div>
      </div>
    `;

    mount.querySelector(".right")?.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-nav]");
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();

      const nav = btn.dataset.nav;

      if (nav === "home") {
        navTo("index.html");
        return;
      }

      if (nav === "machine") {
        navTo("renderer/dashboard_v2/dashboard.html");
        return;
      }

      if (nav === "team") {
        alert("Team Dashboard will be added in Phase 4.");
        return;
      }

      if (nav === "capacity") {
        alert("Capacity Planning page will be added in Phase 4.");
        return;
      }

      if (nav === "info") {
        window.SPWT.openInfo?.();
        return;
      }

      if (nav === "admin") {
        window.SPWT.openAdmin?.();
      }
    });
  };
})();