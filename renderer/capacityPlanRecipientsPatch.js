// renderer/capacityPlanRecipientsPatch.js
// Adds Production Plan recipient section in Admin -> Report Emails.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let recipients = [];
  let eventsWired = false;
  let isBusy = false;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3032"; }
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
    const el = document.getElementById("capacityPlanRecipientsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = type ? "800" : "600";
  }

  function setBusy(value, message = "") {
    isBusy = Boolean(value);
    ["addCapacityPlanRecipientBtn", "saveCapacityPlanRecipientsBtn", "reloadCapacityPlanRecipientsBtn"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = isBusy;
    });
    if (message) status(message);
  }

  function normalizeRecipient(r = {}, index = 0) {
    return {
      id: clean(r.id || `CP${Date.now()}_${index}`),
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

    let btn = tabs.querySelector('[data-tab="tabQualityReportEmails"]');
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.dataset.tab = "tabQualityReportEmails";
      btn.textContent = "Report Emails";
      const pinTab = tabs.querySelector('[data-tab="tabPin"]');
      if (pinTab) tabs.insertBefore(btn, pinTab);
      else tabs.appendChild(btn);
    } else if (!/Report Emails/i.test(btn.textContent || "")) {
      btn.textContent = "Report Emails";
    }

    let page = document.getElementById("tabQualityReportEmails");
    if (!page) {
      page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabQualityReportEmails";
      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }

    if (!document.getElementById("capacityPlanEmailSection")) {
      const section = document.createElement("div");
      section.id = "capacityPlanEmailSection";
      section.innerHTML = `
        <div class="section-title" style="margin-top:18px;">Production Plan Email Recipients</div>
        <div class="small-hint">Used by Capacity Planning → Copy / Send. Main recipients go in To. CC recipients go in CC.</div>
        <div class="card admin-controls-card">
          <style>
            #capacityPlanEmailSection .cp-error-field { border: 2px solid #ef4444 !important; background: #fff7f7 !important; color: #111827 !important; }
            #capacityPlanEmailSection .admin-input, #capacityPlanEmailSection .admin-select { color:#111827 !important; background:#ffffff !important; }
            #capacityPlanEmailSection table { width:100%; border-collapse:collapse; }
            #capacityPlanEmailSection th { text-align:left; padding:7px; background:#0b3f73; color:white; }
            #capacityPlanEmailSection td { padding:6px; border-bottom:1px solid #e5e7eb; vertical-align:middle; }
            #capacityPlanEmailSection .cp-delete { background:#fee2e2; color:#991b1b; border:0; border-radius:8px; padding:7px 10px; font-weight:800; cursor:pointer; }
          </style>
          <div class="grid-2">
            <div class="field"><label>Recipient Name</label><input id="cpRecipientName" class="admin-input" type="text" placeholder="Example: Production Head" /></div>
            <div class="field"><label>Email ID</label><input id="cpRecipientEmail" class="admin-input" type="email" placeholder="production@sopan.co.in" /></div>
            <div class="field"><label>Role / Department</label><input id="cpRecipientRole" class="admin-input" type="text" placeholder="Production / Planning / Assembly" /></div>
            <div class="field"><label>Recipient Type</label><select id="cpRecipientType" class="admin-select"><option value="to">Main Recipient</option><option value="cc">CC</option></select></div>
            <div class="field"><label class="quality-recheck-line"><input id="cpRecipientActive" type="checkbox" checked /> Active</label></div>
          </div>
          <div class="row admin-controls-actions" style="gap:8px; flex-wrap:wrap;">
            <button class="btn orange" id="addCapacityPlanRecipientBtn" type="button">+ Add Recipient</button>
            <button class="btn green" id="saveCapacityPlanRecipientsBtn" type="button">Save Recipients</button>
            <button class="btn grey" id="reloadCapacityPlanRecipientsBtn" type="button">Reload</button>
            <span class="small-hint" id="capacityPlanRecipientsStatus"></span>
          </div>
          <div class="sum-table-wrap" style="margin-top:12px;">
            <div class="sum-table-title">Production Plan Recipient List</div>
            <div class="sum-table" id="capacityPlanRecipientsTable"></div>
          </div>
        </div>`;
      page.appendChild(section);
    }
  }

  function readTableBack() {
    document.querySelectorAll(".cp-name").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].name = input.value.trim(); });
    document.querySelectorAll(".cp-email").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].email = input.value.trim(); });
    document.querySelectorAll(".cp-role").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].role = input.value.trim(); });
    document.querySelectorAll(".cp-type").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].type = input.value === "cc" ? "cc" : "to"; });
    document.querySelectorAll(".cp-active").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].active = input.checked; });
  }

  function renderTable() {
    const host = document.getElementById("capacityPlanRecipientsTable");
    if (!host) return;
    if (!recipients.length) { host.innerHTML = `<div class="small-hint">No production plan recipients added yet.</div>`; return; }
    host.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th style="text-align:center;">Active</th><th style="text-align:center;">Action</th></tr></thead><tbody>${recipients.map((r, idx) => `<tr><td><input class="admin-input cp-name" data-index="${idx}" value="${esc(r.name)}" /></td><td><input class="admin-input cp-email" data-index="${idx}" value="${esc(r.email)}" /></td><td><input class="admin-input cp-role" data-index="${idx}" value="${esc(r.role)}" /></td><td><select class="admin-select cp-type" data-index="${idx}"><option value="to" ${r.type !== "cc" ? "selected" : ""}>Main Recipient</option><option value="cc" ${r.type === "cc" ? "selected" : ""}>CC</option></select></td><td style="text-align:center;"><input class="cp-active" data-index="${idx}" type="checkbox" ${r.active !== false ? "checked" : ""} /></td><td style="text-align:center;"><button class="cp-delete" data-index="${idx}" type="button">Delete</button></td></tr>`).join("")}</tbody></table>`;
    host.querySelectorAll("input,select").forEach(input => input.addEventListener("change", readTableBack));
    host.querySelectorAll(".cp-delete").forEach(btn => btn.addEventListener("click", (e) => { e.preventDefault(); readTableBack(); recipients.splice(Number(btn.dataset.index), 1); renderTable(); status("Recipient deleted. Click Save Recipients to update DB.", "success"); }));
  }

  function focusInvalid(input, message) { if (!input) return; input.classList.add("cp-error-field"); status(message, "error"); setTimeout(() => { input.focus(); input.select?.(); }, 80); }
  function clearErrors() { document.querySelectorAll("#capacityPlanEmailSection .cp-error-field").forEach(el => el.classList.remove("cp-error-field")); }

  function addRecipient() {
    if (isBusy) return;
    clearErrors();
    const nameEl = document.getElementById("cpRecipientName"), emailEl = document.getElementById("cpRecipientEmail"), roleEl = document.getElementById("cpRecipientRole"), typeEl = document.getElementById("cpRecipientType"), activeEl = document.getElementById("cpRecipientActive");
    const email = clean(emailEl?.value);
    if (!email) return focusInvalid(emailEl, "Email ID is required.");
    if (!isValidEmail(email)) return focusInvalid(emailEl, "Enter a valid email ID.");
    readTableBack();
    if (recipients.some(r => clean(r.email).toLowerCase() === email.toLowerCase())) return focusInvalid(emailEl, "This email is already added.");
    recipients.push({ id: `CP${Date.now()}`, name: clean(nameEl?.value), email, role: clean(roleEl?.value), type: typeEl?.value === "cc" ? "cc" : "to", active: activeEl?.checked !== false });
    if (nameEl) nameEl.value = ""; if (emailEl) emailEl.value = ""; if (roleEl) roleEl.value = ""; if (typeEl) typeEl.value = "to"; if (activeEl) activeEl.checked = true;
    renderTable(); status("Recipient added. Click Save Recipients to update DB.", "success"); setTimeout(() => nameEl?.focus(), 80);
  }

  function validateTableBeforeSave() {
    readTableBack(); clearErrors();
    const seen = new Set();
    for (let i = 0; i < recipients.length; i += 1) {
      const email = clean(recipients[i].email), el = document.querySelector(`.cp-email[data-index="${i}"]`);
      if (!email) { focusInvalid(el, "Email ID cannot be blank."); return false; }
      if (!isValidEmail(email)) { focusInvalid(el, "Invalid email found. Correct it before saving."); return false; }
      const k = email.toLowerCase(); if (seen.has(k)) { focusInvalid(el, "Duplicate email found. Delete duplicate before saving."); return false; }
      seen.add(k);
    }
    return true;
  }

  async function loadRecipients() {
    if (isBusy) return;
    try { setBusy(true, "Loading production plan recipients..."); const payload = await requestJson("/api/email/capacity-plan/recipients", { method: "GET" }); recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients.map(normalizeRecipient) : []; renderTable(); status("Production plan recipients loaded.", "success"); }
    catch (err) { status("Load failed: " + (err?.message || err), "error"); }
    finally { setBusy(false); }
  }

  async function saveRecipients() {
    if (isBusy || !validateTableBeforeSave()) return;
    try { setBusy(true, "Saving production plan recipients..."); const payload = await requestJson("/api/email/capacity-plan/recipients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipients }) }); recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients.map(normalizeRecipient) : []; renderTable(); status("Production plan recipients saved to DB.", "success"); }
    catch (err) { status("Save failed: " + (err?.message || err), "error"); }
    finally { setBusy(false); }
  }

  function wireButtons() {
    const addBtn = document.getElementById("addCapacityPlanRecipientBtn"), saveBtn = document.getElementById("saveCapacityPlanRecipientsBtn"), reloadBtn = document.getElementById("reloadCapacityPlanRecipientsBtn");
    if (addBtn && !addBtn.__wired) { addBtn.__wired = true; addBtn.addEventListener("click", (e) => { e.preventDefault(); addRecipient(); }); }
    if (saveBtn && !saveBtn.__wired) { saveBtn.__wired = true; saveBtn.addEventListener("click", (e) => { e.preventDefault(); saveRecipients(); }); }
    if (reloadBtn && !reloadBtn.__wired) { reloadBtn.__wired = true; reloadBtn.addEventListener("click", (e) => { e.preventDefault(); loadRecipients(); }); }
  }

  async function renderTab() { ensureTab(); wireButtons(); await loadRecipients(); }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtCapacityEmailPatched) return;
    const patched = function (tabId) {
      if (tabId === "tabQualityReportEmails") { setTimeout(renderTab, 0); return original.apply(this, arguments); }
      return original.apply(this, arguments);
    };
    patched.__spwtCapacityEmailPatched = true;
    window.switchAdminTab = patched;
  }

  function wireEventsOnce() {
    if (eventsWired) return;
    eventsWired = true;
    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabQualityReportEmails"]')) setTimeout(renderTab, 100);
      setTimeout(wireButtons, 0);
    }, true);
  }

  function init() { ensureTab(); patchSwitchAdminTab(); wireButtons(); wireEventsOnce(); }
  window.SPWT_RENDER_CAPACITY_PLAN_RECIPIENTS = renderTab;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
