// renderer/overtimeReportRecipientsPatch.js
// Adds Overtime Report email recipient management below Quality/Rework report recipients.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[ch]));
  }

  function adminHeaders() {
    return {
      "Content-Type": "application/json",
      ...(window.SPWT_ADMIN_TOKEN_HEADER ? window.SPWT_ADMIN_TOKEN_HEADER() : {})
    };
  }

  async function requestJson(path, options = {}) {
    const res = await fetch(`${API_BASE_URL}${path}`, options);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(body?.message || `Request failed ${res.status}`);
    return body.data;
  }

  function status(msg, bad = false) {
    const el = $("otReportRecipientsStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = bad ? "#b91c1c" : "#15803d";
  }

  function rowHtml(r = {}, i = 0) {
    return `
      <tr>
        <td><input class="admin-input ot-name" value="${esc(r.name)}" placeholder="Name"></td>
        <td><input class="admin-input ot-email" value="${esc(r.email)}" placeholder="email@company.com"></td>
        <td><input class="admin-input ot-role" value="${esc(r.role)}" placeholder="Role"></td>
        <td>
          <select class="admin-select ot-type">
            <option value="to" ${r.type === "cc" ? "" : "selected"}>To / Main</option>
            <option value="cc" ${r.type === "cc" ? "selected" : ""}>CC</option>
          </select>
        </td>
        <td style="text-align:center;"><input class="ot-active" type="checkbox" ${r.active === false ? "" : "checked"}></td>
        <td><button class="btn grey ot-remove" type="button">Remove</button></td>
      </tr>`;
  }

  function readRows() {
    return Array.from(document.querySelectorAll("#otReportRecipientsTable tbody tr")).map((tr, i) => ({
      id: `OT${i + 1}`,
      name: tr.querySelector(".ot-name")?.value?.trim() || "",
      email: tr.querySelector(".ot-email")?.value?.trim() || "",
      role: tr.querySelector(".ot-role")?.value?.trim() || "",
      type: tr.querySelector(".ot-type")?.value || "to",
      active: !!tr.querySelector(".ot-active")?.checked
    })).filter((r) => r.email);
  }

  function renderRows(list = []) {
    const body = document.querySelector("#otReportRecipientsTable tbody");
    if (!body) return;
    body.innerHTML = (list.length ? list : [{ type: "to", active: true }]).map(rowHtml).join("");
    body.querySelectorAll(".ot-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest("tr")?.remove();
        if (!body.children.length) renderRows([]);
      });
    });
  }

  async function loadRecipients() {
    try {
      const data = await requestJson("/api/email/overtime-report/recipients");
      renderRows(data.recipients || []);
      status("Loaded");
    } catch (err) {
      console.error(err);
      status(err.message || "Load failed", true);
    }
  }

  async function saveRecipients() {
    try {
      const recipients = readRows();
      await requestJson("/api/email/overtime-report/recipients", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ recipients })
      });
      status(`Saved ${recipients.length} recipient(s)`);
    } catch (err) {
      console.error(err);
      status(err.message || "Save failed", true);
      alert("Overtime Report recipient save failed:\n\n" + (err.message || err));
    }
  }

  function mount() {
    const page = $("tabQualityReportEmails");
    if (!page || $("overtimeReportRecipientsCard")) return;

    const card = document.createElement("div");
    card.className = "card admin-controls-card";
    card.id = "overtimeReportRecipientsCard";
    card.style.marginTop = "16px";
    card.innerHTML = `
      <div class="section-title">Overtime Report Email Recipients</div>
      <div class="small-hint">Recipients used when sending Overtime Report from People Dashboard.</div>
      <div style="overflow-x:auto;margin-top:10px;">
        <table class="quality-email-table" id="otReportRecipientsTable">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th>Active</th><th>Action</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="row" style="margin-top:12px;">
        <button class="btn grey" id="addOtReportRecipientBtn" type="button">+ Add Recipient</button>
        <button class="btn green" id="saveOtReportRecipientsBtn" type="button">Save Overtime Recipients</button>
        <button class="btn grey" id="reloadOtReportRecipientsBtn" type="button">Reload</button>
        <span class="small-hint" id="otReportRecipientsStatus"></span>
      </div>`;

    page.appendChild(card);

    $("addOtReportRecipientBtn")?.addEventListener("click", () => {
      const body = document.querySelector("#otReportRecipientsTable tbody");
      if (!body) return;
      body.insertAdjacentHTML("beforeend", rowHtml({ type: "cc", active: true }, body.children.length));
      body.lastElementChild?.querySelector(".ot-remove")?.addEventListener("click", (e) => e.target.closest("tr")?.remove());
    });
    $("saveOtReportRecipientsBtn")?.addEventListener("click", saveRecipients);
    $("reloadOtReportRecipientsBtn")?.addEventListener("click", loadRecipients);

    loadRecipients();
  }

    function boot() {
    mount();
    let tries = 0;
    const timer = setInterval(() => {
      mount();
      tries += 1;
      if ($("overtimeReportRecipientsCard") || tries >= 30) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

