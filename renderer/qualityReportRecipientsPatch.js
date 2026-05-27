// renderer/qualityReportRecipientsPatch.js
// Adds Quality Report Emails tab in Admin Settings.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let loaded = false;
  let recipients = [];
  let eventsWired = false;

  function apiBaseUrl() {
    return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function status(message, type = "") {
    const el = document.getElementById("qualityReportRecipientsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
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
        <div class="small-hint">Active recipients will receive Quality Report emails from the Machine Dashboard.</div>

        <div class="card admin-controls-card">
          <div class="grid-2">
            <div class="field">
              <label>Recipient Name</label>
              <input id="qrRecipientName" class="admin-input" type="text" placeholder="Example: Quality Head" />
            </div>
            <div class="field">
              <label>Email ID</label>
              <input id="qrRecipientEmail" class="admin-input" type="email" placeholder="quality@sopan.co.in" />
            </div>
            <div class="field">
              <label>Role / Department</label>
              <input id="qrRecipientRole" class="admin-input" type="text" placeholder="Quality / Production / Assembly" />
            </div>
            <div class="field">
              <label class="quality-recheck-line">
                <input id="qrRecipientActive" type="checkbox" checked /> Active
              </label>
            </div>
          </div>

          <div class="row admin-controls-actions" style="gap:8px; flex-wrap:wrap;">
            <button class="btn orange" id="addQualityReportRecipientBtn" type="button">+ Add Recipient</button>
            <button class="btn green" id="saveQualityReportRecipientsBtn" type="button">Save Recipients</button>
            <span class="small-hint" id="qualityReportRecipientsStatus"></span>
          </div>

          <div class="sum-table-wrap" style="margin-top:12px;">
            <div class="sum-table-title">Active / Inactive Recipient List</div>
            <div class="sum-table" id="qualityReportRecipientsTable"></div>
          </div>
        </div>
      `;
      const hr = panel.querySelector("hr");
      if (hr) panel.insertBefore(page, hr);
      else panel.appendChild(page);
    }
  }

  function renderTable() {
    const host = document.getElementById("qualityReportRecipientsTable");
    if (!host) return;

    if (!recipients.length) {
      host.innerHTML = `<div class="small-hint">No recipients added yet.</div>`;
      return;
    }

    host.innerHTML = `
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px;">Name</th>
            <th style="text-align:left; padding:6px;">Email</th>
            <th style="text-align:left; padding:6px;">Role</th>
            <th style="text-align:center; padding:6px;">Active</th>
            <th style="text-align:center; padding:6px;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${recipients.map((r, idx) => `
            <tr>
              <td style="padding:6px;"><input class="admin-input qr-name" data-index="${idx}" value="${esc(r.name)}" /></td>
              <td style="padding:6px;"><input class="admin-input qr-email" data-index="${idx}" value="${esc(r.email)}" /></td>
              <td style="padding:6px;"><input class="admin-input qr-role" data-index="${idx}" value="${esc(r.role)}" /></td>
              <td style="text-align:center; padding:6px;"><input class="qr-active" data-index="${idx}" type="checkbox" ${r.active !== false ? "checked" : ""} /></td>
              <td style="text-align:center; padding:6px;"><button class="btn grey qr-delete" data-index="${idx}" type="button">Delete</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    host.querySelectorAll("input").forEach(input => input.addEventListener("change", readTableBack));
    host.querySelectorAll(".qr-delete").forEach(btn => btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      recipients.splice(idx, 1);
      renderTable();
    }));
  }

  function readTableBack() {
    document.querySelectorAll(".qr-name").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].name = input.value.trim(); });
    document.querySelectorAll(".qr-email").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].email = input.value.trim(); });
    document.querySelectorAll(".qr-role").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].role = input.value.trim(); });
    document.querySelectorAll(".qr-active").forEach(input => { if (recipients[input.dataset.index]) recipients[input.dataset.index].active = input.checked; });
  }

  async function loadRecipients(force = false) {
    if (loaded && !force) return;
    status("Loading recipients...");
    const payload = await requestJson("/api/email/quality-report/recipients", { method: "GET" });
    recipients = Array.isArray(payload.data?.recipients) ? payload.data.recipients : [];
    loaded = true;
    renderTable();
    status("Recipients loaded.");
  }

  function addRecipient() {
    const name = document.getElementById("qrRecipientName")?.value.trim() || "";
    const email = document.getElementById("qrRecipientEmail")?.value.trim() || "";
    const role = document.getElementById("qrRecipientRole")?.value.trim() || "";
    const active = document.getElementById("qrRecipientActive")?.checked !== false;

    if (!email) {
      alert("Email ID is required.");
      return;
    }

    recipients.push({ id: `R${Date.now()}`, name, email, role, active });
    document.getElementById("qrRecipientName").value = "";
    document.getElementById("qrRecipientEmail").value = "";
    document.getElementById("qrRecipientRole").value = "";
    renderTable();
  }

  async function saveRecipients() {
    try {
      readTableBack();
      status("Saving recipients...");
      await requestJson("/api/email/quality-report/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients })
      });
      status("Recipients saved.", "success");
    } catch (err) {
      status("Save failed: " + (err?.message || err), "error");
      alert("Save recipients failed: " + (err?.message || err));
    }
  }

  function wireButtons() {
    const addBtn = document.getElementById("addQualityReportRecipientBtn");
    const saveBtn = document.getElementById("saveQualityReportRecipientsBtn");
    if (addBtn && !addBtn.__wired) { addBtn.__wired = true; addBtn.onclick = addRecipient; }
    if (saveBtn && !saveBtn.__wired) { saveBtn.__wired = true; saveBtn.onclick = saveRecipients; }
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
    try { await loadRecipients(true); }
    catch (err) { status("Load failed: " + (err?.message || err), "error"); }
  }

  function patchSwitchAdminTab() {
    const original = window.switchAdminTab;
    if (typeof original !== "function" || original.__spwtQrEmailPatched) return;
    const patched = function (tabId) {
      if (tabId === "tabQualityReportEmails") { showTab(); return; }
      return original.apply(this, arguments);
    };
    patched.__spwtQrEmailPatched = true;
    window.switchAdminTab = patched;
  }

  function wireEventsOnce() {
    if (eventsWired) return;
    eventsWired = true;
    document.addEventListener("click", (e) => {
      if (e.target?.closest?.('[data-tab="tabQualityReportEmails"]')) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(showTab, 0);
      }
      setTimeout(wireButtons, 0);
    }, true);
  }

  function init() {
    ensureTab();
    patchSwitchAdminTab();
    wireButtons();
    wireEventsOnce();
  }

  window.SPWT_RENDER_QR_EMAIL_RECIPIENTS = renderTab;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
