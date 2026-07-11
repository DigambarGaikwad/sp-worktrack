// renderer/capacity/capacityV3.js
// Capacity Planning V3: shift roster, monthly target, work dependencies and skill-history learning.

(function () {
  const API = window.SPWT_CONFIG?.API_BASE_URL || window.location.origin || "http://localhost:3032";
  const DEFAULT_MIN = 465;
  const STORAGE_KEY = "spwt_capacity_plan_v3";
  const $ = (id) => document.getElementById(id);

  const state = {
    master: {}, absences: [], skills: [], progress: [], monthProgress: [],
    demand: [], targets: [], dependencies: [], shiftPlans: [], overtimeEmpIds: [],
    plan: null, seq: 1, shiftSeq: 1, restored: false
  };

  const clean = (v) => String(v ?? "").trim();
  const key = (v) => clean(v).toLowerCase();
  const norm = (v) => clean(v).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = (v) => clean(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const fmtMin = (m) => `${Math.round(num(m, 0))} min`;
  const fmtHr = (m) => `${(num(m, 0) / 60).toFixed(1)} h`;
  const dateText = (d) => d ? d.split("-").reverse().join("/") : "-";
  const makeId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `cap_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function today(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return dateKey(d); }
  function currentMonth() { return today().slice(0, 7); }
  function parseDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return null; const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDaysIso(value, days) { const d = parseDate(value); if (!d) return ""; d.setDate(d.getDate() + days); return dateKey(d); }
  function monthStart(month) { return /^\d{4}-\d{2}$/.test(clean(month)) ? `${month}-01` : `${currentMonth()}-01`; }
  function monthEnd(month) { const text = /^\d{4}-\d{2}$/.test(clean(month)) ? month : currentMonth(); const [y, m] = text.split("-").map(Number); return dateKey(new Date(y, m, 0)); }
  function minIso(a, b) { return clean(a) && clean(b) ? (a < b ? a : b) : clean(a || b); }
  function progressCutoffDate() { return addDaysIso($("fromDate")?.value || today(), -1); }
  function workingDatesBetween(fromValue, toValue) { const from = parseDate(fromValue), to = parseDate(toValue); if (!from || !to || from > to) return []; const dates = []; for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) dates.push(dateKey(d)); return dates; }
  function workingDates() { return workingDatesBetween($("fromDate").value, $("toDate").value); }

  async function api(path) {
    const res = await fetch(`${API}${path}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.message || `API error ${res.status}`);
    return body.data;
  }

  async function loadData() {
    setBusy(true);
    try {
      const cutoff = progressCutoffDate();
      const month = $("targetMonth")?.value || currentMonth();
      const monthFrom = monthStart(month);
      const monthCutoff = minIso(today(), monthEnd(month));
      const [master, absences, skillData, progressData, monthProgressData] = await Promise.all([
        api("/api/admin/master-data"),
        api("/api/admin/planned-absences").catch(() => []),
        api("/api/admin/skill-matrix").catch(() => ({ records: [] })),
        api(`/api/capacity/progress?cutoff_date=${encodeURIComponent(cutoff)}`).catch(() => ({ records: [] })),
        api(`/api/capacity/progress?from_date=${encodeURIComponent(monthFrom)}&cutoff_date=${encodeURIComponent(monthCutoff)}`).catch(() => ({ records: [] }))
      ]);
      state.master = master || {};
      state.absences = Array.isArray(absences) ? absences : [];
      state.skills = Array.isArray(skillData?.records) ? skillData.records : [];
      state.progress = Array.isArray(progressData?.records) ? progressData.records : [];
      state.monthProgress = Array.isArray(monthProgressData?.records) ? monthProgressData.records : [];
      populateControls();
      restoreSavedPlanOnce();
      ensureDefaultShiftPlans();
      if (state.demand.length) generatePlan({ render: false }); else state.plan = null;
      renderAll();
    } catch (err) {
      showError(err.message || err);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(isBusy) { ["refreshBtn", "savePlanBtn", "addShiftBtn", "addTargetBtn", "addDemandBtn", "addDependencyBtn", "generatePlanBtn"].forEach((id) => { if ($(id)) $(id).disabled = isBusy; }); }
  function showError(message) { $("warningBox").className = "warning-box"; $("warningBox").textContent = `Capacity planning data load issue: ${message}`; }
  function shifts() { return (state.master.shifts || []).filter((x) => x.active !== false); }
  function machineTypes() { return state.master.machineTypes || []; }
  function activeEmployees() { return (state.master.employees || []).filter((e) => e.active !== false && clean(e.empId)); }
  function typeById(typeId) { return machineTypes().find((t) => norm(t.id) === norm(typeId) || norm(t.name) === norm(typeId)) || null; }
  function typeName(typeId) { const t = typeById(typeId); return clean(t?.name || typeId); }

  function populateControls() {
    const options = machineTypes().map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
    ["machineTypeSelect", "targetMachineTypeSelect", "depTypeSelect"].forEach((id) => { if ($(id)) $(id).innerHTML = options; });
    renderDependencySelectors();
  }

  function timeMin(value) { const m = clean(value).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function shiftById(id) { return shifts().find((x) => clean(x.id || x.name) === clean(id)) || shifts()[0] || null; }
  function shiftMinutes(shiftId) { const s = shiftById(shiftId); if (!s) return DEFAULT_MIN; const start = timeMin(s.start), end = timeMin(s.end); if (start == null || end == null) return DEFAULT_MIN; let gross = end - start; if (gross < 0) gross += 1440; return Math.max(gross - num(s.breakMinutes, 0), 0) || DEFAULT_MIN; }
  function employeeMinutes(emp, shiftId) { const employeeLimit = num(emp.availableMinutesDay, 0), shiftLimit = shiftMinutes(shiftId); return employeeLimit > 0 ? Math.min(employeeLimit, shiftLimit) : shiftLimit; }

  function ensureDefaultShiftPlans() {
    if (state.shiftPlans.length) return;
    const firstShift = shifts()[0];
    state.shiftPlans = [{ id: `shift_${state.shiftSeq++}`, shiftId: clean(firstShift?.id || firstShift?.name || "General"), employeeIds: activeEmployees().map((e) => e.empId) }];
  }

  function allRegularSelected(exceptShiftId = "") {
    const set = new Set();
    state.shiftPlans.forEach((sp) => { if (sp.id !== exceptShiftId) (sp.employeeIds || []).forEach((id) => set.add(key(id))); });
    return set;
  }

  function renderShiftAssignments() {
    const host = $("shiftAssignmentsHost");
    const empList = activeEmployees(), shiftList = shifts();
    ensureDefaultShiftPlans();
    host.innerHTML = state.shiftPlans.map((sp, index) => {
      const usedElsewhere = allRegularSelected(sp.id);
      const shiftOptions = shiftList.map((s) => { const id = clean(s.id || s.name); return `<option value="${esc(id)}" ${id === sp.shiftId ? "selected" : ""}>${esc(s.name)} (${esc(s.start || "")}-${esc(s.end || "")})</option>`; }).join("") || `<option value="General">General</option>`;
      const checks = empList.map((e) => { const checked = (sp.employeeIds || []).some((id) => key(id) === key(e.empId)); const disabled = !checked && usedElsewhere.has(key(e.empId)); return `<label class="check-pill ${disabled ? "disabled" : ""}"><input type="checkbox" data-shift-emp="${esc(sp.id)}" data-emp="${esc(e.empId)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />${esc(e.empId)} - ${esc(e.name)}</label>`; }).join("");
      return `<div class="shift-card"><div class="shift-card-head"><label>Shift ${index + 1}<select class="shift-select" data-shift-id="${esc(sp.id)}">${shiftOptions}</select></label><button class="remove-btn shift-remove" data-remove-shift="${esc(sp.id)}" type="button">Remove</button></div><div class="checkbox-flex">${checks}</div></div>`;
    }).join("");
    document.querySelectorAll(".shift-select").forEach((el) => { el.onchange = () => { const sp = state.shiftPlans.find((x) => x.id === el.dataset.shiftId); if (sp) sp.shiftId = el.value; state.plan = null; renderAll(); }; });
    document.querySelectorAll("[data-shift-emp]").forEach((el) => { el.onchange = () => toggleShiftEmployee(el.dataset.shiftEmp, el.dataset.emp, el.checked); });
    document.querySelectorAll("[data-remove-shift]").forEach((el) => { el.onclick = () => removeShift(el.dataset.removeShift); });
  }

  function toggleShiftEmployee(shiftId, empId, checked) {
    state.shiftPlans.forEach((sp) => { sp.employeeIds = (sp.employeeIds || []).filter((id) => key(id) !== key(empId)); });
    if (checked) { const sp = state.shiftPlans.find((x) => x.id === shiftId); if (sp) sp.employeeIds = [...(sp.employeeIds || []), empId]; }
    state.plan = null; renderAll();
  }
  function addShift() { const firstShift = shifts()[0]; state.shiftPlans.push({ id: `shift_${state.shiftSeq++}`, shiftId: clean(firstShift?.id || firstShift?.name || "General"), employeeIds: [] }); state.plan = null; renderAll(); }
  function removeShift(id) { state.shiftPlans = state.shiftPlans.filter((x) => x.id !== id); ensureDefaultShiftPlans(); state.plan = null; renderAll(); }

  function renderOvertime() {
    const host = $("overtimeHost");
    host.innerHTML = activeEmployees().map((e) => { const checked = state.overtimeEmpIds.some((id) => key(id) === key(e.empId)); return `<label class="check-pill ot"><input type="checkbox" data-ot-emp="${esc(e.empId)}" ${checked ? "checked" : ""} />${esc(e.empId)} - ${esc(e.name)}</label>`; }).join("") || `<div class="empty-state">No active employees available.</div>`;
    document.querySelectorAll("[data-ot-emp]").forEach((el) => { el.onchange = () => { const empId = el.dataset.otEmp; state.overtimeEmpIds = state.overtimeEmpIds.filter((id) => key(id) !== key(empId)); if (el.checked) state.overtimeEmpIds.push(empId); state.plan = null; renderAll(); }; });
  }

  function absentSet(date) { const set = new Set(); state.absences.forEach((a) => { const dates = Array.isArray(a.plannedDates) ? a.plannedDates : []; if (dates.includes(date)) set.add(key(a.emp_code || a.empCode || a.empId)); }); return set; }
  function activeMachinesByType(typeId) { return (state.master.machines || []).filter((m) => m.active !== false && key(m.status || "Active") === "active" && norm(m.type) === norm(typeId)).map((m) => clean(m.name)).filter(Boolean).sort((a, b) => a.localeCompare(b)); }
  function usedMachineNos(typeId) { return new Set(state.demand.filter((d) => norm(d.typeId) === norm(typeId)).map((d) => clean(d.machineNo)).filter((x) => x && x !== "No number given yet")); }

  function addDemand() {
    const typeId = $("machineTypeSelect").value, typeNameText = $("machineTypeSelect").selectedOptions[0]?.textContent || typeId;
    const qty = Math.max(1, Math.round(num($("machineQty").value, 1))), priority = Math.max(1, Math.round(num($("priorityNo").value, 1))), targetDate = clean($("targetDate").value);
    if (!typeId) return;
    const used = usedMachineNos(typeId), pool = activeMachinesByType(typeId).filter((m) => !used.has(m));
    for (let i = 0; i < qty; i += 1) { const machineNo = pool.shift() || "No number given yet"; if (machineNo !== "No number given yet") used.add(machineNo); state.demand.push({ id: makeId(), seq: state.seq++, priority, typeId, typeName: typeNameText, machineNo, targetDate }); }
    $("priorityNo").value = String(priority + 1); state.plan = null; renderAll();
  }
  function demandSorted() { return [...state.demand].sort((a, b) => num(a.priority, 9999) - num(b.priority, 9999) || clean(a.targetDate).localeCompare(clean(b.targetDate)) || num(a.seq) - num(b.seq)); }
  function workCatalog(typeId) { return state.master.workCatalogByType?.[typeId] || { mainWorks: [], subWorks: {} }; }
  function typeStdMinutes(typeId) { const cat = workCatalog(typeId); return (cat.mainWorks || []).reduce((sum, dept) => sum + (cat.subWorks?.[dept] || []).reduce((s, sw) => s + num(sw.standardTime, 0), 0), 0); }
  function typeDeptStd(typeId, dept) { const cat = workCatalog(typeId); return (cat.subWorks?.[dept] || []).reduce((s, sw) => s + num(sw.standardTime, 0), 0); }

  function machineTypeForNo(machineNo) { const m = (state.master.machines || []).find((x) => key(x.name) === key(machineNo)); const t = typeById(m?.type); return { id: clean(m?.type || ""), name: clean(t?.name || m?.type || "") }; }
  function progressTypeValues(p) { const byNo = machineTypeForNo(p.machine_no); return [p.machine_type_code, p.machine_type_name, p.machine_category, byNo.id, byNo.name].map(clean).filter(Boolean); }
  function progressMatchesType(p, typeId, typeNameText) { const wanted = [typeId, typeNameText, typeName(typeId)].map(norm).filter(Boolean); return progressTypeValues(p).some((x) => wanted.includes(norm(x))); }
  function progressRecordsForType(typeId, typeNameText, records = state.monthProgress) { return (records || []).filter((p) => progressMatchesType(p, typeId, typeNameText)); }
  function progressRecordsForDept(typeId, typeNameText, dept) { return progressRecordsForType(typeId, typeNameText).filter((p) => key(p.department_name) === key(dept)); }

  function addTarget() {
    const typeId = $("targetMachineTypeSelect").value, typeNameText = $("targetMachineTypeSelect").selectedOptions[0]?.textContent || typeId;
    const qty = Math.max(1, Math.round(num($("targetQty").value, 1)));
    if (!typeId) return;
    const existing = state.targets.find((t) => norm(t.typeId) === norm(typeId));
    if (existing) { existing.qty = qty; existing.typeName = typeNameText; } else state.targets.push({ id: makeId(), typeId, typeName: typeNameText, qty });
    renderAll();
  }
  function removeTarget(id) { state.targets = state.targets.filter((t) => t.id !== id); renderAll(); }

  function monthlyStatsForType(target) {
    const stdPerMachine = typeStdMinutes(target.typeId);
    const recs = progressRecordsForType(target.typeId, target.typeName, state.monthProgress.length ? state.monthProgress : state.progress);
    const doneStd = recs.reduce((sum, p) => sum + num(p.consumed_standard_minutes, 0), 0);
    const machineMap = new Map();
    recs.forEach((p) => { const no = clean(p.machine_no); if (!no) return; machineMap.set(no, num(machineMap.get(no), 0) + num(p.consumed_standard_minutes, 0)); });
    const completedQty = stdPerMachine > 0 ? [...machineMap.values()].filter((v) => v >= stdPerMachine * 0.98).length : 0;
    const eqQty = stdPerMachine > 0 ? doneStd / stdPerMachine : 0;
    return { stdPerMachine, doneStd, completedQty, eqQty };
  }

  function renderTargets() {
    const host = $("targetTable");
    if (!state.targets.length) { host.innerHTML = `<div class="empty-state">Add monthly targets like Booster - Water Cooled, Online, Air Cooled etc.</div>`; $("targetSummaryHost").innerHTML = ""; return; }
    const month = $("targetMonth").value || currentMonth();
    const totalDays = workingDatesBetween(monthStart(month), monthEnd(month)).length || 1;
    const elapsedDays = workingDatesBetween(monthStart(month), minIso(today(), monthEnd(month))).length || 1;
    const rows = state.targets.map((t) => {
      const st = monthlyStatsForType(t);
      const targetStd = st.stdPerMachine * num(t.qty, 0), expectedStd = targetStd * (elapsedDays / totalDays), gap = st.doneStd - expectedStd;
      const behind = gap < -0.5, stopOt = gap > Math.max(60, targetStd * 0.05);
      const status = behind ? `Behind ${fmtHr(Math.abs(gap))}` : stopOt ? `Ahead ${fmtHr(gap)} - stop extra OT` : `On Track ${fmtHr(gap)}`;
      return `<tr><td>${esc(t.typeName)}</td><td>${esc(t.qty)}</td><td>${esc(st.completedQty)} (${st.eqQty.toFixed(1)} eq)</td><td>${fmtHr(targetStd)}</td><td>${fmtHr(expectedStd)}</td><td>${fmtHr(st.doneStd)}</td><td><span class="badge ${behind ? "noskill" : stopOt ? "complete" : "medium"}">${esc(status)}</span></td><td>${behind ? fmtHr(Math.abs(gap)) : "0.0 h"}</td><td><button class="remove-btn" data-remove-target="${esc(t.id)}" type="button">Remove</button></td></tr>`;
    }).join("");
    host.innerHTML = `<table class="cap-table"><thead><tr><th>Machine Type</th><th>Month Qty</th><th>Completed Qty</th><th>Target Std Hrs</th><th>Expected Till Today</th><th>Done Std Hrs</th><th>Status</th><th>OT Need</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.querySelectorAll("[data-remove-target]").forEach((el) => el.onclick = () => removeTarget(el.dataset.removeTarget));
    renderTargetSummary();
  }

  function renderTargetSummary() {
    const host = $("targetSummaryHost");
    const map = new Map();
    const month = $("targetMonth").value || currentMonth();
    const remainingDays = Math.max(1, workingDatesBetween(today(), monthEnd(month)).length);
    state.targets.forEach((t) => {
      const cat = workCatalog(t.typeId);
      (cat.mainWorks || []).forEach((dept) => {
        const target = typeDeptStd(t.typeId, dept) * num(t.qty, 0);
        const done = progressRecordsForDept(t.typeId, t.typeName, dept).reduce((s, p) => s + num(p.consumed_standard_minutes, 0), 0);
        const old = map.get(dept) || { dept, target: 0, done: 0 };
        old.target += target; old.done += done; map.set(dept, old);
      });
    });
    if (!map.size) { host.innerHTML = ""; return; }
    const rows = [...map.values()].sort((a, b) => b.target - a.target).map((x) => {
      const balance = Math.max(0, x.target - x.done);
      const manpower = balance > 0 ? Math.ceil(balance / (remainingDays * DEFAULT_MIN)) : 0;
      return `<tr><td>${esc(x.dept)}</td><td>${fmtHr(x.target)}</td><td>${fmtHr(x.done)}</td><td>${fmtHr(balance)}</td><td>${esc(manpower)}</td></tr>`;
    }).join("");
    host.innerHTML = `<div class="target-summary-title">Department-wise Monthly Manpower Need</div><table class="cap-table"><thead><tr><th>Department</th><th>Target Std Hrs</th><th>Done Std Hrs</th><th>Balance Std Hrs</th><th>Approx People Needed</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function deptOptions(typeId) { const cat = workCatalog(typeId); return cat.mainWorks || []; }
  function subworkOptions(typeId, dept) { const cat = workCatalog(typeId); return cat.subWorks?.[dept] || []; }
  function fillSelect(id, items, valFn = (x) => x, textFn = (x) => x) { if (!$(id)) return; const current = $(id).value; $(id).innerHTML = items.map((x) => `<option value="${esc(valFn(x))}">${esc(textFn(x))}</option>`).join(""); if (current && [...$(id).options].some((o) => o.value === current)) $(id).value = current; }

  function renderDependencySelectors() {
    const typeId = $("depTypeSelect")?.value || machineTypes()[0]?.id || "";
    if (!$("depTypeSelect")?.value && typeId) $("depTypeSelect").value = typeId;
    const depts = deptOptions(typeId);
    fillSelect("depWorkSelect", depts);
    fillSelect("depOnWorkSelect", depts);
    fillSelect("depSubworkSelect", subworkOptions(typeId, $("depWorkSelect")?.value).map((x) => x.name));
    fillSelect("depOnSubworkSelect", subworkOptions(typeId, $("depOnWorkSelect")?.value).map((x) => x.name));
  }

  function addDependency() {
    const typeId = $("depTypeSelect").value, typeNameText = typeName(typeId), work = $("depWorkSelect").value, subwork = $("depSubworkSelect").value, dependsWork = $("depOnWorkSelect").value, dependsSubwork = $("depOnSubworkSelect").value;
    if (!typeId || !work || !subwork || !dependsWork || !dependsSubwork) return;
    const dup = state.dependencies.some((d) => norm(d.typeId) === norm(typeId) && key(d.work) === key(work) && key(d.subwork) === key(subwork) && key(d.dependsWork) === key(dependsWork) && key(d.dependsSubwork) === key(dependsSubwork));
    if (!dup) state.dependencies.push({ id: makeId(), typeId, typeName: typeNameText, work, subwork, dependsWork, dependsSubwork });
    state.plan = null; renderAll();
  }
  function removeDependency(id) { state.dependencies = state.dependencies.filter((d) => d.id !== id); state.plan = null; renderAll(); }
  function renderDependencies() {
    renderDependencySelectors();
    const host = $("dependencyTable");
    if (!state.dependencies.length) { host.innerHTML = `<div class="empty-state">No work dependencies saved yet. Add rules only where one work cannot start before another work is complete.</div>`; return; }
    const rows = state.dependencies.map((d) => `<tr><td>${esc(d.typeName)}</td><td><span class="dependency-chip">${esc(d.work)} / ${esc(d.subwork)}</span></td><td>after</td><td><span class="dependency-chip">${esc(d.dependsWork)} / ${esc(d.dependsSubwork)}</span></td><td><button class="remove-btn" data-remove-dependency="${esc(d.id)}" type="button">Remove</button></td></tr>`).join("");
    host.innerHTML = `<table class="cap-table"><thead><tr><th>Machine Type</th><th>Work</th><th>Rule</th><th>Depends On</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.querySelectorAll("[data-remove-dependency]").forEach((el) => el.onclick = () => removeDependency(el.dataset.removeDependency));
  }

  function progressKey(machineNo, type, dept, subwork) { return [machineNo, type, dept, subwork].map(key).join("|"); }
  function buildProgressMap() { const map = new Map(); state.progress.forEach((p) => { const machineNo = clean(p.machine_no), dept = clean(p.department_name), subwork = clean(p.subwork_name), consumed = num(p.consumed_standard_minutes, 0); if (!machineNo || !dept || !subwork || consumed <= 0) return; progressTypeValues(p).forEach((type) => map.set(progressKey(machineNo, type, dept, subwork), Math.max(num(map.get(progressKey(machineNo, type, dept, subwork)), 0), consumed))); }); return map; }
  function progressFor(progressMap, machineNo, typeId, typeNameText, dept, subwork) { if (!machineNo || machineNo === "No number given yet") return 0; return Math.max(num(progressMap.get(progressKey(machineNo, typeId, dept, subwork)), 0), num(progressMap.get(progressKey(machineNo, typeNameText, dept, subwork)), 0), num(progressMap.get(progressKey(machineNo, typeName(typeId), dept, subwork)), 0)); }

  function buildTasks() {
    const tasks = [], progressMap = buildProgressMap();
    demandSorted().forEach((d) => { const cat = workCatalog(d.typeId); (cat.mainWorks || []).forEach((dept) => { (cat.subWorks?.[dept] || []).forEach((sw, idx) => { const std = num(sw.standardTime, 0); if (std <= 0) return; const completedBeforeStd = Math.min(std, progressFor(progressMap, d.machineNo, d.typeId, d.typeName, dept, sw.name)); tasks.push({ id: `${d.id}|${dept}|${sw.name}|${idx}`, demandId: d.id, priority: num(d.priority, 9999), seq: d.seq, targetDate: d.targetDate, machineNo: d.machineNo, typeId: d.typeId, typeName: d.typeName, dept, subwork: sw.name, stdMinutes: std, completedBeforeStd, remainingStd: Math.max(0, std - completedBeforeStd) }); }); }); });
    return tasks;
  }
  function tasksByDemand(tasks) { const map = new Map(); tasks.forEach((t) => { if (!map.has(t.demandId)) map.set(t.demandId, []); map.get(t.demandId).push(t); }); return map; }
  function demandStatusMap(tasks = buildTasks()) { const map = new Map(); tasksByDemand(tasks).forEach((items, id) => { const remaining = items.reduce((s, t) => s + Math.max(0, t.remainingStd), 0), doneBefore = items.reduce((s, t) => s + num(t.completedBeforeStd, 0), 0); if (items.length && remaining <= 0.01) map.set(id, "Completed from entries"); else if (doneBefore > 0) map.set(id, `Partial done ${fmtHr(doneBefore)}`); else map.set(id, "Open"); }); return map; }

  function depRulesFor(task) { return state.dependencies.filter((d) => norm(d.typeId) === norm(task.typeId) && key(d.work) === key(task.dept) && key(d.subwork) === key(task.subwork)); }
  function depsSatisfied(task, tasks) {
    if ($("sequenceMode")?.value === "free") return true;
    return depRulesFor(task).every((r) => { const depTask = tasks.find((t) => t.demandId === task.demandId && key(t.dept) === key(r.dependsWork) && key(t.subwork) === key(r.dependsSubwork)); return !depTask || depTask.remainingStd <= 0.01; });
  }
  function blockedReason(task, tasks) { const openDeps = depRulesFor(task).filter((r) => { const depTask = tasks.find((t) => t.demandId === task.demandId && key(t.dept) === key(r.dependsWork) && key(t.subwork) === key(r.dependsSubwork)); return depTask && depTask.remainingStd > 0.01; }); return openDeps.map((r) => `${r.dependsWork} / ${r.dependsSubwork}`).join(", "); }

  function skillKey(empCode, typeId, dept, subwork) { return [empCode, typeId, dept, subwork].map(key).join("|"); }
  function buildSkillMap() { const map = new Map(); state.skills.forEach((s) => { if (s.active === false) return; const emp = s.emp_code || s.empCode, type = s.machine_type_code || s.machine_type_name, dept = s.skill_department_name || s.department_name, sub = s.subwork_name; if (!emp || !type || !dept || !sub) return; map.set(skillKey(emp, type, dept, sub), s); }); return map; }
  function skillFor(skillMap, emp, task) { return skillMap.get(skillKey(emp.empId, task.typeId, task.dept, task.subwork)) || skillMap.get(skillKey(emp.empId, task.typeName, task.dept, task.subwork)) || skillMap.get(skillKey(emp.empId, typeName(task.typeId), task.dept, task.subwork)) || null; }
  function confidenceScore(skill) { const c = key(skill?.confidence_level || "No Skill"); if (c === "high") return 4; if (c === "medium") return 3; if (c === "low") return 2; return 0; }
  function confidenceText(skill) { return skill?.confidence_level || "No Skill"; }
  function planningEff(skill) { return Math.max(30, Math.min(120, num(skill?.planning_efficiency_pct, 100) || 100)); }
  function historyScore(skill) { return Math.min(num(skill?.history_count, 0), 20) * 30 + planningEff(skill) * 2; }
  function taskSort(a, b) { return num(a.priority, 9999) - num(b.priority, 9999) || clean(a.targetDate).localeCompare(clean(b.targetDate)) || num(a.seq) - num(b.seq) || clean(a.dept).localeCompare(clean(b.dept)) || clean(a.subwork).localeCompare(clean(b.subwork)); }
  function nextOpenTask(tasks) { const open = tasks.filter((t) => t.remainingStd > 0.01).sort(taskSort); return open.find((t) => depsSatisfied(t, tasks)) || null; }

  function bestEmployeeForTask(empStates, skillMap, task) {
    let best = null;
    empStates.filter((e) => e.available > 0.5).forEach((e) => { const skill = skillFor(skillMap, e.emp, task), conf = confidenceScore(skill); const deptMatch = key(e.emp.department) && key(e.emp.department) === key(task.dept) ? 1 : 0; const score = (conf * 10000) + historyScore(skill) + (deptMatch * 500) + Math.min(e.available, 999) / 1000; if (!best || score > best.score || (score === best.score && clean(e.emp.name).localeCompare(clean(best.state.emp.name)) < 0)) best = { state: e, skill, score }; });
    return best;
  }

  function assignTasks(date, empStates, tasks, skillMap, byDemand, completedDemand, assignments, isOvertime = false) {
    while (empStates.some((e) => e.available > 0.5)) {
      const task = nextOpenTask(tasks); if (!task) break;
      const picked = bestEmployeeForTask(empStates, skillMap, task); if (!picked) break;
      const eff = planningEff(picked.skill), possibleStd = picked.state.available * (eff / 100), assignStd = Math.min(task.remainingStd, possibleStd), planMin = assignStd * (100 / eff);
      if (assignStd <= 0.01 || planMin <= 0.01) break;
      task.remainingStd -= assignStd; picked.state.available -= planMin;
      const demandItems = byDemand.get(task.demandId) || []; const machineComplete = !completedDemand.has(task.demandId) && demandItems.length && demandItems.every((t) => t.remainingStd <= 0.01); if (machineComplete) completedDemand.add(task.demandId);
      assignments.push({ date, empId: picked.state.emp.empId, empName: picked.state.emp.name, empDept: picked.state.emp.department, shiftName: picked.state.shiftName, overtime: isOvertime, machineNo: task.machineNo, typeName: task.typeName, work: task.dept, subwork: task.subwork, priority: task.priority, stdMinutes: assignStd, planMinutes: planMin, balanceMinutes: picked.state.available, confidence: confidenceText(picked.skill), historyCount: num(picked.skill?.history_count, 0), planningEff: eff, targetDate: task.targetDate, machineComplete });
    }
  }

  function regularEmpStates(date) { const absent = absentSet(date), employeesById = new Map(activeEmployees().map((e) => [key(e.empId), e])), states = []; state.shiftPlans.forEach((sp) => { const shift = shiftById(sp.shiftId); (sp.employeeIds || []).forEach((empId) => { const emp = employeesById.get(key(empId)); if (!emp || absent.has(key(emp.empId))) return; states.push({ emp, available: employeeMinutes(emp, sp.shiftId), shiftId: sp.shiftId, shiftName: shift?.name || sp.shiftId, overtime: false }); }); }); return states; }
  function overtimeEmpStates(date) { const absent = absentSet(date), employeesById = new Map(activeEmployees().map((e) => [key(e.empId), e])), otMax = Math.max(0, num($("otMaxMinutes")?.value, 0)); if (otMax <= 0) return []; return state.overtimeEmpIds.map((empId) => employeesById.get(key(empId))).filter((emp) => emp && !absent.has(key(emp.empId))).map((emp) => ({ emp, available: otMax, shiftId: "OT", shiftName: "Overtime", overtime: true })); }

  function generatePlan(options = {}) {
    const dates = workingDates(), tasks = buildTasks(), skillMap = buildSkillMap(), assignments = [], completionNotes = [], blockedNotes = [], absentDates = new Map(), byDemand = tasksByDemand(tasks), completedDemand = new Set(), dateRoster = new Map();
    demandSorted().forEach((d) => { const items = byDemand.get(d.id) || []; if (items.length && items.every((t) => t.remainingStd <= 0.01)) { completedDemand.add(d.id); completionNotes.push({ date: dates[0] || $("fromDate").value, priority: d.priority, machineNo: d.machineNo, typeName: d.typeName, message: "Machine already completed from production entries before this plan." }); } });
    dates.forEach((date) => { const regularStates = regularEmpStates(date); dateRoster.set(date, regularStates.map((s) => ({ empId: s.emp.empId, empName: s.emp.name, empDept: s.emp.department, shiftName: s.shiftName }))); assignTasks(date, regularStates, tasks, skillMap, byDemand, completedDemand, assignments, false); if (tasks.some((t) => t.remainingStd > 0.01)) assignTasks(date, overtimeEmpStates(date), tasks, skillMap, byDemand, completedDemand, assignments, true); state.absences.forEach((a) => { if ((a.plannedDates || []).includes(date)) { const emp = clean(a.emp_code || a.empCode || a.empId); if (!absentDates.has(emp)) absentDates.set(emp, []); absentDates.get(emp).push(date); } }); });
    tasks.filter((t) => t.remainingStd > 0.01).sort(taskSort).slice(0, 20).forEach((t) => { const reason = blockedReason(t, tasks); if (reason) blockedNotes.push({ priority: t.priority, machineNo: t.machineNo, typeName: t.typeName, work: t.dept, subwork: t.subwork, reason }); });
    const remainingStd = tasks.reduce((s, t) => s + Math.max(0, t.remainingStd), 0), overtimeMinutes = assignments.filter((a) => a.overtime).reduce((s, a) => s + a.planMinutes, 0);
    state.plan = { dates, tasks, assignments, completionNotes, blockedNotes, remainingStd, overtimeMinutes, doneMachines: completedDemand.size, totalMachines: state.demand.length, absentDates, dateRoster };
    if (options.render !== false) renderAll();
  }

  function summarizeCapacity() { const dates = workingDates(); let regularMin = 0, otMin = 0, absentCount = 0; dates.forEach((date) => { const absent = absentSet(date); absentCount += absent.size; regularEmpStates(date).forEach((e) => { regularMin += e.available; }); overtimeEmpStates(date).forEach((e) => { otMin += e.available; }); }); return { dates, selectedEmployees: new Set(state.shiftPlans.flatMap((sp) => sp.employeeIds || []).map(key)).size, absentCount, regularMin, otMin }; }
  function requirementSummary(tasks = buildTasks()) { const map = new Map(); tasks.forEach((t) => { const old = map.get(t.dept) || { dept: t.dept, required: 0, completedBefore: 0, subworks: new Set() }; old.required += Math.max(0, t.remainingStd); old.completedBefore += num(t.completedBeforeStd, 0); old.subworks.add(t.subwork); map.set(t.dept, old); }); return [...map.values()].sort((a, b) => a.dept.localeCompare(b.dept)); }
  function metric(label, value, tone = "") { return `<div class="metric-card"><div class="metric-label">${esc(label)}</div><div class="metric-value ${tone}">${esc(value)}</div></div>`; }

  function renderCapacity() { const c = summarizeCapacity(); $("workDays").value = String(c.dates.length); $("capacityMetrics").innerHTML = [metric("Selected Employees", c.selectedEmployees), metric("Planned Absent Days", c.absentCount), metric("Regular Hours", fmtHr(c.regularMin), c.regularMin ? "green" : "red"), metric("OT Pref People", state.overtimeEmpIds.length), metric("OT Potential", fmtHr(c.otMin), c.otMin ? "orange" : ""), metric("Total With OT", fmtHr(c.regularMin + c.otMin), (c.regularMin + c.otMin) ? "green" : "red")].join(""); }
  function renderDemand() { if (!state.demand.length) { $("demandTable").innerHTML = `<div class="empty-state">No machine demand added yet.</div>`; return; } const statusMap = demandStatusMap(); const rows = demandSorted().map((d) => `<tr><td><input class="inline-input demand-priority" data-id="${d.id}" type="number" min="1" value="${esc(d.priority)}" /></td><td>${esc(d.machineNo)}</td><td>${esc(d.typeName)}</td><td><input class="inline-input demand-target" data-id="${d.id}" type="date" value="${esc(d.targetDate)}" /></td><td>${esc(statusMap.get(d.id) || "Open")}</td><td>${esc(d.seq)}</td><td><button class="remove-btn" data-remove="${d.id}" type="button">Remove</button></td></tr>`).join(""); $("demandTable").innerHTML = `<table class="cap-table"><thead><tr><th>Priority No.</th><th>Machine No.</th><th>Type</th><th>Target Date</th><th>Progress</th><th>Seq</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`; document.querySelectorAll(".demand-priority").forEach((el) => el.oninput = () => updateDemand(el.dataset.id, { priority: Math.max(1, Math.round(num(el.value, 1))) })); document.querySelectorAll(".demand-target").forEach((el) => el.onchange = () => updateDemand(el.dataset.id, { targetDate: el.value })); document.querySelectorAll("[data-remove]").forEach((el) => el.onclick = () => removeDemand(el.dataset.remove)); }
  function updateDemand(id, patch) { state.demand = state.demand.map((d) => d.id === id ? { ...d, ...patch } : d); state.plan = null; renderAll(); }
  function removeDemand(id) { state.demand = state.demand.filter((d) => d.id !== id); state.plan = null; renderAll(); }
  function renderRequirement() { const items = requirementSummary(); if (!items.length) { $("requirementTable").innerHTML = `<div class="empty-state">Add machine demand to calculate department-wise required manhours.</div>`; return; } const rows = items.map((x) => `<tr><td>${esc(x.dept)}</td><td>${fmtHr(x.required)}</td><td>${fmtHr(x.completedBefore)}</td><td>${x.subworks.size}</td><td>${esc([...x.subworks].slice(0, 4).join(", "))}${x.subworks.size > 4 ? "..." : ""}</td></tr>`).join(""); $("requirementTable").innerHTML = `<table class="cap-table"><thead><tr><th>Department</th><th>Remaining Std Hrs</th><th>Done From Entries</th><th>Subworks</th><th>Critical Work Scope</th></tr></thead><tbody>${rows}</tbody></table>`; }
  function renderResult() { const c = summarizeCapacity(), tasks = buildTasks(), originalReq = tasks.reduce((s, t) => s + t.stdMinutes, 0), completedBefore = tasks.reduce((s, t) => s + num(t.completedBeforeStd, 0), 0), req = tasks.reduce((s, t) => s + Math.max(0, t.remainingStd), 0), remaining = state.plan ? state.plan.remainingStd : req, gap = c.regularMin - req, withOtGap = (c.regularMin + c.otMin) - req; $("resultMetrics").innerHTML = [metric("Machine Demand", state.demand.length), metric("Original Std Hrs", fmtHr(originalReq)), metric("Done From Entries", fmtHr(completedBefore), completedBefore ? "green" : ""), metric("Remaining Std Hrs", fmtHr(req)), metric("Regular Gap", fmtHr(gap), gap >= 0 ? "green" : "red"), metric("Gap With OT", fmtHr(withOtGap), withOtGap >= 0 ? "green" : "red"), metric("Planned OT", state.plan ? fmtHr(state.plan.overtimeMinutes) : "-", state.plan?.overtimeMinutes ? "orange" : ""), metric("Blocked Work", state.plan ? state.plan.blockedNotes.length : "-", state.plan?.blockedNotes?.length ? "orange" : ""), metric("Plan Completed", state.plan ? `${state.plan.doneMachines}/${state.plan.totalMachines}` : "-"), metric("Unplanned Std Hrs", state.plan ? fmtHr(remaining) : "-")].join(""); const box = $("warningBox"); box.className = `warning-box ${withOtGap >= 0 && !state.plan?.blockedNotes?.length ? "ok" : ""}`; if (!state.demand.length) box.textContent = "Add machine demand to see shortage, overtime and multiskilling requirement."; else if (state.plan?.blockedNotes?.length) box.textContent = "Some work is blocked by saved dependency rules. Complete dependency work first or correct dependency settings."; else if (gap >= 0) box.textContent = "Regular selected shift capacity is sufficient. Overtime can be stopped unless target date risk exists."; else if (withOtGap >= 0) box.textContent = `Regular capacity is short by ${fmtHr(Math.abs(gap))}, but selected OT preference can cover it. Use OT only for priority/target risk.`; else box.textContent = `Even with selected OT, shortage remains ${fmtHr(Math.abs(withOtGap))}. Need more manpower, multiskilling, target date change, or reduce machine demand.`; }

  function renderPlan() {
    const host = $("employeePlanHost");
    if (!state.plan) { host.innerHTML = `<div class="empty-state">Production plan not generated yet.</div>`; return; }
    const byDate = new Map();
    state.plan.dates.forEach((date) => byDate.set(date, { rows: [], notes: [], blocked: [], roster: state.plan.dateRoster.get(date) || [] }));
    state.plan.assignments.forEach((a) => byDate.get(a.date)?.rows.push(a));
    state.plan.completionNotes.forEach((n) => byDate.get(n.date)?.notes.push(n));
    state.plan.blockedNotes.forEach((n) => { const d = state.plan.dates[state.plan.dates.length - 1] || $("toDate").value; if (!byDate.has(d)) byDate.set(d, { rows: [], notes: [], blocked: [], roster: [] }); byDate.get(d).blocked.push(n); });
    host.innerHTML = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, bucket]) => {
      const byEmp = new Map();
      bucket.roster.forEach((r) => byEmp.set(r.empId, { roster: r, rows: [] }));
      bucket.rows.sort((a, b) => clean(a.empName).localeCompare(clean(b.empName)) || a.priority - b.priority || clean(a.machineNo).localeCompare(clean(b.machineNo))).forEach((r) => { if (!byEmp.has(r.empId)) byEmp.set(r.empId, { roster: { empId: r.empId, empName: r.empName, empDept: r.empDept, shiftName: r.shiftName }, rows: [] }); byEmp.get(r.empId).rows.push(r); });
      const notes = bucket.notes.map((n) => `<div class="complete-note">P${esc(n.priority)} | ${esc(n.machineNo)} | ${esc(n.typeName)} — ${esc(n.message)}</div>`).join("");
      const blocked = bucket.blocked.map((n) => `<div class="blocked-note">P${esc(n.priority)} | ${esc(n.machineNo)} | ${esc(n.work)} / ${esc(n.subwork)} blocked. Depends on: ${esc(n.reason)}</div>`).join("");
      const empHtml = [...byEmp.values()].sort((a, b) => clean(a.roster.empName).localeCompare(clean(b.roster.empName))).map((emp) => { const rows = emp.rows, first = emp.roster, totalPlan = rows.reduce((s, x) => s + x.planMinutes, 0); const table = rows.length ? `<div class="table-host"><table class="cap-table"><thead><tr><th>Shift</th><th>Priority</th><th>Machine No.</th><th>Type</th><th>Work</th><th>Subwork</th><th>Std Min</th><th>Plan Min</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.map(rowPlanHtml).join("")}</tbody></table></div>` : `<div class="empty-state">No work assigned for this employee on this date.</div>`; return `<div class="employee-card"><div class="employee-head"><div><div class="employee-name">${esc(first.empId)} - ${esc(first.empName)}</div><div class="employee-meta">${esc(first.empDept || "No department")} | ${esc(first.shiftName || "Shift")}</div></div><div class="employee-meta">Day Load: ${fmtHr(totalPlan)}</div></div>${table}</div>`; }).join("");
      return `<div class="date-plan-card"><div class="date-title">${dateText(date)} — ${fmtHr(bucket.rows.reduce((s, x) => s + x.planMinutes, 0))}</div>${notes}${blocked}${empHtml || `<div class="empty-state">No selected employees available on this date.</div>`}</div>`;
    }).join("");
  }

  function rowPlanHtml(a) { const cls = key(a.confidence).replace(/\s+/g, "") || "noskill", status = a.machineComplete ? "Machine completed after this work" : a.overtime ? `OT | ${a.confidence} | H${a.historyCount}` : `${a.confidence} | H${a.historyCount}`, statusClass = a.machineComplete ? "complete" : a.overtime ? "ot" : cls === "noskill" ? "noskill" : cls; return `<tr><td>${esc(a.shiftName)}${a.overtime ? " (OT)" : ""}</td><td>${esc(a.priority)}</td><td>${esc(a.machineNo)}</td><td>${esc(a.typeName)}</td><td>${esc(a.work)}</td><td>${esc(a.subwork)}</td><td>${fmtMin(a.stdMinutes)}</td><td>${fmtMin(a.planMinutes)}</td><td>${fmtMin(a.balanceMinutes)}</td><td><span class="badge ${statusClass}">${esc(status)}</span></td></tr>`; }

  function planText() { if (!state.plan?.assignments?.length && !state.plan?.completionNotes?.length && !state.plan?.blockedNotes?.length) return "No production plan generated."; const lines = ["SP WorkTrack - Date-wise Employee Production Plan", `Period: ${dateText($("fromDate").value)} to ${dateText($("toDate").value)}`, `Progress considered up to: ${dateText(progressCutoffDate())}`, ""]; const byDate = new Map(); (state.plan.dates || []).forEach((d) => byDate.set(d, { rows: [], notes: [], blocked: [], roster: state.plan.dateRoster.get(d) || [] })); state.plan.assignments.forEach((a) => byDate.get(a.date)?.rows.push(a)); state.plan.completionNotes.forEach((n) => byDate.get(n.date)?.notes.push(n)); state.plan.blockedNotes.forEach((n) => { const d = state.plan.dates[state.plan.dates.length - 1] || $("toDate").value; byDate.get(d)?.blocked.push(n); }); byDate.forEach((bucket, date) => { lines.push(dateText(date)); bucket.notes.forEach((n) => lines.push(`  P${n.priority} | ${n.machineNo} | ${n.typeName} | ${n.message}`)); bucket.blocked.forEach((n) => lines.push(`  BLOCKED: P${n.priority} | ${n.machineNo} | ${n.work} | ${n.subwork} | Depends on ${n.reason}`)); const byEmp = new Map(); bucket.roster.forEach((r) => byEmp.set(r.empId, [])); bucket.rows.forEach((a) => { if (!byEmp.has(a.empId)) byEmp.set(a.empId, []); byEmp.get(a.empId).push(a); }); byEmp.forEach((rows, empId) => { const name = rows[0]?.empName || bucket.roster.find((r) => r.empId === empId)?.empName || ""; lines.push(`  ${empId} - ${name}`); if (!rows.length) lines.push("    No work assigned"); rows.sort((a, b) => a.priority - b.priority || clean(a.machineNo).localeCompare(clean(b.machineNo))).forEach((r) => lines.push(`    ${r.shiftName}${r.overtime ? " OT" : ""} | P${r.priority} | ${r.machineNo} | ${r.typeName} | ${r.work} | ${r.subwork} | Std ${fmtMin(r.stdMinutes)} | Plan ${fmtMin(r.planMinutes)} | ${r.confidence} H${r.historyCount}${r.machineComplete ? " | MACHINE COMPLETED" : ""}`)); }); lines.push(""); }); return lines.join("\n"); }

  function savePlan() { const data = { version: 3, savedAt: new Date().toISOString(), fromDate: $("fromDate").value, toDate: $("toDate").value, targetMonth: $("targetMonth").value, otMaxMinutes: $("otMaxMinutes").value, sequenceMode: $("sequenceMode").value, seq: state.seq, shiftSeq: state.shiftSeq, demand: state.demand, targets: state.targets, dependencies: state.dependencies, shiftPlans: state.shiftPlans, overtimeEmpIds: state.overtimeEmpIds }; localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); alert("Capacity plan saved. Targets, shifts, OT preference, demand and dependencies will reload after refresh; plan will recalculate from latest production entries."); }
  function restoreSavedPlanOnce() { if (state.restored) return; state.restored = true; try { const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("spwt_capacity_plan_v2"); if (!raw) return; const data = JSON.parse(raw); if (data?.fromDate) $("fromDate").value = data.fromDate; if (data?.toDate) $("toDate").value = data.toDate; if (data?.targetMonth) $("targetMonth").value = data.targetMonth; if (data?.otMaxMinutes) $("otMaxMinutes").value = data.otMaxMinutes; if (data?.sequenceMode) $("sequenceMode").value = data.sequenceMode; state.demand = Array.isArray(data?.demand) ? data.demand : []; state.targets = Array.isArray(data?.targets) ? data.targets : []; state.dependencies = Array.isArray(data?.dependencies) ? data.dependencies : []; state.shiftPlans = Array.isArray(data?.shiftPlans) ? data.shiftPlans : []; state.overtimeEmpIds = Array.isArray(data?.overtimeEmpIds) ? data.overtimeEmpIds : []; state.seq = Math.max(num(data?.seq, 1), ...state.demand.map((d) => num(d.seq, 0) + 1), 1); state.shiftSeq = Math.max(num(data?.shiftSeq, 1), state.shiftPlans.length + 1, 1); } catch (err) { console.warn("Saved capacity plan restore failed", err); } }
  async function copyPlan() { const text = planText(); await navigator.clipboard?.writeText(text).catch(() => null); alert("Production plan copied. You can paste it in email/WhatsApp/report."); }

  function renderAll() { renderTargets(); renderShiftAssignments(); renderOvertime(); renderDependencies(); renderCapacity(); renderDemand(); renderRequirement(); renderResult(); renderPlan(); window.SPWT?.styleActionButtons?.(); }
  function recalc() { state.plan = null; renderAll(); }
  function wire() {
    $("fromDate").value = today(0); $("toDate").value = today(6); $("targetMonth").value = currentMonth();
    $("refreshBtn").onclick = loadData; $("savePlanBtn").onclick = savePlan; $("addShiftBtn").onclick = addShift; $("addTargetBtn").onclick = addTarget; $("addDemandBtn").onclick = addDemand; $("addDependencyBtn").onclick = addDependency; $("generatePlanBtn").onclick = generatePlan; $("printPlanBtn").onclick = () => window.print(); $("copyPlanBtn").onclick = copyPlan;
    $("fromDate").onchange = loadData; $("targetMonth").onchange = loadData; ["toDate", "otMaxMinutes", "sequenceMode"].forEach((id) => $(id).onchange = recalc);
    ["depTypeSelect", "depWorkSelect", "depOnWorkSelect"].forEach((id) => { if ($(id)) $(id).onchange = () => { renderDependencySelectors(); }; });
  }
  document.addEventListener("DOMContentLoaded", () => { wire(); loadData(); });
})();
