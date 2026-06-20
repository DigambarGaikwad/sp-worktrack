// renderer/admin/adminSystemSettingsGuidePatch.js
// Adds user-friendly explanations and section action buttons to Admin -> System Settings.
(function () {
  const STYLE_ID = "spwt-system-settings-guide-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .system-settings-guide {
        margin-top: 12px;
        background: #f8fbff;
        border-color: #bfdbfe;
      }
      .system-settings-guide-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 10px;
      }
      .system-settings-help-card {
        border: 1px solid #dbeafe;
        background: #ffffff;
        border-radius: 14px;
        padding: 12px;
        line-height: 1.55;
      }
      .system-settings-help-card b {
        color: #0b3f73;
      }
      .system-settings-help-card ul {
        margin: 8px 0 0 18px;
        padding: 0;
      }
      .system-settings-help-card li { margin: 5px 0; }
      .system-section-note {
        margin: 10px 0;
        padding: 10px 12px;
        border-radius: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        line-height: 1.55;
      }
      .system-section-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 10px;
      }
      .spwt-email-help-backdrop {
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
      .spwt-email-help-backdrop.hidden { display: none !important; }
      .spwt-email-help-modal {
        width: min(860px, 100%);
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
        overflow: hidden;
      }
      .spwt-email-help-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        background: #0b3f73;
        color: #ffffff;
      }
      .spwt-email-help-head .section-title { color: #ffffff; margin: 0; }
      .spwt-email-help-body { padding: 16px; }
      .spwt-help-step {
        padding: 12px;
        margin-bottom: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #f8fafc;
        line-height: 1.55;
      }
      .spwt-help-step b { color: #0b3f73; }
      .spwt-help-step code {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 8px;
        background: #e8f1ff;
        color: #0b3f73;
        font-weight: 800;
      }
      .spwt-help-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      @media (max-width: 900px) {
        .system-settings-guide-grid,
        .spwt-help-grid { grid-template-columns: 1fr; }
        .spwt-email-help-backdrop { padding: 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  function card(title, body) {
    return `<div class="system-settings-help-card"><b>${title}</b><div>${body}</div></div>`;
  }

  function ensureTopGuide(tab) {
    if (document.getElementById("systemSettingsGuideCard")) return;
    const guide = document.createElement("div");
    guide.id = "systemSettingsGuideCard";
    guide.className = "card admin-controls-card system-settings-guide";
    guide.innerHTML = `
      <div class="section-title">System Settings Guide</div>
      <div class="small-hint">This screen updates sensitive setup values in <b>.env</b>. Keep access limited to trusted admins only.</div>
      <div class="system-settings-guide-grid">
        ${card("Email Sender", `This controls <b>from which email</b> SP WorkTrack sends reports. For Gmail use <b>smtp.gmail.com</b>, port <b>587</b>, Secure = <b>No / STARTTLS</b>. SMTP Password should be a Gmail <b>App Password</b>, not your normal Gmail password.`)}
        ${card("Google Sheet Backup", `Web App URL comes from Google Apps Script deployment: <b>Deploy -> Manage deployments -> Web app URL</b>. Backup Secret must match the secret configured in the Apps Script backup receiver.`)}
        ${card("PocketBase Runtime", `PocketBase URL is normally <b>http://127.0.0.1:8090</b> when PocketBase runs on the same server PC. Change only if PocketBase port/server changes. Superuser email/password are used by Node for database operations.`)}
      </div>
      <div class="small-hint" style="margin-top:10px;line-height:1.6;">
        Leave password/secret fields blank to keep current saved values. After major changes, restart SP WorkTrack from Runtime shortcuts or Task Scheduler.
      </div>
    `;

    const firstCard = tab.querySelector(".admin-controls-card");
    if (firstCard) firstCard.insertAdjacentElement("afterend", guide);
    else tab.insertAdjacentElement("afterbegin", guide);
  }

  function sectionTitle(cardEl) {
    return (cardEl.querySelector(".section-title")?.textContent || "").trim().toLowerCase();
  }

  function clickSave() {
    document.getElementById("saveSystemConfigBtn")?.click();
  }

  function clickTestEmail() {
    document.getElementById("testSystemEmailBtn")?.click();
  }

  function emailHelpHtml() {
    return `
      <div class="spwt-email-help-head">
        <div>
          <div class="section-title">Email Sender Setup Help</div>
          <div style="font-size:12px;opacity:.9;">Use this when creating/changing the Gmail account that sends SP WorkTrack reports.</div>
        </div>
        <button class="btn grey" type="button" data-close-email-help="true">Close</button>
      </div>
      <div class="spwt-email-help-body">
        <div class="spwt-help-step"><b>What this email is used for</b><br>
          This is the <b>sender email</b>. SP WorkTrack uses it to send reports, OTP/PIN recovery emails, quality/rework/loss reports, and future alerts. Report recipient screens still decide <b>who receives</b> the reports.
        </div>
        <div class="spwt-help-grid">
          <div class="spwt-help-step"><b>Step 2 - Turn on 2-Step Verification</b><br>
            Open the Gmail account -> <b>Manage your Google Account</b> -> <b>Security</b> -> <b>2-Step Verification</b> -> Turn ON. This is required before Google allows App Passwords.
          </div>
          <div class="spwt-help-step"><b>Step 3 - Generate App Password</b><br>
            Open <code>https://myaccount.google.com/apppasswords</code>, type app name <b>SP WorkTrack</b>, click <b>Create</b>, then copy the 16-character password. This is very sensitive information: do not paste it in any online AI tool, chat app, email, screenshot, or share it with anyone.
          </div>
          <div class="spwt-help-step"><b>Step 4 - Fill Email Sender Settings</b><br>
            SMTP Host: <code>smtp.gmail.com</code><br>
            SMTP Port: <code>587</code><br>
            SMTP Secure: <code>false</code><br>
            SMTP User: your sender Gmail ID<br>
            SMTP Password: App Password without spaces<br>
            Mail From: <code>SP WorkTrack &lt;sender@gmail.com&gt;</code>
          </div>
          <div class="spwt-help-step"><b>Step 5 - Test and Save</b><br>
            Enter Test Recipient, click <b>Send Test Email</b>. If received, click <b>Save Email Sender Settings</b>. Restart SP WorkTrack if any old sender is still used.
          </div>
        </div>
        <div class="spwt-help-step" style="background:#fff7ed;border-color:#fed7aa;"><b>Important safety</b><br>
          Use Gmail <b>App Password</b>, not normal Gmail login password. Leave password blank if you want to keep the saved password. Use <b>Clear saved SMTP password</b> only when you want to remove it from .env.
        </div>
      </div>
    `;
  }

  function showEmailSetupHelp() {
    ensureStyle();
    let backdrop = document.getElementById("spwtEmailHelpBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "spwtEmailHelpBackdrop";
      backdrop.className = "spwt-email-help-backdrop hidden";
      backdrop.innerHTML = `<div class="spwt-email-help-modal">${emailHelpHtml()}</div>`;
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop || event.target?.closest?.("[data-close-email-help]")) hideEmailSetupHelp();
      });
    }
    backdrop.classList.remove("hidden");
  }

  function hideEmailSetupHelp() {
    document.getElementById("spwtEmailHelpBackdrop")?.classList.add("hidden");
  }

  function addSectionHelp() {
    const body = document.getElementById("systemConfigBody");
    if (!body) return;

    body.querySelectorAll(".admin-controls-card").forEach((cardEl) => {
      if (cardEl.dataset.systemGuideEnhanced === "true") return;
      const title = sectionTitle(cardEl);
      let note = "";
      let actions = "";

      if (title.includes("pocketbase")) {
        note = `<b>What this is:</b> Internal database connection used by Node. Keep URL as <code>http://127.0.0.1:8090</code> unless PocketBase is moved/port changed. Update superuser password only when PocketBase admin password is changed.`;
        actions = `<button class="btn green" type="button" data-system-save-section="database">Save Database Settings</button>`;
      } else if (title.includes("google sheet")) {
        note = `<b>What this is:</b> Backup/sync receiver. Get Web App URL from Apps Script deployment. Backup Secret must be exactly same in app and Apps Script. Enable only after Test/backup receiver is ready.`;
        actions = `<button class="btn green" type="button" data-system-save-section="google">Save Google Backup Settings</button>`;
      } else if (title.includes("email sender")) {
        note = `<b>What this is:</b> Sender account for report emails. For Gmail, enable 2-Step Verification, create an App Password, paste it in SMTP Password, then use Send Test Email before saving for production.`;
        actions = `<button class="btn green" type="button" data-system-save-section="email">Save Email Sender Settings</button><button class="btn grey" type="button" data-system-test-email="true">Send Test Email</button><button class="btn grey" type="button" data-system-email-help="true">Help</button>`;
      } else if (title.includes("config file")) {
        note = `<b>Where values are saved:</b> Main runtime settings are written to <code>.env</code>. The <code>.env.example</code> file is only a sample/template and does not hold live secrets.`;
      }

      if (!note && !actions) return;
      cardEl.dataset.systemGuideEnhanced = "true";

      const noteEl = document.createElement("div");
      noteEl.className = "small-hint system-section-note";
      noteEl.innerHTML = note;
      const titleEl = cardEl.querySelector(".section-title");
      if (titleEl) titleEl.insertAdjacentElement("afterend", noteEl);
      else cardEl.insertAdjacentElement("afterbegin", noteEl);

      if (actions) {
        const actionEl = document.createElement("div");
        actionEl.className = "system-section-actions";
        actionEl.innerHTML = actions;
        cardEl.appendChild(actionEl);
      }
    });
  }

  function wireActions() {
    document.querySelectorAll("[data-system-save-section]").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener("click", clickSave);
    });
    document.querySelectorAll("[data-system-test-email]").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener("click", clickTestEmail);
    });
    document.querySelectorAll("[data-system-email-help]").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener("click", showEmailSetupHelp);
    });
  }

  function enhance() {
    ensureStyle();
    const tab = document.getElementById("tabSystemConfig");
    if (!tab) return;
    ensureTopGuide(tab);
    addSectionHelp();
    wireActions();
  }

  document.addEventListener("click", () => setTimeout(enhance, 160), true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideEmailSetupHelp();
  });
  document.addEventListener("DOMContentLoaded", () => setTimeout(enhance, 1200));
  setInterval(enhance, 1500);
})();