// renderer/reworkOtherReportRecipientsPatch.js
// Adds Rework / Other Work / Loss Hours report recipients inside Admin Report Emails tab.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let recipients = [];
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
    const el = document.getElementById("rwReportRecipientsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = type ? "800" : "600";
  }

  function setBusy(value, message = "") {
    isBusy = Boolean(value);
    ["addRwReportRecipientBtn", "saveRwReportRecipientsBtn", "reloadRwReportRecipientsBtn"].forEach(id => { const btn = document.getElementById(id); if (btn) btn.disabled = isBusy; });
    if (message) status(message);
  }

  function normalizeRecipient(r = {}, index = 0) {
    return { id: clean(r.id || `R${Date.now()}_${index}`), name: clean(r.name), email: clean(r.email), role: clean(r.role), type: clean(r.type || "to").toLowerCase() === "cc" ? "cc" : "to", active: r.active !== false };
  }

  function ensureUi() {
    const page = document.getElementById("tabQualityReportEmails");
    if (!page || document.getElementById("rwReportRecipientsBox")) return;
    const box = document.createElement("div");
    box.id = "rwReportRecipientsBox";
    box.className = "card admin-controls-card";
    box.style.marginTop = "18px";
    box.innerHTML = `
      <div class="section-title">Rework / Other Work / Loss Hours Report Recipients</div>
      <div class="small-hint">Same recipients are used for Rework Report, Other Work Report and Loss Hours Report emails.</div>
      <div class="grid-2" style="margin-top:10px;">
        <div class="field"><label>Recipient Name</label><input id="rwRecipientName" class="admin-input" type="text" placeholder="Example: Production Head" /></div>
        <div class="field"><label>Email ID</label><input id="rwRecipientEmail" class="admin-input" type="email" placeholder="production@sopan.co.in" /></div>
        <div class="field"><label>Role / Department</label><input id="rwRecipientRole" class="admin-input" type="text" placeholder="Production / Assembly / Management" /></div>
        <div class="field"><label>Recipient Type</label><select id="rwRecipientType" class="admin-select"><option value="to">Main Recipient</option><option value="cc">CC</option></select></div>
        <div class="field"><label class="quality-recheck-line"><input id="rwRecipientActive" type="checkbox" checked /> Active</label></div>
      </div>
      <div class="row admin-controls-actions" style="gap:8px; flex-wrap:wrap;">
        <button class="btn orange" id="addRwReportRecipientBtn" type="button">+ Add Recipient</button>
        <button class="btn green" id="saveRwReportRecipientsBtn" type="button">Save Rework / Other / Loss Recipients</button>
        <button class="btn grey" id="reloadRwReportRecipientsBtn" type="button">Reload</button>
        <span class="small-hint" id="rwReportRecipientsStatus"></span>
      </div>
      <div class="sum-table-wrap" style="margin-top:12px;"><div class="sum-table-title">Recipient List</div><div class="sum-table" id="rwReportRecipientsTable"></div></div>`;
    page.appendChild(box);
    wireButtons();
    loadRecipients();
  }

  function readTableBack() {
    document.querySelectorAll(".rw-name").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].name = input.value.trim(); });
    document.querySelectorAll(".rw-email").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].email = input.value.trim(); });
    document.querySelectorAll(".rw-role").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].role = input.value.trim(); });
    document.querySelectorAll(".rw-type").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].type = input.value === "cc" ? "cc" : "to"; });
    document.querySelectorAll(".rw-active").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].active = input.checked; });
  }

  function renderTable() {
    const host = document.getElementById("rwReportRecipientsTable");
    if (!host) return;
    if (!recipients.length) { host.innerHTML = `<div class="small-hint">No recipients added yet.</div>`; return; }
    host.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th style="text-align:center;">Active</th><th style="text-align:center;">Action</th></tr></thead><tbody>${recipients.map((r, idx) => `<tr><td><input class="admin-input rw-name" data-index="${idx}" value="${esc(r.name)}" /></td><td><input class="admin-input rw-email" data-index="${idx}" value="${esc(r.email)}" /></td><td><input class="admin-input rw-role" data-index="${idx}" value="${esc(r.role)}" /></td><td><select class="admin-select rw-type" data-index="${idx}"><option value="to" ${r.type !== "cc" ? "selected" : ""}>Main Recipient</option><option value="cc" ${r.type === "cc" ? "selected" : ""}>CC</option></select></td><td style="text-align:center;"><input class="rw-active" data-index="${idx}" type="checkbox" ${r.active !== false ? "checked" : ""} /></td><td style="text-align:center;"><button class="qr-delete rw-delete" data-index="${idx}" type="button">Delete</button></td></tr>`).join("")}</tbody></table>`;
    host.querySelectorAll("input,select").forEach(input => input.addEventListener("change", readTableBack));
    host.querySelectorAll(".rw-delete").forEach(btn => btn.addEventListener("click", (e) => { e.preventDefault(); readTableBack(); recipients.splice(Number(btn.dataset.index), 1); renderTable(); status("Recipient deleted. Click Save to update DB.", "success"); }));
  }

  function addRecipient() {
    if (isBusy) return;
    const nameEl = document.getElementById("rwRecipientName"), emailEl = document.getElementById("rwRecipientEmail"), roleEl = document.getElementById("rwRecipientRole"), typeEl = document.getElementById("rwRecipientType"), activeEl = document.getElementById("rwRecipientActive");
    const name = clean(nameEl?.value), email = clean(emailEl?.value), role = clean(roleEl?.value), type = typeEl?.value === "cc" ? "cc" : "to", active = activeEl?.checked !== false;
    if (!email) { status("Email ID is required.", "error"); emailEl?.focus(); return; }
    if (!isValidEmail(email)) { status("Enter a valid email ID.", "error"); emailEl?.focus(); return; }
    readTableBack();
    if (recipients.some(r => clean(r.email).toLowerCase() === email.toLowerCase())) { status("This email is already added.", "error"); emailEl?.focus(); return; }
    recipients.push({ id: `R${Date.now()}`, name, email, role, type, active });
    if (nameEl) nameEl.value = ""; if (emailEl) emailEl.value = ""; if (roleEl) roleEl.value = ""; if (typeEl) typeEl.value = "to"; if (activeEl) activeEl.checked = true;
    renderTable(); status("Recipient added. Click Save to update DB.", "success");
  }

  function validate() {
    readTableBack();
    const seen = new Set();
    for (const r of recipients) {
      if (!isValidEmail(r.email)) { status("Invalid email found. Correct before saving.", "error"); return false; }
      const key = clean(r.email).toLowerCase();
      if (seen.has(key)) { status("Duplicate email found.", "error"); return false; }
      seen.add(key);
    }
    return true;
  }

  async function loadRecipients() {
    if (isBusy) return;
    try { setBusy(true, "Loading recipients..."); const payload = await requestJson("/api/email/rework-other-report/recipients", { method: "GET" }); recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients.map(normalizeRecipient) : []; renderTable(); status("Recipients loaded.", "success"); }
    catch (err) { status("Load failed: " + (err?.message || err), "error"); }
    finally { setBusy(false); }
  }

  async function saveRecipients() {
    if (isBusy || !validate()) return;
    try { setBusy(true, "Saving recipients..."); const payload = await requestJson("/api/email/rework-other-report/recipients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipients }) }); recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients.map(normalizeRecipient) : []; renderTable(); status("Recipients saved to DB.", "success"); }
    catch (err) { status("Save failed: " + (err?.message || err), "error"); }
    finally { setBusy(false); }
  }

  function wireButtons() {
    const addBtn = document.getElementById("addRwReportRecipientBtn"), saveBtn = document.getElementById("saveRwReportRecipientsBtn"), reloadBtn = document.getElementById("reloadRwReportRecipientsBtn");
    if (addBtn && !addBtn.__wired) { addBtn.__wired = true; addBtn.addEventListener("click", addRecipient); }
    if (saveBtn && !saveBtn.__wired) { saveBtn.__wired = true; saveBtn.addEventListener("click", saveRecipients); }
    if (reloadBtn && !reloadBtn.__wired) { reloadBtn.__wired = true; reloadBtn.addEventListener("click", loadRecipients); }
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureUi, 1200));
  document.addEventListener("click", () => setTimeout(ensureUi, 200), true);
  setInterval(ensureUi, 1500);
})();
