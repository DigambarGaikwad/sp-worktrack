// renderer/qualityReportRecipientsPatch.js
// Adds Quality Report Emails tab in Admin Settings.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let recipients = [];
  let eventsWired = false;
  let isBusy = false;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value)); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally { clearTimeout(timer); }
  }

  function status(message, type = "") {
    const el = document.getElementById("qualityReportRecipientsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = type ? "800" : "600";
  }

  function setBusy(value, message = "") {
    isBusy = Boolean(value);
    ["addQualityReportRecipientBtn", "saveQualityReportRecipientsBtn", "reloadQualityReportRecipientsBtn"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = isBusy;
    });
    if (message) status(message);
  }

  function normalizeRecipient(r = {}, index = 0) {
    return {
      id: clean(r.id || `R${Date.now()}_${index}`),
      name: clean(r.name),
      email: clean(r.email),
      role: clean(r.role),
      type: clean(r.type || r.recipientType || "to").toLowerCase() === "cc" ? "cc" : "to",
      active: r.active !== false
    };
  }

  function ensureTab() {
    const panel = document.getElementById("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return;

    if (!tabs.querySelector('[data-tab="tabQualityReportEmails"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.setAttribute("data-tab", "tabQualityReportEmails");
      btn.textContent = "Report Emails";
      const backupTab = tabs.querySelector('[data-tab="tabBackupControls"]');
      const pinTab = tabs.querySelector('[data-tab="tabPin"]');
      if (backupTab) tabs.insertBefore(btn, backupTab.nextSibling);
      else if (pinTab) tabs.insertBefore(btn, pinTab);
      else tabs.appendChild(btn);
    }

    if (!document.getElementById("tabQualityReportEmails")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabQualityReportEmails";
      page.innerHTML = `
        <div class="section-title">Quality Report Email Recipients</div>
        <div class="small-hint">Main recipients go in To. CC recipients go in CC. Only Active recipients receive report emails.</div>

        <div class="card admin-controls-card">
          <style>
            #tabQualityReportEmails .qr-error-field { border: 2px solid #ef4444 !important; background: #fff7f7 !important; color: #111827 !important; }
            #tabQualityReportEmails .admin-input, #tabQualityReportEmails .admin-select { color:#111827 !important; background:#ffffff !important; }
            #tabQualityReportEmails table { width:100%; border-collapse:collapse; }
            #tabQualityReportEmails th { text-align:left; padding:7px; background:#0b3f73; color:white; }
            #tabQualityReportEmails td { padding:6px; border-bottom:1px solid #e5e7eb; vertical-align:middle; }
            #tabQualityReportEmails .qr-delete { background:#fee2e2; color:#991b1b; border:0; border-radius:8px; padding:7px 10px; font-weight:800; cursor:pointer; }
          </style>

          <div class="grid-2">
            <div class="field"><label>Recipient Name</label><input id="qrRecipientName" class="admin-input" type="text" placeholder="Example: Quality Head" /></div>
            <div class="field"><label>Email ID</label><input id="qrRecipientEmail" class="admin-input" type="email" placeholder="quality@sopan.co.in" /></div>
            <div class="field"><label>Role / Department</label><input id="qrRecipientRole" class="admin-input" type="text" placeholder="Quality / Production / Assembly" /></div>
            <div class="field"><label>Recipient Type</label><select id="qrRecipientType" class="admin-select"><option value="to">Main Recipient</option><option value="cc">CC</option></select></div>
            <div class="field"><label class="quality-recheck-line"><input id="qrRecipientActive" type="checkbox" checked /> Active</label></div>
          </div>

          <div class="row admin-controls-actions" style="gap:8px; flex-wrap:wrap;">
            <button class="btn orange" id="addQualityReportRecipientBtn" type="button">+ Add Recipient</button>
            <button class="btn green" id="saveQualityReportRecipientsBtn" type="button">Save Recipients</button>
            <button class="btn grey" id="reloadQualityReportRecipientsBtn" type="button">Reload</button>
            <span class="small-hint" id="qualityReportRecipientsStatus"></span>
          </div>

          <div class="sum-table-wrap" style="margin-top:12px;">
            <div class="sum-table-title">Recipient List</div>
            <div class="sum-table" id="qualityReportRecipientsTable"></div>
          </div>
        </div>`;
      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }
  }

  function readTableBack() {
    document.querySelectorAll(".qr-name").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].name = input.value.trim(); });
    document.querySelectorAll(".qr-email").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].email = input.value.trim(); });
    document.querySelectorAll(".qr-role").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].role = input.value.trim(); });
    document.querySelectorAll(".qr-type").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].type = input.value === "cc" ? "cc" : "to"; });
    document.querySelectorAll(".qr-active").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].active = input.checked; });
  }

  function renderTable() {
    const host = document.getElementById("qualityReportRecipientsTable");
    if (!host) return;
    if (!recipients.length) {
      host.innerHTML = `<div class="small-hint">No recipients added yet.</div>`;
      return;
    }

    host.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th style="text-align:center;">Active</th><th style="text-align:center;">Action</th></tr></thead>
        <tbody>
          ${recipients.map((r, idx) => `
            <tr>
              <td><input class="admin-input qr-name" data-index="${idx}" value="${esc(r.name)}" /></td>
              <td><input class="admin-input qr-email" data-index="${idx}" value="${esc(r.email)}" /></td>
              <td><input class="admin-input qr-role" data-index="${idx}" value="${esc(r.role)}" /></td>
              <td><select class="admin-select qr-type" data-index="${idx}"><option value="to" ${r.type !== "cc" ? "selected" : ""}>Main Recipient</option><option value="cc" ${r.type === "cc" ? "selected" : ""}>CC</option></select></td>
              <td style="text-align:center;"><input class="qr-active" data-index="${idx}" type="checkbox" ${r.active !== false ? "checked" : ""} /></td>
              <td style="text-align:center;"><button class="qr-delete" data-index="${idx}" type="button">Delete</button></td>
            </tr>`).join("")}
        </tbody>
      </table>`;

    host.querySelectorAll("input,select").forEach(input => input.addEventListener("change", readTableBack));
    host.querySelectorAll(".qr-delete").forEach(btn => btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      readTableBack();
      const idx = Number(btn.dataset.index);
      recipients.splice(idx, 1);
      renderTable();
      status("Recipient deleted. Click Save Recipients to update DB.", "success");
    }));
  }

  function focusInvalid(input, message) {
    if (!input) return;
    input.classList.add("qr-error-field");
    status(message, "error");
    setTimeout(() => { input.focus(); input.select?.(); }, 80);
  }

  function clearErrors() {
    document.querySelectorAll("#tabQualityReportEmails .qr-error-field").forEach(el => el.classList.remove("qr-error-field"));
  }

  function addRecipient() {
    if (isBusy) return;
    clearErrors();
    const nameEl = document.getElementById("qrRecipientName");
    const emailEl = document.getElementById("qrRecipientEmail");
    const roleEl = document.getElementById("qrRecipientRole");
    const typeEl = document.getElementById("qrRecipientType");
    const activeEl = document.getElementById("qrRecipientActive");

    const name = clean(nameEl?.value);
    const email = clean(emailEl?.value);
    const role = clean(roleEl?.value);
    const type = typeEl?.value === "cc" ? "cc" : "to";
    const active = activeEl?.checked !== false;

    if (!email) return focusInvalid(emailEl, "Email ID is required.");
    if (!isValidEmail(email)) return focusInvalid(emailEl, "Enter a valid email ID.");

    readTableBack();
    const duplicate = recipients.some(r => clean(r.email).toLowerCase() === email.toLowerCase());
    if (duplicate) return focusInvalid(emailEl, "This email is already added.");

    recipients.push({ id: `R${Date.now()}`, name, email, role, type, active });
    if (nameEl) nameEl.value = "";
    if (emailEl) emailEl.value = "";
    if (roleEl) roleEl.value = "";
    if (typeEl) typeEl.value = "to";
    if (activeEl) activeEl.checked = true;
    renderTable();
    status("Recipient added. Click Save Recipients to update DB.", "success");
    setTimeout(() => nameEl?.focus(), 80);
  }

  function validateTableBeforeSave() {
    readTableBack();
    clearErrors();
    const seen = new Set();
    for (let i = 0; i < recipients.length; i += 1) {
      const r = recipients[i];
      const email = clean(r.email);
      const el = document.querySelector(`.qr-email[data-index="${i}"]`);
      if (!email) { focusInvalid(el, "Email ID cannot be blank."); return false; }
      if (!isValidEmail(email)) { focusInvalid(el, "Invalid email found. Correct it before saving."); return false; }
      const key = email.toLowerCase();
      if (seen.has(key)) { focusInvalid(el, "Duplicate email found. Delete duplicate before saving."); return false; }
      seen.add(key);
    }
    return true;
  }

  async function loadRecipients() {
    if (isBusy) return;
    try {
      setBusy(true, "Loading recipients...");
      const payload = await requestJson("/api/email/quality-report/recipients", { method: "GET" });
      recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients.map(normalizeRecipient) : [];
      renderTable();
      status("Recipients loaded.", "success");
    } catch (err) {
      status("Load failed: " + (err?.message || err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveRecipients() {
    if (isBusy) return;
    if (!validateTableBeforeSave()) return;
    try {
      setBusy(true, "Saving recipients...");
      const payload = await requestJson("/api/email/quality-report/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients })
      });
      recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients.map(normalizeRecipient) : [];
      renderTable();
      status("Recipients saved to DB.", "success");
    } catch (err) {
      status("Save failed: " + (err?.message || err), "error");
    } finally {
      setBusy(false);
    }
  }

  function wireButtons() {
    const addBtn = document.getElementById("addQualityReportRecipientBtn");
    const saveBtn = document.getElementById("saveQualityReportRecipientsBtn");
    const reloadBtn = document.getElementById("reloadQualityReportRecipientsBtn");
    if (addBtn && !addBtn.__wired) { addBtn.__wired = true; addBtn.addEventListener("click", (e) => { e.preventDefault(); addRecipient(); }); }
    if (saveBtn && !saveBtn.__wired) { saveBtn.__wired = true; saveBtn.addEventListener("click", (e) => { e.preventDefault(); saveRecipients(); }); }
    if (reloadBtn && !reloadBtn.__wired) { reloadBtn.__wired = true; reloadBtn.addEventListener("click", (e) => { e.preventDefault(); loadRecipients(); }); }
  }

  function showTab() {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabQualityReportEmails"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    document.getElementById("tabQualityReportEmails")?.classList.remove("hidden");
    renderTab();
  }

  async function renderTab() {
    ensureTab();
    wireButtons();
    await loadRecipients();
  }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtQrEmailPatchedV2) return;
    const patched = function (tabId) {
      if (tabId === "tabQualityReportEmails") { showTab(); return; }
      return original.apply(this, arguments);
    };
    patched.__spwtQrEmailPatchedV2 = true;
    window.switchAdminTab = patched;
  }

  function wireEventsOnce() {
    if (eventsWired) return;
    eventsWired = true;
    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabQualityReportEmails"]')) {
        e.preventDefault(); e.stopPropagation(); setTimeout(showTab, 0);
      }
      setTimeout(wireButtons, 0);
    }, true);
  }

  function init() { ensureTab(); patchSwitchAdminTab(); wireButtons(); wireEventsOnce(); }

  window.SPWT_RENDER_QR_EMAIL_RECIPIENTS = renderTab;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
