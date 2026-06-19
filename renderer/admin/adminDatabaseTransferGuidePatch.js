// renderer/admin/adminDatabaseTransferGuidePatch.js
// Adds clear step-by-step guidance to Admin > Database Transfer.

(function () {
  const TARGET_TAB_ID = "tabDatabaseTransfer";

  function $(id) { return document.getElementById(id); }

  function ensureGuide() {
    const tab = $(TARGET_TAB_ID);
    if (!tab || $("dbTransferGuideBox")) return;

    const guide = document.createElement("div");
    guide.id = "dbTransferGuideBox";
    guide.className = "card admin-controls-card";
    guide.style.marginTop = "12px";
    guide.innerHTML = `
      <div class="section-title">How SP WorkTrack will run as an app on another PC</div>
      <div class="small-hint">This is the production idea: one server PC runs the app services; users only open the browser link.</div>

      <div class="grid-2" style="gap:12px;margin-top:12px;">
        <div class="card" style="padding:12px;">
          <div class="section-title">Production Server PC</div>
          <ol class="small-hint" style="line-height:1.65;margin:8px 0 0 18px;">
            <li>Start PocketBase database service.</li>
            <li>Start SP WorkTrack Node server on port 3030.</li>
            <li>Keep this PC powered on and connected to LAN/Tailscale.</li>
            <li>Users open the detected LAN or Tailscale URL in browser.</li>
          </ol>
          <div class="small-hint" style="margin-top:8px;"><b>Later production mode:</b> we will use a Start SP WorkTrack launcher or Windows service/Task Scheduler so Node and PocketBase start automatically.</div>
        </div>

        <div class="card" style="padding:12px;">
          <div class="section-title">Transfer Button Sequence</div>
          <ol class="small-hint" style="line-height:1.65;margin:8px 0 0 18px;">
            <li><b>Check Database Status</b> detects the actual database folder, transfer folder, server name and record counts.</li>
            <li><b>Create Transfer Package</b> creates a secure ZIP for the new server PC.</li>
            <li><b>Download Latest Package</b> downloads the latest ZIP from the detected transfer folder.</li>
            <li><b>Copy Transfer Folder Path</b> copies the detected package folder path. No folder path is assumed.</li>
            <li><b>Print Transfer Checklist</b> gives a handover sheet for final migration day.</li>
          </ol>
        </div>
      </div>

      <div class="card" style="padding:12px;margin-top:12px;background:#eef6ff;border-color:#bfdbfe;">
        <div class="section-title">Important restore rule</div>
        <div class="small-hint">This tab is for export/preparation only. Full restore to a new PC must be done separately while PocketBase is stopped. Do not replace <b>pb_data</b> while PocketBase is running.</div>
      </div>
    `;

    const wizard = tab.querySelector(".admin-controls-card");
    if (wizard) wizard.insertAdjacentElement("afterend", guide);
    else tab.appendChild(guide);
  }

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.('[data-tab="tabDatabaseTransfer"]')) setTimeout(ensureGuide, 300);
  }, true);

  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureGuide, 1200));
  setInterval(ensureGuide, 2500);
})();
