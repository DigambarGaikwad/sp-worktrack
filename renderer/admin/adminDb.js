// renderer/admin/adminDb.js
// SP WorkTrack DB Edition - Admin page helper.
// Scope: Planned Absent tab only. Master-data DB save is handled by adminDbPatch.js.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const DATA_SOURCE = CONFIG.DATA_SOURCE || "local";
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;

  const $ = (id) => document.getElementById(id);
  let plannedAbsenceItems = [];
  let editingPlannedAbsenceId = "";

  document.addEventListener("DOMContentLoaded", function () {
    if (DATA_SOURCE !== "db") return;
    addPlannedAbsentTab();
    loadPlannedAbsences();
  });

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        signal: controller.signal
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `Request failed ${res.status}`);
      return body;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timeout. Check server is running.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function getGlobalValue(name, fallback) {
    try {
      // app.js uses top-level let variables. Direct eval reads the shared global lexical binding.
      // eslint-disable-next-line no-eval
      const value = eval(name);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function addPlannedAbsentTab() {
    const tabs = document.querySelector(".admin-panel .tabs");
    const panel = $("adminPanel");
    if (!tabs || !panel || $("tabPlannedAbsent")) return;

    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.dataset.tab = "tabPlannedAbsent";
    btn.textContent = "Planned Absent";
    tabs.insertBefore(btn, tabs.querySelector('[data-tab="tabPin"]') || null);

    const page = document.createElement("div");
    page.className = "tab-page hidden";
    page.id = "tabPlannedAbsent";
    page.innerHTML = `
      <div class="row-between admin-db-head-row">
        <div>
          <div class="section-title">Planned Absent</div>
          <div class="small-hint">Plan approved leave/absence so People Dashboard can separate planned and unplanned absence later.</div>
        </div>
        <button class="btn grey" id="refreshPlannedAbsentBtn" type="button">Refresh</button>
      </div>

      <div class="admin-db-card">
        <div class="grid-2">
          <div class="field">
            <label>Employee</label>
            <select id="plannedAbsentEmployee" class="admin-select"></select>
          </div>
          <div class="field">
            <label>Reason</label>
            <input id="plannedAbsentReason" type="text" placeholder="Leave, Weekly off, Training, Site visit..." />
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label>From Date</label>
            <input id="plannedAbsentFrom" type="date" />
          </div>
          <div class="field">
            <label>To Date</label>
            <input id="plannedAbsentTo" type="date" />
          </div>
        </div>

        <div class="field">
          <label>Remark</label>
          <input id="plannedAbsentRemark" type="text" placeholder="Optional note" />
        </div>

        <div class="row admin-db-actions">
          <button class="btn green" id="savePlannedAbsentBtn" type="button">+ Save Planned Absent</button>
          <button class="btn grey" id="clearPlannedAbsentBtn" type="button">Clear</button>
        </div>
      </div>

      <div class="admin-db-card">
        <div class="row-between">
          <div>
            <div class="section-title planned-list-title">Planned Absent List</div>
            <div class="small-hint">Records are stored in PocketBase collection <b>planned_absences</b>.</div>
          </div>
          <div class="admin-db-pill" id="plannedAbsentCount">0 Records</div>
        </div>
        <div id="plannedAbsentList" class="planned-absent-list"></div>
      </div>
    `;

    const pinPage = $("tabPin");
    if (pinPage) panel.insertBefore(page, pinPage);
    else panel.appendChild(page);

    btn.onclick = function () {
      switchAdminTabSafe("tabPlannedAbsent");
      populatePlannedAbsentEmployeeSelect();
      loadPlannedAbsences();
    };

    $("refreshPlannedAbsentBtn")?.addEventListener("click", loadPlannedAbsences);
    $("savePlannedAbsentBtn")?.addEventListener("click", savePlannedAbsence);
    $("clearPlannedAbsentBtn")?.addEventListener("click", clearPlannedAbsentForm);

    populatePlannedAbsentEmployeeSelect();
  }

  function switchAdminTabSafe(tabId) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("hidden", p.id !== tabId));
  }

  function getEmployeesForPlannedAbsence() {
    return (getGlobalValue("employees", []) || [])
      .filter((e) => e && e.active !== false)
      .map((e) => ({
        empCode: String(e.empId || e.emp_code || e.code || "").trim(),
        empName: String(e.name || e.full_name || e.emp_name || "").trim(),
        department: String(e.department || "").trim()
      }))
      .filter((e) => e.empCode || e.empName)
      .sort((a, b) => (a.empName || a.empCode).localeCompare(b.empName || b.empCode));
  }

  function plannedEmployeeValue(item = {}) {
    return `${cleanForValue(item.emp_code || item.empCode)}|${cleanForValue(item.emp_name || item.empName)}|${cleanForValue(item.department)}`;
  }

  function populatePlannedAbsentEmployeeSelect() {
    const select = $("plannedAbsentEmployee");
    if (!select) return;

    const current = select.value;
    const employees = getEmployeesForPlannedAbsence();

    select.innerHTML = `<option value="">Select Employee</option>` + employees.map((e) => {
      const value = `${escapeAttr(e.empCode)}|${escapeAttr(e.empName)}|${escapeAttr(e.department)}`;
      const label = `${e.empCode ? e.empCode + " - " : ""}${e.empName || "Unknown"}${e.department ? " (" + e.department + ")" : ""}`;
      return `<option value="${value}">${escapeHtml(label)}</option>`;
    }).join("");

    if (current) select.value = current;
  }

  function ensurePlannedEmployeeOption(item = {}) {
    const select = $("plannedAbsentEmployee");
    if (!select) return;

    const value = plannedEmployeeValue(item);
    if (!value.replace(/\|/g, "")) return;

    const exists = Array.from(select.options).some((option) => option.value === value);
    if (!exists) {
      const code = cleanForValue(item.emp_code || item.empCode);
      const name = cleanForValue(item.emp_name || item.empName);
      const dept = cleanForValue(item.department);
      const label = `${code ? code + " - " : ""}${name || "Unknown"}${dept ? " (" + dept + ")" : ""}`;
      select.insertAdjacentHTML("beforeend", `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`);
    }

    select.value = value;
  }

  function parseEmployeeOption(value) {
    const [empCode, empName, department] = String(value || "").split("|");
    return { empCode: empCode || "", empName: empName || "", department: department || "" };
  }

  async function loadPlannedAbsences() {
    const list = $("plannedAbsentList");
    const count = $("plannedAbsentCount");
    if (!list) return;

    list.innerHTML = `<div class="small-hint">Loading planned absences...</div>`;

    try {
      const body = await requestJson("/api/admin/planned-absences", { method: "GET" });
      const items = Array.isArray(body.items) ? body.items : [];
      plannedAbsenceItems = items;
      if (count) count.textContent = `${items.length} Record${items.length === 1 ? "" : "s"}`;

      list.innerHTML = items.length ? items.map(renderPlannedAbsentRow).join("") : `
        <div class="planned-empty">
          <div class="planned-empty-icon">📅</div>
          <div>No planned absent records yet.</div>
          <div class="small-hint">Add one above after creating the PocketBase collection.</div>
        </div>
      `;

      list.querySelectorAll(".edit-planned-absent-btn").forEach((btn) => {
        btn.onclick = function () {
          editPlannedAbsence(btn.dataset.id);
        };
      });

      list.querySelectorAll(".delete-planned-absent-btn").forEach((btn) => {
        btn.onclick = async function () {
          await deletePlannedAbsence(btn.dataset.id);
        };
      });
    } catch (err) {
      console.error(err);
      list.innerHTML = `<div class="planned-error">${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  function renderPlannedAbsentRow(item) {
    const dateText = item.from_date === item.to_date
      ? formatDate(item.from_date)
      : `${formatDate(item.from_date)} → ${formatDate(item.to_date)}`;

    return `
      <div class="planned-row">
        <div>
          <div class="planned-name">${escapeHtml(item.emp_name || item.emp_code || "-")}</div>
          <div class="planned-meta">${escapeHtml(item.emp_code || "")} • ${escapeHtml(item.department || "-")} • ${escapeHtml(dateText)}</div>
          <div class="planned-reason">${escapeHtml(item.reason || "-")}${item.remark ? " — " + escapeHtml(item.remark) : ""}</div>
        </div>
        <div class="planned-row-actions">
          <span class="planned-status">${escapeHtml(item.status || "Planned")}</span>
          <button class="btn grey edit-planned-absent-btn" type="button" data-id="${escapeAttr(item.id || "")}">Edit</button>
          <button class="btn red delete-planned-absent-btn" type="button" data-id="${escapeAttr(item.id || "")}">Delete</button>
        </div>
      </div>
    `;
  }

  function editPlannedAbsence(id) {
    const item = plannedAbsenceItems.find((row) => String(row.id || "") === String(id || ""));
    if (!item?.id) {
      showAdminDbToast("Planned absent record not found. Refresh and try again.", "error");
      return;
    }

    populatePlannedAbsentEmployeeSelect();
    ensurePlannedEmployeeOption(item);

    editingPlannedAbsenceId = item.id;
    if ($("plannedAbsentFrom")) $("plannedAbsentFrom").value = item.from_date || "";
    if ($("plannedAbsentTo")) $("plannedAbsentTo").value = item.to_date || item.from_date || "";
    if ($("plannedAbsentReason")) $("plannedAbsentReason").value = item.reason || "";
    if ($("plannedAbsentRemark")) $("plannedAbsentRemark").value = item.remark || "";

    const saveBtn = $("savePlannedAbsentBtn");
    if (saveBtn) saveBtn.textContent = "Update Planned Absent";
    showAdminDbToast("Editing planned absent record. Change details and click Update.", "success");
    $("plannedAbsentEmployee")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function savePlannedAbsence() {
    const selected = parseEmployeeOption($("plannedAbsentEmployee")?.value || "");
    const fromDate = $("plannedAbsentFrom")?.value || "";
    const toDate = $("plannedAbsentTo")?.value || fromDate;
    const reason = $("plannedAbsentReason")?.value || "";
    const remark = $("plannedAbsentRemark")?.value || "";
    const isUpdate = Boolean(editingPlannedAbsenceId);

    try {
      if (!selected.empCode && !selected.empName) throw new Error("Select employee.");
      if (!fromDate) throw new Error("Select From Date.");

      await requestJson("/api/admin/planned-absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingPlannedAbsenceId || undefined,
          empCode: selected.empCode,
          empName: selected.empName,
          department: selected.department,
          fromDate,
          toDate: toDate || fromDate,
          reason,
          remark,
          status: "Planned"
        })
      });

      showAdminDbToast(isUpdate ? "Planned absent updated ✅" : "Planned absent saved ✅", "success");
      clearPlannedAbsentForm();
      await loadPlannedAbsences();
    } catch (err) {
      console.error(err);
      showAdminDbToast(err.message || String(err), "error");
      alert("Planned absent save failed:\n\n" + (err.message || err));
    }
  }

  async function deletePlannedAbsence(id) {
    if (!id) return;
    if (!confirm("Delete this planned absent record?")) return;

    try {
      await requestJson(`/api/admin/planned-absences/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editingPlannedAbsenceId === id) clearPlannedAbsentForm();
      showAdminDbToast("Planned absent deleted ✅", "success");
      await loadPlannedAbsences();
    } catch (err) {
      console.error(err);
      alert("Delete failed:\n\n" + (err.message || err));
    }
  }

  function clearPlannedAbsentForm() {
    editingPlannedAbsenceId = "";
    if ($("plannedAbsentEmployee")) $("plannedAbsentEmployee").value = "";
    if ($("plannedAbsentFrom")) $("plannedAbsentFrom").value = "";
    if ($("plannedAbsentTo")) $("plannedAbsentTo").value = "";
    if ($("plannedAbsentReason")) $("plannedAbsentReason").value = "";
    if ($("plannedAbsentRemark")) $("plannedAbsentRemark").value = "";

    const saveBtn = $("savePlannedAbsentBtn");
    if (saveBtn) saveBtn.textContent = "+ Save Planned Absent";
  }

  function showAdminDbToast(message, type) {
    let toast = $("adminDbToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "adminDbToast";
      toast.className = "admin-db-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `admin-db-toast show ${type || ""}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function cleanForValue(value) {
    return String(value ?? "").trim();
  }

  function formatDate(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
    const [y, m, d] = text.split("-");
    return `${d}-${m}-${y}`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
