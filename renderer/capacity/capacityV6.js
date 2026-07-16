// renderer/capacity/capacityV6.js
// Capacity Planning V6: focus invalid fields and allow employee department priorities P1/P2/P3.
(function () {
  const API = window.SPWT_CONFIG?.API_BASE_URL || window.location.origin || "http://localhost:3032";
  const PRIORITY_KEY = "spwt_capacity_dept_priorities_v1";
  const PLAN_KEY = "spwt_capacity_plan_v4";
  const $ = (id) => document.getElementById(id);

  const state = { master: {}, skills: [], priorities: {}, loaded: false };

  const clean = (v) => String(v ?? "").trim();
  const key = (v) => clean(v).toLowerCase();
  const esc = (v) => clean(v).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

  function injectStyles() {
    if ($("capacityV6Style")) return;
    const style = document.createElement("style");
    style.id = "capacityV6Style";
    style.textContent = `
      .cap-error-field { border: 2px solid #dc2626 !important; background: #fff7f7 !important; box-shadow: 0 0 0 3px rgba(220,38,38,.12) !important; }
      .dept-priority-panel { margin-top: 14px; }
      .dept-priority-actions { display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; margin:10px 0 12px; }
      .dept-priority-note { color:#64748b; font-size:12px; font-weight:800; line-height:1.45; }
      .dept-priority-select { min-width:160px; }
      .dept-priority-status { color:#64748b; font-size:12px; font-weight:850; }
      .dept-priority-badge { display:inline-flex; align-items:center; border-radius:999px; padding:3px 8px; font-size:11px; font-weight:900; background:#eaf2ff; color:#0b3f73; margin:2px; }
      .dept-priority-badge.p1 { background:#dcfce7; color:#166534; }
      .dept-priority-badge.p2 { background:#eff6ff; color:#1d4ed8; }
      .dept-priority-badge.p3 { background:#fff7ed; color:#9a3412; }
      .dept-priority-badge.none { background:#fef2f2; color:#b91c1c; }
      @media (max-width: 760px) { .dept-priority-select { min-width: 130px; } }
    `;
    document.head.appendChild(style);
  }

  async function requestJson(path) {
    const res = await fetch(`${API}${path}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.message || `API error ${res.status}`);
    return payload.data;
  }

  function activeEmployees() {
    return (state.master.employees || []).filter((e) => e.active !== false && clean(e.empId));
  }

  function allDepartments() {
    const set = new Set();
    (state.master.machineTypes || []).forEach((t) => {
      const cat = state.master.workCatalogByType?.[t.id] || {};
      (cat.mainWorks || []).forEach((d) => { if (clean(d)) set.add(clean(d)); });
    });
    state.skills.forEach((s) => {
      const dept = clean(s.skill_department_name || s.department_name);
      if (dept) set.add(dept);
    });
    activeEmployees().forEach((e) => { if (clean(e.department)) set.add(clean(e.department)); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  function loadPriorities() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRIORITY_KEY) || "{}");
      state.priorities = raw && typeof raw === "object" ? raw : {};
    } catch {
      state.priorities = {};
    }
  }

  function deptScores(empId) {
    const map = new Map();
    state.skills.forEach((s) => {
      if (key(s.emp_code || s.empCode) !== key(empId)) return;
      const dept = clean(s.skill_department_name || s.department_name);
      if (!dept) return;
      const score = Math.max(1, num(s.history_count, 0)) + (num(s.history_standard_minutes, 0) / 60);
      map.set(dept, num(map.get(dept), 0) + score);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function suggestedPriority(emp) {
    const existing = state.priorities[emp.empId];
    if (existing && typeof existing === "object") return { p1: clean(existing.p1), p2: clean(existing.p2), p3: clean(existing.p3) };
    const scores = deptScores(emp.empId).map(([dept]) => dept);
    return {
      p1: clean(scores[0] || emp.department || ""),
      p2: clean(scores[1] || ""),
      p3: clean(scores[2] || "")
    };
  }

  function priorityFor(emp) {
    const p = suggestedPriority(emp);
    return { p1: clean(p.p1), p2: clean(p.p2), p3: clean(p.p3) };
  }

  function badge(text, cls) {
    return `<span class="dept-priority-badge ${cls}">${esc(text)}</span>`;
  }

  function selectHtml(empId, slot, value, depts) {
    return `<select class="admin-select dept-priority-select" data-dept-priority-emp="${esc(empId)}" data-dept-priority-slot="${slot}">
      <option value="">No assigned department</option>
      ${depts.map((d) => `<option value="${esc(d)}" ${key(d) === key(value) ? "selected" : ""}>${esc(d)}</option>`).join("")}
    </select>`;
  }

  function ensurePriorityPanel() {
    let host = $("deptPriorityHost");
    if (host) return host;
    host = document.createElement("div");
    host.id = "deptPriorityHost";
    host.className = "dept-priority-panel";
    const targetSummary = $("targetSummaryHost");
    if (targetSummary) targetSummary.insertAdjacentElement("afterend", host);
    return host;
  }

  function renderPriorityPanel() {
    const host = ensurePriorityPanel();
    if (!host || !state.loaded) return;

    const employees = activeEmployees();
    const depts = allDepartments();
    const rows = employees.map((emp) => {
      const p = priorityFor(emp);
      const learned = deptScores(emp.empId).slice(0, 3).map(([d, score], idx) => badge(`${idx + 1}. ${d} (${score.toFixed(1)})`, `p${idx + 1}`)).join(" ") || badge("No skill/history found", "none");
      const current = p.p1 ? `${p.p1}` : "No assigned department";
      return `<tr>
        <td><b>${esc(emp.empId)} - ${esc(emp.name)}</b><div class="dept-priority-note">Current main: ${esc(current)}</div></td>
        <td>${selectHtml(emp.empId, "p1", p.p1, depts)}</td>
        <td>${selectHtml(emp.empId, "p2", p.p2, depts)}</td>
        <td>${selectHtml(emp.empId, "p3", p.p3, depts)}</td>
        <td>${learned}</td>
      </tr>`;
    }).join("");

    host.innerHTML = `
      <div class="target-summary-title">Employee Department Priority / Multiskill Assignment</div>
      <div class="dept-priority-note">
        Priority 1 is main department. Priority 2 means employee can also work there. Priority 3 means backup/less-skill work. People with no assigned department remain visible.
      </div>
      <div class="dept-priority-actions">
        <div>
          <button id="saveDeptPriorityBtn" type="button">Save Department Priority</button>
          <button id="reloadDeptPriorityBtn" type="button">Reload</button>
        </div>
        <span class="dept-priority-status" id="deptPriorityStatus"></span>
      </div>
      <div class="table-host"><table class="cap-table"><thead><tr><th>Employee</th><th>Priority 1 / Main Dept</th><th>Priority 2 / Can Work</th><th>Priority 3 / Backup</th><th>Learned From Entries</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No active employees available.</td></tr>`}</tbody></table></div>
      <div id="deptPriorityManpowerView"></div>`;

    host.querySelectorAll("[data-dept-priority-emp]").forEach((el) => {
      el.addEventListener("change", () => readPriorityTable());
    });
    $("saveDeptPriorityBtn")?.addEventListener("click", savePriorities);
    $("reloadDeptPriorityBtn")?.addEventListener("click", async () => { await loadData(); renderPriorityPanel(); });
    renderPriorityManpowerView();
    window.SPWT?.styleActionButtons?.(host);
  }

  function readPriorityTable() {
    const next = {};
    document.querySelectorAll("[data-dept-priority-emp]").forEach((el) => {
      const emp = clean(el.dataset.deptPriorityEmp);
      const slot = clean(el.dataset.deptPrioritySlot);
      if (!emp || !slot) return;
      next[emp] = next[emp] || { p1: "", p2: "", p3: "" };
      next[emp][slot] = clean(el.value);
    });
    state.priorities = next;
    renderPriorityManpowerView();
  }

  function syncPrimaryToCapacityPlanStorage() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(PLAN_KEY) || "{}"); } catch { data = {}; }
    const deptOverrides = { ...(data.deptOverrides || {}) };
    activeEmployees().forEach((emp) => {
      const p1 = clean(state.priorities[emp.empId]?.p1 || "");
      if (p1) deptOverrides[emp.empId] = p1;
      else delete deptOverrides[emp.empId];
    });
    localStorage.setItem(PLAN_KEY, JSON.stringify({ ...data, deptOverrides }));
  }

  function savePriorities() {
    readPriorityTable();
    localStorage.setItem(PRIORITY_KEY, JSON.stringify(state.priorities));
    syncPrimaryToCapacityPlanStorage();
    const status = $("deptPriorityStatus");
    if (status) status.textContent = "Saved. Priority 1 is synced as main department for next refresh/open.";
  }

  function renderPriorityManpowerView() {
    const host = $("deptPriorityManpowerView");
    if (!host) return;
    const map = new Map();
    const touch = (dept) => {
      const d = clean(dept) || "No assigned department";
      if (!map.has(d)) map.set(d, { dept: d, p1: [], p2: [], p3: [] });
      return map.get(d);
    };
    activeEmployees().forEach((emp) => {
      const p = priorityFor(emp);
      touch(p.p1).p1.push(emp);
      if (p.p2) touch(p.p2).p2.push(emp);
      if (p.p3) touch(p.p3).p3.push(emp);
    });
    const rows = [...map.values()].sort((a, b) => a.dept.localeCompare(b.dept)).map((x) => {
      const names = (arr) => arr.length ? arr.map((e) => `${e.empId}-${e.name}`).join(", ") : "-";
      return `<tr><td>${esc(x.dept)}</td><td>${x.p1.length}</td><td>${x.p2.length}</td><td>${x.p3.length}</td><td>${esc(names(x.p1))}</td><td>${esc(names([...x.p2, ...x.p3]))}</td></tr>`;
    }).join("");
    host.innerHTML = `<div class="target-summary-title">Department Priority Manpower Visibility</div><table class="cap-table"><thead><tr><th>Department</th><th>P1 Main</th><th>P2 Can Work</th><th>P3 Backup</th><th>Main People</th><th>Cross-skill / Backup People</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function showValidation(message, field) {
    const box = $("warningBox");
    if (box) {
      box.className = "warning-box";
      box.textContent = message;
    }
    document.querySelectorAll(".cap-error-field").forEach((el) => el.classList.remove("cap-error-field"));
    if (field) {
      field.classList.add("cap-error-field");
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => { field.focus?.({ preventScroll: true }); field.select?.(); }, 120);
    }
  }

  function isValidPositive(id, label) {
    const el = $(id);
    if (!el || num(el.value, 0) > 0) return true;
    showValidation(`${label} must be greater than 0.`, el);
    return false;
  }

  function validateButton(id) {
    if (id === "addTargetBtn") {
      if (!clean($("targetMonth")?.value)) return showValidation("Select target month first.", $("targetMonth")), false;
      if (!clean($("targetMachineTypeSelect")?.value)) return showValidation("Select machine type for monthly target.", $("targetMachineTypeSelect")), false;
      return isValidPositive("targetQty", "Target quantity");
    }
    if (id === "addDemandBtn") {
      if (!clean($("machineTypeSelect")?.value)) return showValidation("Select machine type before adding machine demand.", $("machineTypeSelect")), false;
      if (!isValidPositive("machineQty", "Machine quantity")) return false;
      return isValidPositive("priorityNo", "Priority number");
    }
    if (id === "addDependencyBtn") {
      for (const [fieldId, label] of [["depTypeSelect", "Machine type"], ["depWorkSelect", "Work"], ["depSubworkSelect", "Subwork"], ["depOnWorkSelect", "Depends on work"], ["depOnSubworkSelect", "Depends on subwork"]]) {
        if (!clean($(fieldId)?.value)) return showValidation(`${label} is required for dependency rule.`, $(fieldId)), false;
      }
      if (key($("depWorkSelect")?.value) === key($("depOnWorkSelect")?.value) && key($("depSubworkSelect")?.value) === key($("depOnSubworkSelect")?.value)) {
        return showValidation("Dependency cannot be same work/subwork. Select previous work in Depends On fields.", $("depOnSubworkSelect")), false;
      }
    }
    if (id === "generatePlanBtn") {
      const from = clean($("fromDate")?.value), to = clean($("toDate")?.value);
      if (!from) return showValidation("Select From Date before generating production plan.", $("fromDate")), false;
      if (!to) return showValidation("Select To Date before generating production plan.", $("toDate")), false;
      if (from > to) return showValidation("To Date cannot be before From Date.", $("toDate")), false;
      if (!$("demandTable")?.querySelector("tbody tr")) return showValidation("Add at least one machine demand before generating production plan.", $("machineTypeSelect")), false;
    }
    if ((id === "printPlanBtn" || id === "copyPlanBtn") && /not generated|no assignment/i.test($("employeePlanHost")?.textContent || "")) {
      return showValidation("Generate Production Plan first, then print/send.", $("generatePlanBtn")), false;
    }
    return true;
  }

  function wireValidation() {
    ["addTargetBtn", "addDemandBtn", "addDependencyBtn", "generatePlanBtn", "printPlanBtn", "copyPlanBtn"].forEach((id) => {
      const btn = $(id);
      if (!btn || btn.__capV6Validation) return;
      btn.__capV6Validation = true;
      btn.addEventListener("click", (event) => {
        if (!validateButton(id)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    });
  }

  async function loadData() {
    const [master, skillData] = await Promise.all([
      requestJson("/api/admin/master-data"),
      requestJson("/api/admin/skill-matrix").catch(() => ({ records: [] }))
    ]);
    state.master = master || {};
    state.skills = Array.isArray(skillData?.records) ? skillData.records : [];
    loadPriorities();
    state.loaded = true;
  }

  function observeTargetSummary() {
    const host = $("targetSummaryHost");
    if (!host || host.__capV6Observed) return;
    host.__capV6Observed = true;
    new MutationObserver(() => setTimeout(renderPriorityManpowerView, 50)).observe(host, { childList: true, subtree: true });
  }

  async function init() {
    injectStyles();
    wireValidation();
    observeTargetSummary();
    try {
      await loadData();
      renderPriorityPanel();
    } catch (err) {
      console.warn("Capacity department priority panel failed:", err);
    }
    $("refreshBtn")?.addEventListener("click", () => setTimeout(async () => { try { await loadData(); renderPriorityPanel(); } catch {} }, 800));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
