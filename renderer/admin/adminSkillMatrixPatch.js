// renderer/admin/adminSkillMatrixPatch.js
// Admin -> Skill Matrix UI for multi-skill and future capacity planning.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 20000;
  let master = null;
  let skills = [];

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function slug(value) { return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { ...(options.headers || {}) };
      const token = window.SPWT_ADMIN_ACCESS?.getToken?.() || localStorage.getItem("spwt_admin_token") || "";
      if (token) headers["x-spwt-admin-token"] = token;
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } finally { clearTimeout(timer); }
  }

  function setStatus(message, type = "") {
    const el = $("skillMatrixStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = "900";
  }

  function option(value, label, selected) {
    return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
  }

  function employeeByCode(code) {
    return (master?.employees || []).find(e => clean(e.empId) === clean(code)) || null;
  }

  function typeByCode(code) {
    return (master?.machineTypes || []).find(t => clean(t.id) === clean(code)) || null;
  }

  function departmentsForType(typeCode) {
    const cat = master?.workCatalogByType?.[typeCode] || {};
    return Array.isArray(cat.mainWorks) ? cat.mainWorks : [];
  }

  function subworksFor(typeCode, deptName) {
    const cat = master?.workCatalogByType?.[typeCode] || {};
    const list = cat.subWorks?.[deptName] || [];
    return Array.isArray(list) ? list : [];
  }

  function addStyles() {
    if ($("skillMatrixStyles")) return;
    const st = document.createElement("style");
    st.id = "skillMatrixStyles";
    st.textContent = `
      .skill-matrix-card{background:#fff;border:1px solid #d8e2ef;border-radius:14px;padding:14px;margin-top:12px;box-shadow:0 8px 22px rgba(15,23,42,.06)}
      .skill-grid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px}.skill-grid-2{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:10px}
      .skill-checklist{max-height:210px;overflow:auto;border:1px solid #d8e2ef;border-radius:12px;padding:8px;background:#f8fafc}.skill-check-row{display:flex;gap:8px;align-items:flex-start;padding:7px;border-bottom:1px solid #e5edf6}.skill-check-row:last-child{border-bottom:0}.skill-check-row input{margin-top:2px}.skill-check-row b{color:#0f172a}.skill-check-row small{color:#64748b;font-weight:800}
      .skill-metrics{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:8px;margin:10px 0}.skill-metric{border:1px solid #d8e2ef;border-radius:12px;padding:9px;background:#f8fafc}.skill-metric span{font-size:11px;color:#64748b;font-weight:900;text-transform:uppercase}.skill-metric strong{display:block;font-size:20px;color:#0b3f73;margin-top:2px}
      .skill-list-table td,.skill-list-table th{font-size:12px}.skill-level-pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:900;background:#eaf2ff;color:#0b3f73}.skill-on{color:#15803d;font-weight:900}.skill-off{color:#64748b;font-weight:900}
      @media(max-width:1100px){.skill-grid,.skill-grid-2,.skill-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.skill-grid,.skill-grid-2,.skill-metrics{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  function ensureUi() {
    const panel = $("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return false;
    if (!tabs.querySelector('[data-tab="tabSkillMatrix"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.dataset.tab = "tabSkillMatrix";
      btn.textContent = "Skill Matrix";
      const workTab = tabs.querySelector('[data-tab="tabWork"]');
      if (workTab) workTab.insertAdjacentElement("afterend", btn);
      else tabs.appendChild(btn);
    }
    if (!$("tabSkillMatrix")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabSkillMatrix";
      page.innerHTML = `
        <div class="section-title">Skill Matrix</div>
        <div class="small-hint">Employee multi-skill master for future capacity planning. Select employee, machine type, department/main work and multiple sub works.</div>
        <div class="skill-matrix-card">
          <div class="skill-grid">
            <div class="field"><label>Employee</label><select id="skillEmpSelect" class="admin-select"></select><div class="small-hint" id="skillEmpDeptHint"></div></div>
            <div class="field"><label>Machine Type</label><select id="skillTypeSelect" class="admin-select"></select></div>
            <div class="field"><label>Skill Department / Main Work</label><select id="skillDeptSelect" class="admin-select"></select></div>
          </div>
          <div class="skill-grid" style="margin-top:10px;">
            <div class="field"><label>Skill Level</label><select id="skillLevelSelect" class="admin-select"><option value="1">1 - Helper</option><option value="2">2 - Under Supervision</option><option value="3" selected>3 - Independent</option><option value="4">4 - Expert / Trainer</option></select></div>
            <div class="field"><label>Efficiency %</label><input id="skillEfficiencyInput" class="admin-input" type="number" min="0" max="150" step="5" value="100" /></div>
            <div class="field"><label>Remarks</label><input id="skillRemarksInput" class="admin-input" placeholder="Training note / limitation" /></div>
          </div>
          <div class="skill-grid-2" style="margin-top:8px;">
            <label class="quality-recheck-line"><input id="skillIndependentInput" type="checkbox" checked /> Can work independently</label>
            <label class="quality-recheck-line"><input id="skillTrainerInput" type="checkbox" /> Can train others</label>
          </div>
          <div class="field" style="margin-top:10px;"><label>Sub Work Checklist</label><div id="skillSubworkChecklist" class="skill-checklist"></div></div>
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;"><button class="btn green" id="saveSkillMatrixBtn" type="button">Add Selected Skills</button><button class="btn grey" id="refreshSkillMatrixBtn" type="button">Refresh</button><span class="small-hint" id="skillMatrixStatus"></span></div>
        </div>
        <div class="skill-matrix-card">
          <div class="row-between" style="gap:10px;flex-wrap:wrap;"><div><div class="section-title" style="font-size:18px;">Skill Coverage Summary</div><div class="small-hint">Active skill records saved for capacity planning.</div></div><div class="row" style="gap:8px;flex-wrap:wrap;"><select id="skillFilterEmp" class="admin-select"><option value="">All Employees</option></select><select id="skillFilterType" class="admin-select"><option value="">All Machine Types</option></select><select id="skillFilterDept" class="admin-select"><option value="">All Departments</option></select></div></div>
          <div class="skill-metrics" id="skillSummaryMetrics"></div>
          <div class="table-wrap"><table class="admin-table skill-list-table"><thead><tr><th>Employee</th><th>Home Dept</th><th>Machine Type</th><th>Skill Dept</th><th>Sub Work</th><th>Level</th><th>Eff %</th><th>Independent</th><th>Trainer</th><th>Action</th></tr></thead><tbody id="skillMatrixBody"></tbody></table></div>
        </div>`;
      const footer = panel.querySelector("hr") || panel.lastElementChild;
      if (footer) panel.insertBefore(page, footer); else panel.appendChild(page);
    }
    wire();
    return true;
  }

  function fillSelectors() {
    const empOptions = [`<option value="">Select employee</option>`, ...(master?.employees || []).filter(e => e.active !== false).map(e => option(e.empId, `${e.empId} - ${e.name} (${e.department || "No Dept"})`))].join("");
    const typeOptions = [`<option value="">Select machine type</option>`, ...(master?.machineTypes || []).map(t => option(t.id, t.name || t.id))].join("");
    if ($("skillEmpSelect")) $("skillEmpSelect").innerHTML = empOptions;
    if ($("skillTypeSelect")) $("skillTypeSelect").innerHTML = typeOptions;
    if ($("skillFilterEmp")) $("skillFilterEmp").innerHTML = `<option value="">All Employees</option>${(master?.employees || []).map(e => option(e.empId, `${e.empId} - ${e.name}`)).join("")}`;
    if ($("skillFilterType")) $("skillFilterType").innerHTML = `<option value="">All Machine Types</option>${(master?.machineTypes || []).map(t => option(t.id, t.name || t.id)).join("")}`;
    updateEmployeeHint();
    updateDepartments();
  }

  function updateEmployeeHint() {
    const emp = employeeByCode($("skillEmpSelect")?.value);
    if ($("skillEmpDeptHint")) $("skillEmpDeptHint").textContent = emp ? `Home Department: ${emp.department || "-"}` : "";
  }

  function updateDepartments() {
    const typeCode = clean($("skillTypeSelect")?.value);
    const depts = departmentsForType(typeCode);
    if ($("skillDeptSelect")) $("skillDeptSelect").innerHTML = [`<option value="">Select department/main work</option>`, ...depts.map(d => option(d, d))].join("");
    updateSubworks();
  }

  function updateSubworks() {
    const host = $("skillSubworkChecklist");
    if (!host) return;
    const typeCode = clean($("skillTypeSelect")?.value);
    const dept = clean($("skillDeptSelect")?.value);
    const subworks = subworksFor(typeCode, dept);
    host.innerHTML = subworks.length ? subworks.map((sw, idx) => `
      <label class="skill-check-row"><input type="checkbox" data-skill-subwork="${esc(sw.name)}" checked /><span><b>${esc(sw.name)}</b><br><small>Std: ${esc(sw.standardTime || 0)} min</small></span></label>
    `).join("") : `<div class="small-hint">Select machine type and department to load sub works.</div>`;
  }

  function renderSummary(summary = {}) {
    const host = $("skillSummaryMetrics");
    if (!host) return;
    const items = [
      ["Active Skills", summary.activeSkills || 0], ["Employees", summary.employees || 0], ["Departments", summary.departments || 0],
      ["Sub Works", summary.subworks || 0], ["Avg Efficiency", `${summary.avgEfficiency || 0}%`], ["Trainers", summary.trainers || 0]
    ];
    host.innerHTML = items.map(([label, value]) => `<div class="skill-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
  }

  function renderList() {
    const empFilter = clean($("skillFilterEmp")?.value);
    const typeFilter = clean($("skillFilterType")?.value);
    const deptFilter = clean($("skillFilterDept")?.value);
    const rows = skills.filter(r => (!empFilter || r.emp_code === empFilter) && (!typeFilter || r.machine_type_code === typeFilter) && (!deptFilter || r.skill_department_name === deptFilter));
    const body = $("skillMatrixBody");
    if (!body) return;
    body.innerHTML = rows.length ? rows.map(r => `<tr><td>${esc(r.emp_code)} - ${esc(r.emp_name)}</td><td>${esc(r.employee_department || "-")}</td><td>${esc(r.machine_type_name || r.machine_type_code)}</td><td>${esc(r.skill_department_name)}</td><td>${esc(r.subwork_name)}</td><td><span class="skill-level-pill">L${esc(r.skill_level)}</span></td><td>${esc(r.efficiency_pct)}%</td><td class="${r.can_work_independently ? "skill-on" : "skill-off"}">${r.can_work_independently ? "Yes" : "No"}</td><td class="${r.can_train_others ? "skill-on" : "skill-off"}">${r.can_train_others ? "Yes" : "No"}</td><td><button class="btn red" data-skill-delete="${esc(r.id)}" type="button">Delete</button></td></tr>`).join("") : `<tr><td colspan="10">No skill records found.</td></tr>`;
    body.querySelectorAll("[data-skill-delete]").forEach(btn => btn.onclick = () => deleteSkill(btn.dataset.skillDelete));
    const depts = Array.from(new Set(skills.map(r => r.skill_department_name).filter(Boolean))).sort();
    if ($("skillFilterDept")) $("skillFilterDept").innerHTML = `<option value="">All Departments</option>${depts.map(d => option(d, d, d === deptFilter)).join("")}`;
  }

  async function loadAll() {
    setStatus("Loading skill matrix...");
    const [masterData, skillData] = await Promise.all([
      requestJson("/api/admin/master-data"),
      requestJson("/api/admin/skill-matrix")
    ]);
    master = masterData;
    skills = Array.isArray(skillData.records) ? skillData.records : [];
    fillSelectors();
    renderSummary(skillData.summary || {});
    renderList();
    setStatus("Skill matrix loaded.", "success");
  }

  function selectedRecords() {
    const emp = employeeByCode($("skillEmpSelect")?.value);
    const type = typeByCode($("skillTypeSelect")?.value);
    const dept = clean($("skillDeptSelect")?.value);
    const checked = Array.from(document.querySelectorAll("[data-skill-subwork]:checked")).map(x => x.dataset.skillSubwork).filter(Boolean);
    if (!emp) throw new Error("Select employee first.");
    if (!type) throw new Error("Select machine type first.");
    if (!dept) throw new Error("Select skill department/main work first.");
    if (!checked.length) throw new Error("Select at least one sub work.");
    return checked.map(subworkName => ({
      emp_code: emp.empId,
      emp_name: emp.name,
      employee_department: emp.department || "",
      machine_type_code: type.id,
      machine_type_name: type.name || type.id,
      skill_department_code: slug(dept),
      skill_department_name: dept,
      subwork_code: slug(subworkName),
      subwork_name: subworkName,
      skill_level: num($("skillLevelSelect")?.value, 3),
      efficiency_pct: num($("skillEfficiencyInput")?.value, 100),
      can_work_independently: $("skillIndependentInput")?.checked === true,
      can_train_others: $("skillTrainerInput")?.checked === true,
      remarks: $("skillRemarksInput")?.value || ""
    }));
  }

  async function saveSkills() {
    try {
      const records = selectedRecords();
      setStatus("Saving skill matrix...");
      const data = await requestJson("/api/admin/skill-matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records })
      });
      skills = Array.isArray(data.records) ? data.records : skills;
      renderSummary(data.summary || {});
      await loadAll();
      setStatus(`Saved. Created: ${data.created || 0}, Updated: ${data.updated || 0}`, "success");
    } catch (err) { setStatus(err?.message || String(err), "error"); alert(err?.message || String(err)); }
  }

  async function deleteSkill(id) {
    if (!confirm("Delete this skill record?")) return;
    try {
      setStatus("Deleting skill...");
      await requestJson(`/api/admin/skill-matrix/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadAll();
      setStatus("Skill deleted.", "success");
    } catch (err) { setStatus(err?.message || String(err), "error"); alert(err?.message || String(err)); }
  }

  function wire() {
    const map = [
      ["skillEmpSelect", "change", updateEmployeeHint], ["skillTypeSelect", "change", updateDepartments], ["skillDeptSelect", "change", updateSubworks],
      ["saveSkillMatrixBtn", "click", saveSkills], ["refreshSkillMatrixBtn", "click", loadAll],
      ["skillFilterEmp", "change", renderList], ["skillFilterType", "change", renderList], ["skillFilterDept", "change", renderList]
    ];
    map.forEach(([id, ev, fn]) => { const el = $(id); if (el && !el.__skillWired) { el.__skillWired = true; el.addEventListener(ev, fn); } });
  }

  function showTab() {
    ensureUi();
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabSkillMatrix"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    $("tabSkillMatrix")?.classList.remove("hidden");
    loadAll().catch(err => setStatus(err?.message || String(err), "error"));
  }

  function init() { addStyles(); ensureUi(); }
  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.('[data-tab="tabSkillMatrix"]')) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); showTab();
  }, true);
  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 900));
  setInterval(init, 1500);
})();
