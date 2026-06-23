// renderer/admin/adminDatabaseRestoreMountPatch.js
// Static mount fallback for Restore Transfer Package UI.
// Button wiring stays in adminDatabaseRestorePatch.js to avoid duplicating restore logic.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  function $(id) { return document.getElementById(id); }

  function findCardByTitle(page, title) {
    return Array.from(page.querySelectorAll(".admin-controls-card,.card")).find(card => {
      const heading = card.querySelector(".section-title");
      return String(heading?.textContent || "").trim() === title;
    }) || null;
  }

  function restoreMarkup() {
    return `
      <div class="section-title">Restore Transfer Package</div>
      <div class="small-hint">Use this on the new server PC after copying a transfer ZIP into the transfer_packages folder. First validate/test extract. Actual restore needs confirmation.</div>

      <div class="grid-2" style="gap:12px;margin-top:12px;">
        <div class="field">
          <label>Transfer Package</label>
          <select id="dbRestorePackageSelect" class="admin-select"></select>
          <div class="small-hint">Latest package is selected automatically. Package content is checked before restore.</div>
        </div>
        <div class="field">
          <label>Safety Confirmation</label>
          <input id="dbRestoreConfirmInput" class="admin-input" type="text" placeholder="Type RESTORE_DB only before actual restore" />
          <div class="small-hint">Actual restore is blocked unless this exact text is typed.</div>
        </div>
      </div>

      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn grey" id="dbRestoreRefreshBtn" type="button">Refresh Packages</button>
        <button class="btn grey" id="dbRestorePreviewBtn" type="button">Preview / Validate Package</button>
        <button class="btn grey" id="dbRestoreTestExtractBtn" type="button">Test Extract to Folder</button>
        <label class="quality-recheck-line small-hint" style="align-items:center;gap:6px;margin:0 8px 0 0;"><input id="dbRestoreStopPbCheck" type="checkbox" checked /> Stop PocketBase before restore</label>
        <button class="btn red" id="dbRestoreApplyBtn" type="button">Restore Selected Package</button>
      </div>

      <div class="small-hint" id="dbRestoreStatusLine" style="margin-top:10px;"></div>
      <div id="dbRestoreOutput" style="margin-top:12px;"></div>

      <div class="card" style="padding:12px;margin-top:12px;background:#fff7ed;border-color:#fed7aa;">
        <div class="section-title">Restore safety rules</div>
        <div class="small-hint">- <b>Preview</b> checks ZIP content only.</div>
        <div class="small-hint">- <b>Test Extract</b> extracts to a test folder and does not touch live database.</div>
        <div class="small-hint">- <b>Restore</b> replaces current <b>pb_data</b>, <b>pb_migrations</b>, and <b>.env</b>.</div>
        <div class="small-hint">- A pre-restore backup folder is created first inside <b>transfer_packages/pre_restore_backups</b>.</div>
        <div class="small-hint">- PocketBase must be stopped before replacing database files.</div>
        <div class="small-hint">- After restore, start PocketBase and restart Node/SP WorkTrack server.</div>
      </div>
    `;
  }

  function ensureVisibleRestoreCard() {
    const page = $("tabDatabaseTransfer");
    if (!page) return;

    let card = $("dbTransferRestoreCard");
    if (!card) {
      card = document.createElement("div");
      card.className = "card admin-controls-card";
      card.id = "dbTransferRestoreCard";
      card.style.marginTop = "12px";
      card.innerHTML = restoreMarkup();
    }

    card.style.border = card.style.border || "2px solid #f59e0b";
    card.style.boxShadow = card.style.boxShadow || "0 6px 18px rgba(245, 158, 11, 0.12)";

    const transferWizard = findCardByTitle(page, "Transfer Package Wizard");
    const runtimeCard = findCardByTitle(page, "Runtime / Auto-start Preparation");

    if (transferWizard?.nextSibling !== card) {
      if (runtimeCard) page.insertBefore(card, runtimeCard);
      else if (transferWizard?.nextSibling) page.insertBefore(card, transferWizard.nextSibling);
      else page.appendChild(card);
    }
  }

  function tick() { ensureVisibleRestoreCard(); }

  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 1500));
  document.addEventListener("click", event => {
    if (event.target?.closest?.('[data-tab="tabDatabaseTransfer"]')) setTimeout(tick, 250);
  }, true);
  setInterval(tick, 2000);
})();
