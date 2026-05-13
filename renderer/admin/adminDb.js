// renderer/admin/adminDb.js
// SP WorkTrack DB Edition - Admin screen DB helper
// Keeps existing admin UI logic, then overrides DB save + adds Planned Absent tab.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const DATA_SOURCE = CONFIG.DATA_SOURCE || "local";
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", function () {
    if (DATA_SOURCE !== "db") return;

    injectAdminDbStyles();
    addPlannedAbsentTab();
    wireDbSaveButton();
    loadPlannedAbsences();
  });

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

  function buildAdminPayloadFromCurrentState() {
    const adminOverrides = getGlobalValue("adminOverrides", {}) || {};
    const machines = getGlobalValue("machines", []) || [];
    const employees = getGlobalValue("employees", []) || [];
    const shifts = getGlobalValue("shifts", []) || [];
    const machineTypes = getGlobalValue("machineTypes", []) || [];
    const workCatalogByType = getGlobalValue("workCatalogByType", {}) || {};
    const mainWorks = getGlobalValue("mainWorks", []) || [];
    const subWorksMap = getGlobalValue("subWorksMap", {}) || {};
    const lossReasons = getGlobalValue("lossReasons", []) || [];
    const rootAreas = getGlobalValue("rootAreas", []) || [];

    return {
      ...adminOverrides,
      machines,
      employees,
      shifts,
      machineTypes,
      workCatalogByType,
      mainWorks,
      subWorks: subWorksMap,
      lossReasons,
      rootAreas
    };
  }

  function wireDbSaveButton() {
    const saveBtn = $("adminSaveBtn");
    if (!saveBtn) return;

    saveBtn.onclick = async function () {
      await saveAdminMasterDataToDb();
    };

    saveBtn.textContent = "Save to DB";
    saveBtn.title = "Save admin master changes directly to PocketBase DB";
  }

  async function saveAdminMasterDataToDb() {
    const saveBtn = $("adminSaveBtn");
    const oldText = saveBtn?.textContent || "Save to DB";

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving to DB...";
      }

      const payload = buildAdminPayloadFromCurrentState();

      const res = await fetch(`${API_BASE_URL}/api/admin/save-master-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload })
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        throw new Error(body?.message || `Admin DB save failed with status ${res.status}`);
      }

      showAdminDbToast("Admin master data saved to DB ✅", "success");
      console.log("Admin DB save result:", body.data);
    } catch (err) {
      console.error(err);
      showAdminDbToast(err.message || String(err), "error");
      alert("Admin DB save failed:\n\n" + (err.message || err));
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = oldText;
      }
    }
  }

  function addPlannedAbsentTab() {
    const tabs = document.querySelector(".admin-panel .tabs");
    const panel = $("adminPanel");
    if (!tabs || !panel || $("tabPlannedAbsent")) return;

    const btn = document.createElement("button");
    btn.className = "tab";
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
        <button class="btn grey" id="refreshPlannedAbsentBtn">Refresh</button>
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
          <button class="btn green" id="savePlannedAbsentBtn">+ Save Planned Absent</button>
          <button class="btn grey" id="clearPlannedAbsentBtn">Clear</button>
        </div>
      </div>

      <div class="admin-db-card">
        <div class="row-between">
          <div>
            <div class="section-title" style="margin-bottom:4px;">Planned Absent List</div>
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
      const res = await fetch(`${API_BASE_URL}/api/admin/planned-absences`);
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        throw new Error(body?.message || `Planned absence load failed with status ${res.status}`);
      }

      const items = Array.isArray(body.items) ? body.items : [];
      if (count) count.textContent = `${items.length} Record${items.length === 1 ? "" : "s"}`;

      list.innerHTML = items.length ? items.map(renderPlannedAbsentRow).join("") : `
        <div class="planned-empty">
          <div class="planned-empty-icon">📅</div>
          <div>No planned absent records yet.</div>
          <div class="small-hint">Add one above after creating the PocketBase collection.</div>
        </div>
      `;

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
          <button class="btn red delete-planned-absent-btn" data-id="${escapeAttr(item.id || "")}">Delete</button>
        </div>
      </div>
    `;
  }

  async function savePlannedAbsence() {
    const selected = parseEmployeeOption($("plannedAbsentEmployee")?.value || "");
    const fromDate = $("plannedAbsentFrom")?.value || "";
    const toDate = $("plannedAbsentTo")?.value || fromDate;
    const reason = $("plannedAbsentReason")?.value || "";
    const remark = $("plannedAbsentRemark")?.value || "";

    try {
      if (!selected.empCode && !selected.empName) throw new Error("Select employee.");
      if (!fromDate) throw new Error("Select From Date.");

      const res = await fetch(`${API_BASE_URL}/api/admin/planned-absences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        throw new Error(body?.message || `Planned absence save failed with status ${res.status}`);
      }

      showAdminDbToast("Planned absent saved ✅", "success");
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
      const res = await fetch(`${API_BASE_URL}/api/admin/planned-absences/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        throw new Error(body?.message || `Delete failed with status ${res.status}`);
      }

      showAdminDbToast("Planned absent deleted ✅", "success");
      await loadPlannedAbsences();
    } catch (err) {
      console.error(err);
      alert("Delete failed:\n\n" + (err.message || err));
    }
  }

  function clearPlannedAbsentForm() {
    if ($("plannedAbsentEmployee")) $("plannedAbsentEmployee").value = "";
    if ($("plannedAbsentFrom")) $("plannedAbsentFrom").value = "";
    if ($("plannedAbsentTo")) $("plannedAbsentTo").value = "";
    if ($("plannedAbsentReason")) $("plannedAbsentReason").value = "";
    if ($("plannedAbsentRemark")) $("plannedAbsentRemark").value = "";
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

  function formatDate(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
    const [y, m, d] = text.split("-");
    return `${d}-${m}-${y}`;
  }

  function injectAdminDbStyles() {
    if ($("adminDbStyles")) return;

    const style = document.createElement("style");
    style.id = "adminDbStyles";
    style.textContent = `
      .admin-db-head-row { align-items:flex-start; gap:16px; }
      .admin-db-card { background:#fff; border:1px solid #e2e8f0; border-radius:22px; padding:18px; margin:16px 0; box-shadow:0 10px 26px rgba(15,23,42,.06); }
      .admin-db-actions { margin-top:12px; }
      .admin-db-pill { background:#eef2ff; color:#3730a3; border-radius:999px; padding:8px 14px; font-weight:900; }
      .planned-absent-list { margin-top:14px; display:flex; flex-direction:column; gap:10px; }
      .planned-row { display:flex; justify-content:space-between; gap:14px; align-items:center; border:1px solid #e2e8f0; border-radius:18px; padding:14px; background:linear-gradient(135deg,#ffffff,#f8fafc); }
      .planned-name { font-size:16px; color:#0f172a; font-weight:1000; }
      .planned-meta { margin-top:4px; color:#475569; font-size:13px; font-weight:800; }
      .planned-reason { margin-top:6px; color:#64748b; font-size:13px; font-weight:700; }
      .planned-row-actions { display:flex; gap:10px; align-items:center; }
      .planned-status { background:#dcfce7; color:#166534; border-radius:999px; padding:7px 12px; font-weight:1000; }
      .planned-empty { text-align:center; border:1px dashed #cbd5e1; border-radius:18px; padding:22px; color:#475569; font-weight:900; }
      .planned-empty-icon { font-size:28px; margin-bottom:8px; }
      .planned-error { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; border-radius:16px; padding:14px; font-weight:900; }
      .admin-db-toast { position:fixed; right:24px; bottom:24px; z-index:99999; background:#0f172a; color:#fff; border-radius:18px; padding:14px 18px; font-weight:1000; box-shadow:0 18px 40px rgba(15,23,42,.28); opacity:0; transform:translateY(14px); pointer-events:none; transition:.18s ease; }
      .admin-db-toast.show { opacity:1; transform:translateY(0); }
      .admin-db-toast.success { background:#166534; }
      .admin-db-toast.error { background:#991b1b; }
      .btn, .tab, .planned-row { transition:transform .15s ease, box-shadow .15s ease, filter .15s ease; }
      .btn:hover, .tab:hover { transform:translateY(-1px); filter:brightness(1.02); }
      .btn:active, .tab:active { transform:translateY(1px) scale(.98); }
      @media (max-width: 800px) { .planned-row { flex-direction:column; align-items:flex-start; } }
    `;
    document.head.appendChild(style);
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
