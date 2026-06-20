// renderer/admin/adminSystemConfigPatch.js
// Adds protected Admin -> System Settings for editable .env email/backup/PocketBase configuration.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;

  let loading = false;
  let lastSettings = null;

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
  function hasPermission(permission) {
    const user = window.SPWT_ADMIN_ACCESS?.getUser?.() || null;
    if (!user) return true;
    return window.SPWT_ADMIN_ACCESS?.hasPermission?.(permission) === true;
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { ...(options.headers || {}) };
      const t = token();
      if (t) headers["x-spwt-admin-token"] = t;
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function setting(section, key) {
    return lastSettings?.sections?.[section]?.[key] || { value: "", hasValue: false, sensitive: false };
  }

  function settingValue(section, key) {
    return setting(section, key).value || "";
  }

  function ensureTab() {
    const panel = $("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return false;

    if (!tabs.querySelector('[data-tab="tabSystemConfig"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.dataset.tab = "tabSystemConfig";
      btn.textContent = "System Settings";
      const systemInfoTab = tabs.querySelector('[data-tab="tabSystemInfo"]');
      if (systemInfoTab) systemInfoTab.insertAdjacentElement("afterend", btn);
      else tabs.appendChild(btn);
    }

    if (!$("tabSystemConfig")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabSystemConfig";
      page.innerHTML = `
        <div class="section-title">System Settings</div>
        <div class="small-hint">Protected setup screen for sender email, PocketBase connection, and Google Sheet backup configuration. Secrets are never displayed.</div>

        <div class="card admin-controls-card" style="margin-top:12px;background:#fff7ed;border-color:#fed7aa;">
          <div class="section-title">Important</div>
          <div class="small-hint" style="line-height:1.7;">
            - Leave password/secret fields blank to keep current saved value.<br>
            - Saving writes to <b>.env</b> and updates the running Node process for email/backup values where possible.<br>
            - Restart SP WorkTrack after major config changes if any service still uses old values.<br>
            - Give this permission only to trusted admins.
          </div>
        </div>

        <div class="card admin-controls-card" style="margin-top:12px;">
          <div class="row admin-controls-actions" style="gap:10px;flex-wrap:wrap;">
            <button class="btn green" id="loadSystemConfigBtn" type="button">Load Settings</button>
            <button class="btn green" id="saveSystemConfigBtn" type="button">Save System Settings</button>
            <button class="btn grey" id="testSystemEmailBtn" type="button">Send Test Email</button>
            <button class="btn grey" id="copyEnvPathBtn" type="button">Copy .env Path</button>
            <span class="small-hint" id="systemConfigStatus"></span>
          </div>
        </div>

        <div id="systemConfigBody" style="margin-top:14px;"></div>
      `;
      const footer = panel.querySelector("hr") || panel.lastElementChild;
      if (footer) panel.insertBefore(page, footer);
      else panel.appendChild(page);
    }

    wireButtons();
    applyPermission();
    return true;
  }

  function status(message, type = "") {
    const el = $("systemConfigStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.fontWeight = "900";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function inputRow(label, id, value = "", note = "", type = "text", placeholder = "") {
    return `<div class="field">
      <label>${esc(label)}</label>
      <input id="${esc(id)}" class="admin-input" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" />
      ${note ? `<div class="small-hint">${esc(note)}</div>` : ""}
    </div>`;
  }

  function selectRow(label, id, value, options, note = "") {
    return `<div class="field">
      <label>${esc(label)}</label>
      <select id="${esc(id)}" class="admin-select">
        ${options.map(opt => `<option value="${esc(opt.value)}" ${String(value) === String(opt.value) ? "selected" : ""}>${esc(opt.label)}</option>`).join("")}
      </select>
      ${note ? `<div class="small-hint">${esc(note)}</div>` : ""}
    </div>`;
  }

  function secretNote(section, key) {
    return setting(section, key).hasValue ? "Saved. Leave blank to keep existing value." : "Not saved. Enter value to configure.";
  }

  function renderSettings() {
    const host = $("systemConfigBody");
    if (!host) return;
    if (!lastSettings) {
      host.innerHTML = `<div class="card admin-controls-card"><div class="small-hint">Click Load Settings.</div></div>`;
      return;
    }

    host.innerHTML = `
      <div class="grid-2">
        <div class="card admin-controls-card">
          <div class="section-title">PocketBase / Database Runtime</div>
          <div class="small-hint">Used by Node to connect to PocketBase. Superuser password is hidden.</div>
          <div class="grid-2" style="margin-top:10px;">
            ${inputRow("PocketBase URL", "cfgPocketbaseUrl", settingValue("pocketbase", "POCKETBASE_URL"), "Example: http://127.0.0.1:8090")}
            ${inputRow("PocketBase Superuser Email", "cfgPbEmail", settingValue("pocketbase", "POCKETBASE_SUPERUSER_EMAIL"))}
            ${inputRow("PocketBase Superuser Password", "cfgPbPassword", "", secretNote("pocketbase", "POCKETBASE_SUPERUSER_PASSWORD"), "password", "Leave blank to keep saved password")}
            <label class="quality-recheck-line" style="align-self:end;margin-bottom:12px;"><input type="checkbox" id="clearPbPassword" /> Clear saved PocketBase password</label>
          </div>
        </div>

        <div class="card admin-controls-card">
          <div class="section-title">Google Sheet Backup</div>
          <div class="small-hint">Apps Script backup endpoint and secret used by Google Sheet backup/sync.</div>
          <div class="grid-2" style="margin-top:10px;">
            ${selectRow("Backup Enabled", "cfgGsEnabled", settingValue("googleSheetBackup", "GOOGLE_SHEET_BACKUP_ENABLED") || "false", [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }])}
            ${inputRow("Timeout (ms)", "cfgGsTimeout", settingValue("googleSheetBackup", "GOOGLE_SHEET_BACKUP_TIMEOUT_MS") || "15000", "Default 15000", "number")}
            ${inputRow("Scheduler Check (ms)", "cfgGsScheduler", settingValue("googleSheetBackup", "GOOGLE_SHEET_BACKUP_SCHEDULER_INTERVAL_MS") || "60000", "Default 60000", "number")}
            ${inputRow("Web App URL", "cfgGsUrl", settingValue("googleSheetBackup", "GOOGLE_SHEET_WEBAPP_URL"), "Paste Apps Script Web App URL")}
            ${inputRow("Backup Secret", "cfgGsSecret", "", secretNote("googleSheetBackup", "GOOGLE_SHEET_BACKUP_SECRET"), "password", "Leave blank to keep saved secret")}
            <label class="quality-recheck-line" style="align-self:end;margin-bottom:12px;"><input type="checkbox" id="clearGsSecret" /> Clear saved backup secret</label>
          </div>
        </div>
      </div>

      <div class="card admin-controls-card" style="margin-top:14px;">
        <div class="section-title">Email Sender Settings</div>
        <div class="small-hint">Controls which email account sends reports and test emails. Report recipient tabs still control who receives reports.</div>
        <div class="grid-2" style="margin-top:10px;">
          ${inputRow("SMTP Host", "cfgSmtpHost", settingValue("email", "SMTP_HOST"), "Example: smtp.gmail.com")}
          ${inputRow("SMTP Port", "cfgSmtpPort", settingValue("email", "SMTP_PORT") || "587", "Gmail TLS usually 587", "number")}
          ${selectRow("SMTP Secure SSL/TLS", "cfgSmtpSecure", settingValue("email", "SMTP_SECURE") || "false", [{ value: "false", label: "No / STARTTLS port 587" }, { value: "true", label: "Yes / SSL port 465" }])}
          ${inputRow("SMTP User", "cfgSmtpUser", settingValue("email", "SMTP_USER"), "Usually sender Gmail/company email")}
          ${inputRow("SMTP Password / App Password", "cfgSmtpPass", "", secretNote("email", "SMTP_PASS"), "password", "Leave blank to keep saved password")}
          ${inputRow("Mail From", "cfgMailFrom", settingValue("email", "MAIL_FROM"), "Example: SP WorkTrack <name@gmail.com>")}
          ${inputRow("Test Recipient", "cfgTestEmail", settingValue("email", "SMTP_USER"), "Where test email should be sent")}
          <label class="quality-recheck-line" style="align-self:end;margin-bottom:12px;"><input type="checkbox" id="clearSmtpPass" /> Clear saved SMTP password</label>
        </div>
      </div>

      <div class="card admin-controls-card" style="margin-top:14px;">
        <div class="section-title">Config File Paths</div>
        <table class="admin-table" style="margin-top:8px;">
          <tbody>
            <tr><td style="font-weight:900;width:220px;">.env</td><td><code>${esc(lastSettings.envPath || "")}</code><div class="small-hint">${lastSettings.envExists ? "Found" : "Will be created on save"}</div></td></tr>
            <tr><td style="font-weight:900;">.env.example</td><td><code>${esc(lastSettings.envExamplePath || "")}</code><div class="small-hint">${lastSettings.envExampleExists ? "Found" : "Not found"}</div></td></tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function readSettingsForm() {
    return {
      POCKETBASE_URL: $("cfgPocketbaseUrl")?.value || "",
      POCKETBASE_SUPERUSER_EMAIL: $("cfgPbEmail")?.value || "",
      POCKETBASE_SUPERUSER_PASSWORD: $("cfgPbPassword")?.value || "",
      SMTP_HOST: $("cfgSmtpHost")?.value || "",
      SMTP_PORT: $("cfgSmtpPort")?.value || "587",
      SMTP_SECURE: $("cfgSmtpSecure")?.value || "false",
      SMTP_USER: $("cfgSmtpUser")?.value || "",
      SMTP_PASS: $("cfgSmtpPass")?.value || "",
      MAIL_FROM: $("cfgMailFrom")?.value || "",
      GOOGLE_SHEET_BACKUP_ENABLED: $("cfgGsEnabled")?.value || "false",
      GOOGLE_SHEET_WEBAPP_URL: $("cfgGsUrl")?.value || "",
      GOOGLE_SHEET_BACKUP_SECRET: $("cfgGsSecret")?.value || "",
      GOOGLE_SHEET_BACKUP_TIMEOUT_MS: $("cfgGsTimeout")?.value || "15000",
      GOOGLE_SHEET_BACKUP_SCHEDULER_INTERVAL_MS: $("cfgGsScheduler")?.value || "60000"
    };
  }

  function readClearKeys() {
    const keys = [];
    if ($("clearPbPassword")?.checked) keys.push("POCKETBASE_SUPERUSER_PASSWORD");
    if ($("clearSmtpPass")?.checked) keys.push("SMTP_PASS");
    if ($("clearGsSecret")?.checked) keys.push("GOOGLE_SHEET_BACKUP_SECRET");
    return keys;
  }

  async function loadSettings() {
    if (loading) return;
    if (!hasPermission("systemConfig")) return status("No permission: System Settings", "error");
    loading = true;
    try {
      status("Loading settings...");
      const payload = await requestJson("/api/system-config/settings", { method: "GET" });
      lastSettings = payload.data || {};
      renderSettings();
      status("Settings loaded.", "success");
    } catch (err) {
      console.error("System settings load failed:", err);
      status("Load failed: " + (err.message || err), "error");
      alert("System Settings load failed:\n\n" + (err.message || err));
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    if (!hasPermission("systemConfig")) return alert("No permission: System Settings");
    if (!confirm("Save System Settings to .env?\n\nSecret fields left blank will keep their existing value.")) return;

    const btn = $("saveSystemConfigBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
      status("Saving settings...");
      const payload = await requestJson("/api/system-config/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: readSettingsForm(), clearKeys: readClearKeys() })
      });
      lastSettings = payload.data || {};
      renderSettings();
      status("Settings saved to .env.", "success");
      alert("System Settings saved. Restart SP WorkTrack if any service still uses old values.");
    } catch (err) {
      console.error("System settings save failed:", err);
      status("Save failed: " + (err.message || err), "error");
      alert("System Settings save failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save System Settings"; }
    }
  }

  async function sendTestEmail() {
    if (!hasPermission("systemConfig")) return alert("No permission: System Settings");
    const to = ($("cfgTestEmail")?.value || "").trim();
    if (!to) return alert("Enter Test Recipient email first.");

    const btn = $("testSystemEmailBtn");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
      status("Sending test email...");
      await requestJson("/api/system-config/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to })
      });
      status("Test email sent.", "success");
      alert("Test email sent successfully.");
    } catch (err) {
      console.error("Test email failed:", err);
      status("Test failed: " + (err.message || err), "error");
      alert("Test email failed:\n\n" + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Send Test Email"; }
    }
  }

  async function copyEnvPath() {
    const text = lastSettings?.envPath || "";
    if (!text) return alert("Load settings first.");
    try {
      await navigator.clipboard.writeText(text);
      status(".env path copied.", "success");
    } catch {
      window.prompt("Copy .env path:", text);
    }
  }

  function wireButtons() {
    const loadBtn = $("loadSystemConfigBtn");
    if (loadBtn && !loadBtn.__wired) { loadBtn.__wired = true; loadBtn.onclick = loadSettings; }
    const saveBtn = $("saveSystemConfigBtn");
    if (saveBtn && !saveBtn.__wired) { saveBtn.__wired = true; saveBtn.onclick = saveSettings; }
    const testBtn = $("testSystemEmailBtn");
    if (testBtn && !testBtn.__wired) { testBtn.__wired = true; testBtn.onclick = sendTestEmail; }
    const copyBtn = $("copyEnvPathBtn");
    if (copyBtn && !copyBtn.__wired) { copyBtn.__wired = true; copyBtn.onclick = copyEnvPath; }
  }

  function applyPermission() {
    const tab = document.querySelector('[data-tab="tabSystemConfig"]');
    const page = $("tabSystemConfig");
    const user = window.SPWT_ADMIN_ACCESS?.getUser?.() || null;
    if (!user) return;
    const allowed = hasPermission("systemConfig");
    if (tab) tab.style.display = allowed ? "" : "none";
    if (page && !allowed) page.classList.add("hidden");
  }

  function showTab() {
    if (!hasPermission("systemConfig")) return alert("No permission: System Settings");
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabSystemConfig"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    $("tabSystemConfig")?.classList.remove("hidden");
    if (!lastSettings) loadSettings();
  }

  function init() {
    if (!ensureTab()) return;
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.('[data-tab="tabSystemConfig"]')) {
        event.preventDefault();
        event.stopPropagation();
        setTimeout(showTab, 0);
      }
    }, true);
    setTimeout(() => { applyPermission(); wireButtons(); }, 500);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 900));
  setInterval(() => { ensureTab(); applyPermission(); }, 2000);
})();
