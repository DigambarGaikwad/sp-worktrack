// renderer/capacity/capacity.js
// Clean client-side capacity planning workspace. Reads current DB APIs only.

(function () {
  const API = window.SPWT_CONFIG?.API_BASE_URL || window.location.origin || "http://localhost:3032";
  const DEFAULT_MIN = 465;
  const STORAGE_KEY = "spwt_capacity_plan_v1";
  const $ = (id) => document.getElementById(id);
  const state = { master: {}, absences: [], skills: [], progress: [], demand: [], plan: null, seq: 1, restored: false };

  const clean = (v) => String(v ?? "").trim();
  const key = (v) => clean(v).toLowerCase();
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = (v) => clean(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const fmtMin = (m) => `${Math.round(num(m, 0))} min`;
  const fmtHr = (m) => `${(num(m, 0) / 60).toFixed(1)} h`;
  const dateText = (d) => d ? d.split("-").reverse().join("/") : "-";
  const makeId = () => (crypto?.randomUUID ? crypto.randomUUID() : `cap_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  function today(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return dateKey(d);
  }

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return null;
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDaysIso(value, days) {
    const d = parseDate(value);
    if (!d) return "";
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }

  function progressCutoffDate() {
    return addDaysIso($("fromDate")?.value || today(), -1);
  }

  function workingDates() {
    const from = parseDate($("fromDate").value);
    const to = parseDate($("toDate").value);
    if (!from || !to || from > to) return [];
    const dates = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0) dates.push(dateKey(d));
    }
    return dates;
  }

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
      const [master, absences, skillData, progressData] = await Promise.all([
        api("/api/admin/master-data"),
        api("/api/admin/planned-absences").catch(() => []),
        api("/api/admin/skill-matrix").catch(() => ({ records: [] })),
        api(`/api/capacity/progress?cutoff_date=${encodeURIComponent(cutoff)}`).catch(() => ({ records: [], cutoffDate: cutoff }))
      ]);
      state.master = master || {};
      state.absences = Array.isArray(absences) ? absences : [];
      state.skills = Array.isArray(skillData?.records) ? skillData.records : [];
      state.progress = Array.isArray(progressData?.records) ? progressData.records : [];
      populateControls();
      restoreSavedPlanOnce();
      if (state.demand.length) generatePlan({ render: false });
      else state.plan = null;
      renderAll();
    } catch (err) {
      showError(err.message || err);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(isBusy) {
    ["refreshBtn", "savePlanBtn", "addDemandBtn", "generatePlanBtn"].forEach((id) => { if ($(id)) $(id).disabled = isBusy; });
  }

  function showError(message) {
    $("warningBox").className = "warning-box";
    $("warningBox").textContent = `Capacity planning data load issue: ${message}`;
  }

  function populateControls() {
    const currentShift = $("shiftSelect")?.value;
    const shifts = (state.master.shifts || []).filter((x) => x.active !== false);
    $("shiftSelect").innerHTML = shifts.map((s) => `<option value="${esc(s.id || s.name)}">${esc(s.name)} (${esc(s.start || "")}-${esc(s.end || "")})</option>`).join("") || `<option value="General">General</option>`;
    if (currentShift && [...$("shiftSelect").options].some((o) => o.value === currentShift)) $("shiftSelect").value = currentShift;

    const types = state.master.machineTypes || [];
    $("machineTypeSelect").innerHTML = types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  }

  function selectedShiftMinutes() {
    const id = $("shiftSelect").value;
    const s = (state.master.shifts || []).find((x) => clean(x.id || x.name) === id);
    if (!s) return DEFAULT_MIN;
    const start = timeMin(s.start), end = timeMin(s.end);
    if (start == null || end == null) return DEFAULT_MIN;
    let gross = end - start;
    if (gross < 0) gross += 1440;
    return Math.max(gross - num(s.breakMinutes, 0), 0) || DEFAULT_MIN;
  }

  function timeMin(value) {
    const m = clean(value).match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function employeeMinutes(emp) {
    return num(emp.availableMinutesDay, 0) || selectedShiftMinutes() || DEFAULT_MIN;
  }

  function activeEmployees() {
    return (state.master.employees || []).filter((e) => e.active !== false && clean(e.empId));
  }

  function absentSet(date) {
    const set = new Set();
    state.absences.forEach((a) => {
      const dates = Array.isArray(a.plannedDates) ? a.plannedDates : [];
      if (dates.includes(date)) set.add(key(a.emp_code || a.empCode || a.empId));
    });
    return set;
  }

  function activeMachinesByType(typeId) {
    return (state.master.machines || [])
      .filter((m) => m.active !== false && key(m.status || "Active") === "active" && key(m.type) === key(typeId))
      .map((m) => clean(m.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  function usedMachineNos(typeId) {
    return new Set(state.demand.filter((d) => key(d.typeId) === key(typeId)).map((d) => clean(d.machineNo)).filter((x) => x && x !== "No number given yet"));
  }

  function addDemand() {
    const typeId = $("machineTypeSelect").value;
    const typeName = $("machineTypeSelect").selectedOptions[0]?.textContent || typeId;
    const qty = Math.max(1, Math.round(num($("machineQty").value, 1)));
    const priority = Math.max(1, Math.round(num($("priorityNo").value, 1)));
    const targetDate = clean($("targetDate").value);
    if (!typeId) return;

    const used = usedMachineNos(typeId);
    const pool = activeMachinesByType(typeId).filter((m) => !used.has(m));

    for (let i = 0; i < qty; i += 1) {
      const machineNo = pool.shift() || "No number given yet";
      if (machineNo !== "No number given yet") used.add(machineNo);
      state.demand.push({ id: makeId(), seq: state.seq++, priority, typeId, typeName, machineNo, targetDate });
    }

    $("priorityNo").value = String(priority + 1);
    state.plan = null;
    renderAll();
  }

  function demandSorted() {
    return [...state.demand].sort((a, b) => num(a.priority, 9999) - num(b.priority, 9999) || clean(a.targetDate).localeCompare(clean(b.targetDate)) || num(a.seq) - num(b.seq));
  }

  function workCatalog(typeId) {
    return state.master.workCatalogByType?.[typeId] || { mainWorks: [], subWorks: {} };
  }

  function progressKey(machineNo, type, dept, subwork) {
    return [machineNo, type, dept, subwork].map(key).join("|");
  }

  function buildProgressMap() {
    const map = new Map();
    state.progress.forEach((p) => {
      const machineNo = clean(p.machine_no);
      const dept = clean(p.department_name);
      const subwork = clean(p.subwork_name);
      const consumed = num(p.consumed_standard_minutes, 0);
      if (!machineNo || !dept || !subwork || consumed <= 0) return;
      [p.machine_type_code, p.machine_type_name].map(clean).filter(Boolean).forEach((type) => {
        const k = progressKey(machineNo, type, dept, subwork);
        map.set(k, Math.max(num(map.get(k), 0), consumed));
      });
    });
    return map;
  }

  function progressFor(progressMap, machineNo, typeId, typeName, dept, subwork) {
    if (!machineNo || machineNo === "No number given yet") return 0;
    return Math.max(
      num(progressMap.get(progressKey(machineNo, typeId, dept, subwork)), 0),
      num(progressMap.get(progressKey(machineNo, typeName, dept, subwork)), 0)
    );
  }

  function buildTasks() {
    const tasks = [];
    const progressMap = buildProgressMap();
    demandSorted().forEach((d) => {
      const cat = workCatalog(d.typeId);
      (cat.mainWorks || []).forEach((dept) => {
        (cat.subWorks?.[dept] || []).forEach((sw, idx) => {
          const std = num(sw.standardTime, 0);
          if (std <= 0) return;
          const completedBeforeStd = Math.min(std, progressFor(progressMap, d.machineNo, d.typeId, d.typeName, dept, sw.name));
          tasks.push({
            id: `${d.id}|${dept}|${sw.name}|${idx}`,
            demandId: d.id,
            priority: num(d.priority, 9999),
            seq: d.seq,
            targetDate: d.targetDate,
            machineNo: d.machineNo,
            typeId: d.typeId,
            typeName: d.typeName,
            dept,
            subwork: sw.name,
            stdMinutes: std,
            completedBeforeStd,
            remainingStd: Math.max(0, std - completedBeforeStd)
          });
        });
      });
    });
    return tasks;
  }

  function tasksByDemand(tasks) {
    const map = new Map();
    tasks.forEach((t) => {
      if (!map.has(t.demandId)) map.set(t.demandId, []);
      map.get(t.demandId).push(t);
    });
    return map;
  }

  function demandStatusMap(tasks = buildTasks()) {
    const map = new Map();
    tasksByDemand(tasks).forEach((items, id) => {
      const remaining = items.reduce((s, t) => s + Math.max(0, t.remainingStd), 0);
      const doneBefore = items.reduce((s, t) => s + num(t.completedBeforeStd, 0), 0);
      if (items.length && remaining <= 0.01) map.set(id, "Completed from entries");
      else if (doneBefore > 0) map.set(id, `Partial done ${fmtHr(doneBefore)}`);
      else map.set(id, "Open");
    });
    return map;
  }

  function skillKey(empCode, typeId, dept, subwork) {
    return [empCode, typeId, dept, subwork].map(key).join("|");
  }

  function buildSkillMap() {
    const map = new Map();
    state.skills.forEach((s) => {
      if (s.active === false) return;
      const emp = s.emp_code || s.empCode;
      const type = s.machine_type_code || s.machine_type_name;
      const dept = s.skill_department_name || s.department_name;
      const sub = s.subwork_name;
      if (!emp || !type || !dept || !sub) return;
      map.set(skillKey(emp, type, dept, sub), s);
    });
    return map;
  }

  function skillFor(skillMap, emp, task) {
    return skillMap.get(skillKey(emp.empId, task.typeId, task.dept, task.subwork)) ||
      skillMap.get(skillKey(emp.empId, task.typeName, task.dept, task.subwork)) || null;
  }

  function confidenceScore(skill) {
    const c = key(skill?.confidence_level || "No Skill");
    if (c === "high") return 4;
    if (c === "medium") return 3;
    if (c === "low") return 2;
    return 0;
  }

  function confidenceText(skill) {
    return skill?.confidence_level || "No Skill";
  }

  function planningEff(skill) {
    return Math.max(30, Math.min(120, num(skill?.planning_efficiency_pct, 100) || 100));
  }

  function taskSort(a, b) {
    return num(a.priority, 9999) - num(b.priority, 9999) || clean(a.targetDate).localeCompare(clean(b.targetDate)) || num(a.seq) - num(b.seq) || clean(a.dept).localeCompare(clean(b.dept)) || clean(a.subwork).localeCompare(clean(b.subwork));
  }

  function nextOpenTask(tasks) {
    return tasks.filter((t) => t.remainingStd > 0.01).sort(taskSort)[0] || null;
  }

  function bestEmployeeForTask(empStates, skillMap, task) {
    const candidates = empStates
      .filter((e) => e.available > 0.5)
      .map((e) => {
        const skill = skillFor(skillMap, e.emp, task);
        const conf = confidenceScore(skill);
        const deptMatch = key(e.emp.department) && key(e.emp.department) === key(task.dept) ? 1 : 0;
        const score = (conf * 1000) + (deptMatch * 80) + planningEff(skill) + Math.min(e.available, 999) / 1000;
        return { ...e, skill, score };
      })
      .sort((a, b) => b.score - a.score || clean(a.emp.name).localeCompare(clean(b.emp.name)));
    return candidates[0] || null;
  }

  function generatePlan(options = {}) {
    const dates = workingDates();
    const tasks = buildTasks();
    const skillMap = buildSkillMap();
    const assignments = [];
    const completionNotes = [];
    const absentDates = new Map();
    const byDemand = tasksByDemand(tasks);
    const completedDemand = new Set();

    demandSorted().forEach((d) => {
      const items = byDemand.get(d.id) || [];
      if (items.length && items.every((t) => t.remainingStd <= 0.01)) {
        completedDemand.add(d.id);
        completionNotes.push({
          date: dates[0] || $("fromDate").value,
          priority: d.priority,
          machineNo: d.machineNo,
          typeName: d.typeName,
          message: "Machine already completed from production entries before this plan."
        });
      }
    });

    dates.forEach((date) => {
      const absent = absentSet(date);
      const empStates = activeEmployees()
        .filter((e) => !absent.has(key(e.empId)))
        .map((emp) => ({ emp, available: employeeMinutes(emp) }))
        .sort((a, b) => clean(a.emp.department).localeCompare(clean(b.emp.department)) || clean(a.emp.name).localeCompare(clean(b.emp.name)));

      while (empStates.some((e) => e.available > 0.5)) {
        const task = nextOpenTask(tasks);
        if (!task) break;
        const picked = bestEmployeeForTask(empStates, skillMap, task);
        if (!picked) break;
        const eff = planningEff(picked.skill);
        const possibleStd = picked.available * (eff / 100);
        const assignStd = Math.min(task.remainingStd, possibleStd);
        const planMin = assignStd * (100 / eff);
        if (assignStd <= 0.01 || planMin <= 0.01) break;

        task.remainingStd -= assignStd;
        picked.available -= planMin;

        const demandItems = byDemand.get(task.demandId) || [];
        const machineComplete = !completedDemand.has(task.demandId) && demandItems.length && demandItems.every((t) => t.remainingStd <= 0.01);
        if (machineComplete) completedDemand.add(task.demandId);

        assignments.push({
          date,
          empId: picked.emp.empId,
          empName: picked.emp.name,
          empDept: picked.emp.department,
          machineNo: task.machineNo,
          typeName: task.typeName,
          work: task.dept,
          subwork: task.subwork,
          priority: task.priority,
          stdMinutes: assignStd,
          planMinutes: planMin,
          balanceMinutes: picked.available,
          confidence: confidenceText(picked.skill),
          planningEff: eff,
          targetDate: task.targetDate,
          machineComplete
        });
      }

      state.absences.forEach((a) => {
        if ((a.plannedDates || []).includes(date)) {
          const emp = clean(a.emp_code || a.empCode || a.empId);
          if (!absentDates.has(emp)) absentDates.set(emp, []);
          absentDates.get(emp).push(date);
        }
      });
    });

    const remainingStd = tasks.reduce((s, t) => s + Math.max(0, t.remainingStd), 0);
    state.plan = { dates, tasks, assignments, completionNotes, remainingStd, doneMachines: completedDemand.size, totalMachines: state.demand.length, absentDates };
    if (options.render !== false) renderAll();
  }

  function summarizeCapacity() {
    const dates = workingDates();
    let totalMin = 0;
    let absentCount = 0;
    dates.forEach((date) => {
      const absent = absentSet(date);
      absentCount += absent.size;
      activeEmployees().forEach((e) => { if (!absent.has(key(e.empId))) totalMin += employeeMinutes(e); });
    });
    return { dates, totalEmployees: activeEmployees().length, absentCount, totalMin };
  }

  function requirementSummary(tasks = buildTasks()) {
    const map = new Map();
    tasks.forEach((t) => {
      const old = map.get(t.dept) || { dept: t.dept, required: 0, completedBefore: 0, subworks: new Set() };
      old.required += Math.max(0, t.remainingStd);
      old.completedBefore += num(t.completedBeforeStd, 0);
      old.subworks.add(t.subwork);
      map.set(t.dept, old);
    });
    return [...map.values()].sort((a, b) => a.dept.localeCompare(b.dept));
  }

  function metric(label, value, tone = "") {
    return `<div class="metric-card"><div class="metric-label">${esc(label)}</div><div class="metric-value ${tone}">${esc(value)}</div></div>`;
  }

  function renderCapacity() {
    const c = summarizeCapacity();
    $("workDays").value = String(c.dates.length);
    $("capacityMetrics").innerHTML = [
      metric("Active Employees", c.totalEmployees),
      metric("Planned Absent Days", c.absentCount),
      metric("Available Hours", fmtHr(c.totalMin), c.totalMin ? "green" : "red")
    ].join("");
  }

  function renderDemand() {
    if (!state.demand.length) {
      $("demandTable").innerHTML = `<div class="empty-state">No machine demand added yet.</div>`;
      return;
    }
    const statusMap = demandStatusMap();
    const rows = demandSorted().map((d) => `
      <tr>
        <td><input class="inline-input demand-priority" data-id="${d.id}" type="number" min="1" value="${esc(d.priority)}" /></td>
        <td>${esc(d.machineNo)}</td>
        <td>${esc(d.typeName)}</td>
        <td><input class="inline-input demand-target" data-id="${d.id}" type="date" value="${esc(d.targetDate)}" /></td>
        <td>${esc(statusMap.get(d.id) || "Open")}</td>
        <td>${esc(d.seq)}</td>
        <td><button class="remove-btn" data-remove="${d.id}" type="button">Remove</button></td>
      </tr>`).join("");
    $("demandTable").innerHTML = `<table class="cap-table"><thead><tr><th>Priority No.</th><th>Machine No.</th><th>Type</th><th>Target Date</th><th>Progress</th><th>Seq</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.querySelectorAll(".demand-priority").forEach((el) => el.oninput = () => updateDemand(el.dataset.id, { priority: Math.max(1, Math.round(num(el.value, 1))) }));
    document.querySelectorAll(".demand-target").forEach((el) => el.onchange = () => updateDemand(el.dataset.id, { targetDate: el.value }));
    document.querySelectorAll("[data-remove]").forEach((el) => el.onclick = () => removeDemand(el.dataset.remove));
  }

  function updateDemand(id, patch) {
    state.demand = state.demand.map((d) => d.id === id ? { ...d, ...patch } : d);
    state.plan = null;
    renderAll();
  }

  function removeDemand(id) {
    state.demand = state.demand.filter((d) => d.id !== id);
    state.plan = null;
    renderAll();
  }

  function renderRequirement() {
    const items = requirementSummary();
    if (!items.length) {
      $("requirementTable").innerHTML = `<div class="empty-state">Add machine demand to calculate department-wise required manhours.</div>`;
      return;
    }
    const rows = items.map((x) => `<tr><td>${esc(x.dept)}</td><td>${fmtHr(x.required)}</td><td>${fmtHr(x.completedBefore)}</td><td>${x.subworks.size}</td><td>${esc([...x.subworks].slice(0, 4).join(", "))}${x.subworks.size > 4 ? "..." : ""}</td></tr>`).join("");
    $("requirementTable").innerHTML = `<table class="cap-table"><thead><tr><th>Department</th><th>Remaining Std Hrs</th><th>Done From Entries</th><th>Subworks</th><th>Critical Work Scope</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderResult() {
    const c = summarizeCapacity();
    const tasks = buildTasks();
    const originalReq = tasks.reduce((s, t) => s + t.stdMinutes, 0);
    const completedBefore = tasks.reduce((s, t) => s + num(t.completedBeforeStd, 0), 0);
    const req = tasks.reduce((s, t) => s + Math.max(0, t.remainingStd), 0);
    const remaining = state.plan ? state.plan.remainingStd : req;
    const gap = c.totalMin - req;
    $("resultMetrics").innerHTML = [
      metric("Machine Demand", state.demand.length),
      metric("Original Std Hrs", fmtHr(originalReq)),
      metric("Done From Entries", fmtHr(completedBefore), completedBefore ? "green" : ""),
      metric("Remaining Std Hrs", fmtHr(req)),
      metric("Available Hours", fmtHr(c.totalMin), c.totalMin >= req ? "green" : "orange"),
      metric("Capacity Gap", fmtHr(gap), gap >= 0 ? "green" : "red"),
      metric("Plan Completed", state.plan ? `${state.plan.doneMachines}/${state.plan.totalMachines}` : "-"),
      metric("Unplanned Std Hrs", state.plan ? fmtHr(remaining) : "-")
    ].join("");

    const box = $("warningBox");
    box.className = `warning-box ${gap >= 0 ? "ok" : ""}`;
    if (!state.demand.length) box.textContent = "Add machine demand to see shortage, overtime and multiskilling requirement.";
    else if (completedBefore > 0 && gap >= 0) box.textContent = `Production entries up to ${dateText(progressCutoffDate())} reduced the plan by ${fmtHr(completedBefore)}. Basic remaining capacity is sufficient.`;
    else if (gap >= 0) box.textContent = "Basic capacity is sufficient by remaining standard hours. Final plan still depends on skill availability and planned absences.";
    else box.textContent = `Shortage by remaining standard capacity: ${fmtHr(Math.abs(gap))}. Generate the plan to see date-wise employee gap, OT need and multiskilling requirement.`;
  }

  function renderPlan() {
    const host = $("employeePlanHost");
    if (!state.plan) {
      host.innerHTML = `<div class="empty-state">Production plan not generated yet.</div>`;
      return;
    }
    if (!state.plan.assignments.length && !state.plan.completionNotes.length) {
      host.innerHTML = `<div class="empty-state">No assignment generated. Check demand, date range, employee capacity and skill matrix.</div>`;
      return;
    }

    const byDate = new Map();
    state.plan.dates.forEach((date) => byDate.set(date, { rows: [], notes: [] }));
    state.plan.assignments.forEach((a) => {
      if (!byDate.has(a.date)) byDate.set(a.date, { rows: [], notes: [] });
      byDate.get(a.date).rows.push(a);
    });
    state.plan.completionNotes.forEach((n) => {
      if (!byDate.has(n.date)) byDate.set(n.date, { rows: [], notes: [] });
      byDate.get(n.date).notes.push(n);
    });

    host.innerHTML = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, bucket]) => {
      const rows = bucket.rows.sort((a, b) => clean(a.empName).localeCompare(clean(b.empName)) || a.priority - b.priority || clean(a.machineNo).localeCompare(clean(b.machineNo)));
      const byEmp = new Map();
      rows.forEach((r) => {
        if (!byEmp.has(r.empId)) byEmp.set(r.empId, []);
        byEmp.get(r.empId).push(r);
      });
      const notes = bucket.notes.map((n) => `<div class="complete-note">P${esc(n.priority)} | ${esc(n.machineNo)} | ${esc(n.typeName)} — ${esc(n.message)}</div>`).join("");
      const empHtml = [...byEmp.entries()].map(([empId, empRows]) => {
        const first = empRows[0];
        const totalPlan = empRows.reduce((s, x) => s + x.planMinutes, 0);
        return `<div class="employee-card"><div class="employee-head"><div><div class="employee-name">${esc(empId)} - ${esc(first.empName)}</div><div class="employee-meta">${esc(first.empDept || "No department")}</div></div><div class="employee-meta">Day Load: ${fmtHr(totalPlan)}</div></div><div class="table-host"><table class="cap-table"><thead><tr><th>Priority</th><th>Machine No.</th><th>Type</th><th>Work</th><th>Subwork</th><th>Std Min</th><th>Plan Min</th><th>Balance</th><th>Status</th></tr></thead><tbody>${empRows.map(rowPlanHtml).join("")}</tbody></table></div></div>`;
      }).join("");
      return `<div class="date-plan-card"><div class="date-title">${dateText(date)} — ${fmtHr(rows.reduce((s, x) => s + x.planMinutes, 0))}</div>${notes}${empHtml || `<div class="empty-state">No work assigned on this date.</div>`}</div>`;
    }).join("");
  }

  function rowPlanHtml(a) {
    const cls = key(a.confidence).replace(/\s+/g, "") || "noskill";
    const status = a.machineComplete ? "Machine completed after this work" : a.confidence;
    const statusClass = a.machineComplete ? "complete" : cls === "noskill" ? "noskill" : cls;
    return `<tr><td>${esc(a.priority)}</td><td>${esc(a.machineNo)}</td><td>${esc(a.typeName)}</td><td>${esc(a.work)}</td><td>${esc(a.subwork)}</td><td>${fmtMin(a.stdMinutes)}</td><td>${fmtMin(a.planMinutes)}</td><td>${fmtMin(a.balanceMinutes)}</td><td><span class="badge ${statusClass}">${esc(status)}</span></td></tr>`;
  }

  function planText() {
    if (!state.plan?.assignments?.length && !state.plan?.completionNotes?.length) return "No production plan generated.";
    const lines = ["SP WorkTrack - Date-wise Employee Production Plan", `Period: ${dateText($("fromDate").value)} to ${dateText($("toDate").value)}`, `Progress considered up to: ${dateText(progressCutoffDate())}`, ""];
    const byDate = new Map();
    (state.plan.dates || []).forEach((d) => byDate.set(d, { rows: [], notes: [] }));
    state.plan.assignments.forEach((a) => byDate.get(a.date)?.rows.push(a));
    state.plan.completionNotes.forEach((n) => byDate.get(n.date)?.notes.push(n));
    byDate.forEach((bucket, date) => {
      lines.push(dateText(date));
      bucket.notes.forEach((n) => lines.push(`  P${n.priority} | ${n.machineNo} | ${n.typeName} | ${n.message}`));
      const byEmp = new Map();
      bucket.rows.forEach((a) => {
        if (!byEmp.has(a.empId)) byEmp.set(a.empId, []);
        byEmp.get(a.empId).push(a);
      });
      byEmp.forEach((rows, empId) => {
        lines.push(`  ${empId} - ${rows[0].empName}`);
        rows.sort((a, b) => a.priority - b.priority || clean(a.machineNo).localeCompare(clean(b.machineNo))).forEach((r) => {
          lines.push(`    P${r.priority} | ${r.machineNo} | ${r.typeName} | ${r.work} | ${r.subwork} | Std ${fmtMin(r.stdMinutes)} | Plan ${fmtMin(r.planMinutes)} | ${r.confidence}${r.machineComplete ? " | MACHINE COMPLETED" : ""}`);
        });
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function savePlan() {
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      fromDate: $("fromDate").value,
      toDate: $("toDate").value,
      shift: $("shiftSelect").value,
      seq: state.seq,
      demand: state.demand
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    alert("Capacity plan saved. Demand and date range will reload after refresh; assignments will recalculate from latest production entries.");
  }

  function restoreSavedPlanOnce() {
    if (state.restored) return;
    state.restored = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.fromDate) $("fromDate").value = data.fromDate;
      if (data?.toDate) $("toDate").value = data.toDate;
      if (data?.shift && [...$("shiftSelect").options].some((o) => o.value === data.shift)) $("shiftSelect").value = data.shift;
      state.demand = Array.isArray(data?.demand) ? data.demand : [];
      state.seq = Math.max(num(data?.seq, 1), ...state.demand.map((d) => num(d.seq, 0) + 1), 1);
    } catch (err) {
      console.warn("Saved capacity plan restore failed", err);
    }
  }

  async function copyPlan() {
    const text = planText();
    await navigator.clipboard?.writeText(text).catch(() => null);
    alert("Production plan copied. You can paste it in email/WhatsApp/report.");
  }

  function renderAll() {
    renderCapacity();
    renderDemand();
    renderRequirement();
    renderResult();
    renderPlan();
    window.SPWT?.styleActionButtons?.();
  }

  function recalc() {
    state.plan = null;
    renderAll();
  }

  function wire() {
    $("fromDate").value = today(0);
    $("toDate").value = today(6);
    $("refreshBtn").onclick = loadData;
    $("savePlanBtn").onclick = savePlan;
    $("addDemandBtn").onclick = addDemand;
    $("generatePlanBtn").onclick = generatePlan;
    $("printPlanBtn").onclick = () => window.print();
    $("copyPlanBtn").onclick = copyPlan;
    $("fromDate").onchange = loadData;
    ["toDate", "shiftSelect"].forEach((id) => $(id).onchange = recalc);
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    loadData();
  });
})();
