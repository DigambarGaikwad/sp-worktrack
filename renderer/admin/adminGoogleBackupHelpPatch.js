// renderer/admin/adminGoogleBackupHelpPatch.js
// Adds step-by-step Google Sheet backup setup help near Save Google Backup Settings.
(function () {
  const STYLE_ID = "spwt-google-backup-help-style";
  const BACKDROP_ID = "spwtGoogleBackupHelpBackdrop";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .spwt-google-help-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 24px 12px;
        background: rgba(15, 23, 42, 0.55);
        overflow: auto;
      }
      .spwt-google-help-backdrop.hidden { display: none !important; }
      .spwt-google-help-modal {
        width: min(900px, 100%);
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
        overflow: hidden;
      }
      .spwt-google-help-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        background: #0b3f73;
        color: #ffffff;
      }
      .spwt-google-help-head .section-title { color: #ffffff; margin: 0; }
      .spwt-google-help-body { padding: 16px; }
      .spwt-google-help-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .spwt-google-help-step {
        padding: 12px;
        margin-bottom: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #f8fafc;
        line-height: 1.55;
      }
      .spwt-google-help-step b { color: #0b3f73; }
      .spwt-google-help-step code {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 8px;
        background: #e8f1ff;
        color: #0b3f73;
        font-weight: 800;
      }
      @media (max-width: 900px) {
        .spwt-google-help-grid { grid-template-columns: 1fr; }
        .spwt-google-help-backdrop { padding: 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  function sectionTitle(cardEl) {
    return (cardEl.querySelector(".section-title")?.textContent || "").trim().toLowerCase();
  }

  function findGoogleBackupCard() {
    const body = document.getElementById("systemConfigBody");
    if (!body) return null;
    return Array.from(body.querySelectorAll(".admin-controls-card"))
      .find((cardEl) => sectionTitle(cardEl).includes("google sheet")) || null;
  }

  function helpHtml() {
    return `
      <div class="spwt-google-help-head">
        <div>
          <div class="section-title">Google Sheet Backup Setup Help</div>
          <div style="font-size:12px;opacity:.9;">Use this when creating or changing the Google Sheet backup receiver.</div>
        </div>
        <button class="btn grey" type="button" data-close-google-backup-help="true">Close</button>
      </div>
      <div class="spwt-google-help-body">
        <div class="spwt-google-help-step"><b>What this setting is used for</b><br>
          SP WorkTrack sends backup/sync data to a Google Apps Script Web App. The Web App writes the data into your selected Google Sheet. The normal Google Sheet sharing link is only for opening the sheet; SP WorkTrack needs the <b>Web App URL</b> ending with <code>/exec</code>.
        </div>
        <div class="spwt-google-help-grid">
          <div class="spwt-google-help-step"><b>Step 1 - Create backup Google Sheet</b><br>
            Create a new sheet from the backup Google account, for example <b>Sp Worktrack Back-up</b>. Keep the sheet link and sheet ID safely for setup reference.
          </div>
          <div class="spwt-google-help-step"><b>Step 2 - Open Apps Script</b><br>
            In the backup sheet, click <b>Extensions</b> -> <b>Apps Script</b>. Open <b>Code.gs</b>, remove sample code, and paste the SP WorkTrack backup receiver code.
          </div>
          <div class="spwt-google-help-step"><b>Step 3 - Set Sheet ID and Backup Secret</b><br>
            In receiver code, set the target spreadsheet ID and create a strong <b>BACKUP_SECRET</b>. This secret must be exactly the same in Apps Script and SP WorkTrack.
            <br><br><b>Very sensitive:</b> do not paste the backup secret in any online AI tool, chat app, email, screenshot, or share it with anyone.
          </div>
          <div class="spwt-google-help-step"><b>Step 4 - Deploy Web App</b><br>
            Click <b>Deploy</b> -> <b>New deployment</b> -> select <b>Web app</b>.<br>
            Description: <code>SP WorkTrack Backup Receiver</code><br>
            Execute as: <code>Me</code><br>
            Who has access: <code>Anyone</code><br>
            Authorize using the backup Google account, then copy the Web App URL ending with <code>/exec</code>.
          </div>
          <div class="spwt-google-help-step"><b>Step 5 - Fill SP WorkTrack settings</b><br>
            Google Sheet Backup Enabled: <code>true</code><br>
            Google Sheet Web App URL: paste Web App URL<br>
            Google Sheet Backup Secret: paste same secret as Apps Script<br>
            Timeout: <code>15000</code><br>
            Click <b>Save Google Backup Settings</b>.
          </div>
          <div class="spwt-google-help-step"><b>Step 6 - Test backup</b><br>
            Use the backup test/status button if available. If testing fails, check: Web App URL, secret spelling, deployment access = <b>Anyone</b>, and Apps Script authorization.
          </div>
        </div>
        <div class="spwt-google-help-step" style="background:#fff7ed;border-color:#fed7aa;"><b>Important note</b><br>
          Keep <code>.env</code> and backup secrets out of GitHub. The files <code>.env.bak_*</code>, <code>runtime_logs/</code>, <code>runtime_scripts/</code>, and <code>transfer_packages/</code> are local/generated files and should not be committed.
        </div>
      </div>
    `;
  }

  function showHelp() {
    ensureStyle();
    let backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "spwt-google-help-backdrop hidden";
      backdrop.innerHTML = `<div class="spwt-google-help-modal">${helpHtml()}</div>`;
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop || event.target?.closest?.("[data-close-google-backup-help]")) hideHelp();
      });
    }
    backdrop.classList.remove("hidden");
  }

  function hideHelp() {
    document.getElementById(BACKDROP_ID)?.classList.add("hidden");
  }

  function addHelpButton() {
    const cardEl = findGoogleBackupCard();
    if (!cardEl || cardEl.querySelector("[data-system-google-backup-help]")) return;

    let actions = cardEl.querySelector(".system-section-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "system-section-actions";
      cardEl.appendChild(actions);
    }

    const btn = document.createElement("button");
    btn.className = "btn grey";
    btn.type = "button";
    btn.dataset.systemGoogleBackupHelp = "true";
    btn.textContent = "Help";
    btn.addEventListener("click", showHelp);
    actions.appendChild(btn);
  }

  function enhance() {
    ensureStyle();
    addHelpButton();
  }

  document.addEventListener("click", () => setTimeout(enhance, 160), true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideHelp();
  });
  document.addEventListener("DOMContentLoaded", () => setTimeout(enhance, 1200));
  setInterval(enhance, 1500);
})();
