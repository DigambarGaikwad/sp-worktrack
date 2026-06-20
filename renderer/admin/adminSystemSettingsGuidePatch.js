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
      @media (max-width: 900px) {
        .system-settings-guide-grid { grid-template-columns: 1fr; }
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
        ${card("Google Sheet Backup", `Web App URL comes from Google Apps Script deployment: <b>Deploy → Manage deployments → Web app URL</b>. Backup Secret must match the secret configured in the Apps Script backup receiver.`)}
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
        actions = `<button class="btn green" type="button" data-system-save-section="email">Save Email Sender Settings</button><button class="btn grey" type="button" data-system-test-email="true">Send Test Email</button>`;
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
  document.addEventListener("DOMContentLoaded", () => setTimeout(enhance, 1200));
  setInterval(enhance, 1500);
})();
