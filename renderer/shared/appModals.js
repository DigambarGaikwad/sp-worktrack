(function () {
  function closeAllSharedModals() {
    document.getElementById("sharedInfoModal")?.classList.add("hidden");
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
                <li>Department &amp; Sub Work Control</li>
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
    `;

    document.getElementById("sharedInfoCloseBtn")?.addEventListener("click", closeAllSharedModals);
  };

  window.SPWT.closeAllSharedModals = closeAllSharedModals;

  window.SPWT.openInfo = function openInfo() {
    closeAllSharedModals();
    document.getElementById("sharedInfoModal")?.classList.remove("hidden");
  };
})();