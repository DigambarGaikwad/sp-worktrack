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

  function goHome() {
    window.location.href = getBasePath() + "index.html";
  }

  function closeAllSharedModals() {
    document.getElementById("sharedInfoModal")?.classList.add("hidden");
    document.getElementById("sharedAdminModal")?.classList.add("hidden");
  }

  window.SPWT = window.SPWT || {};

  window.SPWT.renderSharedModals = function renderSharedModals() {
    const mount = document.getElementById("spSharedModals");
    if (!mount) return;

    mount.innerHTML = `
      <div class="modal-backdrop hidden" id="sharedInfoModal">
        <div class="modal">
          <div class="modal-head">
            <div class="modal-title">About SP WorkTrack</div>
            <button class="icon-btn" id="sharedInfoCloseBtn">✕</button>
          </div>

          <div class="modal-body">
            <div style="line-height:1.6; font-size:14px; margin-left:25px;">
              <strong>SP WorkTrack v1.0</strong><br/>
              Production Management System<br/><br/>

              <strong>Core Features:</strong>
              <ul style="margin-top:6px;">
                <li>Production Entry Tracking</li>
                <li>Machine Category Mapping</li>
                <li>Department & Sub Work Control</li>
                <li>Rework Tracking with Root Area</li>
                <li>Machine Dashboard</li>
                <li>Quality Checklist Integration</li>
                <li>Google Sheets Integration</li>
                <li>Real-time multi-device synchronization</li>
              </ul>

              <br/>
              Developed by Digambar Gaikwad<br/>
              © 2026 Sopan Process Technologies
            </div>
          </div>
        </div>
      </div>

      <div class="modal-backdrop hidden" id="sharedAdminModal">
        <div class="modal">
          <div class="modal-head">
            <div class="modal-title">Admin Settings</div>
            <button class="icon-btn" id="sharedAdminCloseBtn">✕</button>
          </div>

          <div class="modal-body">
            <div class="sp-admin-placeholder">
              <h2>Admin Settings</h2>
              <p>
                Full admin configuration is currently available on the Home / Production Entry screen.
                In the next step we will move the full admin panel into this shared modal so it opens from every page.
              </p>

              <button class="dash-btn primary" id="goHomeForAdminBtn">Open Home Admin Screen</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("sharedInfoCloseBtn")?.addEventListener("click", closeAllSharedModals);
    document.getElementById("sharedAdminCloseBtn")?.addEventListener("click", closeAllSharedModals);
    document.getElementById("goHomeForAdminBtn")?.addEventListener("click", goHome);
  };

  window.SPWT.closeAllSharedModals = closeAllSharedModals;

  window.SPWT.openInfo = function openInfo() {
    closeAllSharedModals();
    document.getElementById("sharedInfoModal")?.classList.remove("hidden");
  };

  window.SPWT.openAdmin = function openAdmin() {
    closeAllSharedModals();
    document.getElementById("sharedAdminModal")?.classList.remove("hidden");
  };
})();