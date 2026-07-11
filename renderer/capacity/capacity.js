// renderer/capacity/capacity.js
// Clean client-side capacity planning workspace. Reads current DB APIs only.

(function () {
  const API = window.SPWT_CONFIG?.API_BASE_URL || window.location.origin || "http://localhost:3032";
  const DEFAULT_MIN = 465;
  const $ = (id) => document.getElementById(id);
  const state = { master: {}, absences: [], skills: [], demand: [], plan: null, seq: 1 };

  const clean = (v) => String(v ?? "").trim();
  const key = (v) => clean(v).toLowerCase();
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = (v) => clean(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const fmtMin = (m) => `${Math.round(num(m, 0))} min`;
  const fmtHr = (m) => `${(num(m, 0) / 60).toFixed(1)} h`;
  const dateText = (d) => d ? d.split("-").reverse().join("/") : "-";

  function today(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return null;
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
      const [master, absences, skillData] = await Promise.all([
        api("/api/admin/master-data"),
        api("/api/admin/planned-absences").catch(() => []),
        api("/api/admin/skill-matrix").catch(() => ({ records: [] }))
      ]);
      state.master = master || {};
      state.absences = Array.isArray(absences) ? absences : [];
      state.skills = Array.isArray(skillData?.records) ? skillData.records : [];
      populateControls();
      recalc();
    } catch (err) {
      showError(err.message || err);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(isBusy) {
    ["refreshBtn", "addDemandBtn", "generatePlanBtn"].forEach((id) => { if ($(id)) $(id).disabled = isBusy; });
  }

  function showError(message) {
    $("warningBox").className = "warning-box";
    $("warningBox").textContent = `Capacity planning data load issue: ${message}`;
  }

  function populateControls() {
    const shifts = (state.master.shifts || []).filter((x) => x.active !== false);
    $("shiftSelect").innerHTML = shifts.map((s) => `<option value="${esc(s.id || s.name)}">${esc(s.name)} (${esc(s.start || "")}-${esc(s.end || "")})</option>`).join("") || `<option value="General">General</option>`;

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
      state.demand.push({ id: crypto.randomUUID(), seq: state.seq++, priority, typeId, typeName, machineNo, targetDate });
    }

    $("priorityNo").value = String(priority + 1);
    state.plan = null;
    renderAll();
  }

  function demandSorted() {
    return [...state.demand].sort((a, b) => num(a.priority, 9999) - num(b.priority, 9999) || clean(a.targetDate).localeCompare(clean(b.targetDate)) || num(a.seq) - num(b.seq));
  }

  function workCatalog(typeId) {
    const cat = state.master.workCatalogByType?.[typeId] || { mainWorks: [], subWorks: {} };
    return cat;
  }

  function buildTasks() {
    const tasks = [];
    demandSorted().forEach((d) => {
      const cat = workCatalog(d.typeId);
      (cat.mainWorks || []).forEach((dept) => {
        (cat.subWorks?.[dept] || []).forEach((sw, idx) => {
          const std = num(sw.standardTime, 0);
          if (std <= 0) return;
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
            remainingStd: std
          });
        });
      });
    });
    return tasks;
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

  function pickTask(emp, tasks, skillMap) {
    const open = tasks.filter((t) => t.remainingStd > 0.01).sort(taskSort);
    const skilled = open
      .map((t) => ({ task: t, skill: skillFor(skillMap, emp, t) }))
      .filter((x) => confidenceScore(x.skill) > 0)
      .sort((a, b) => taskSort(a.task, b.task) || confidenceScore(b.skill) - confidenceScore(a.skill));
    if (skilled.length) return skilled[0];
    return open.length ? { task: open[0], skill: null } : null;
  }

  function generatePlan() {
    const dates = workingDates();
    const tasks = buildTasks();
    const skillMap = buildSkillMap();
    const assignments = [];
    const absentDates = new Map();

    dates.forEach((date) => {
      const absent = absentSet(date);
      activeEmployees()
        .filter((e) => !absent.has(key(e.empId)))
        .sort((a, b) => clean(a.department).localeCompare(clean(b.department)) || clean(a.name).localeCompare(clean(b.name)))
        .forEach((emp) => {
          let available = employeeMinutes(emp);
          while (available > 0.5) {
            const picked = pickTask(emp, tasks, skillMap);
            if (!picked) break;
            const eff = planningEff(picked.skill);
            const possibleStd = available * (eff / 100);
            const assignStd = Math.min(picked.task.remainingStd, possibleStd);
            const planMin = assignStd * (100 / eff);
            if (assignStd <= 0.01 || planMin <= 0.01) break;
            picked.task.remainingStd -= assignStd;
            available -= planMin;
            assignments.push({
              date,
              empId: emp.empId,
              empName: emp.name,
              empDept: emp.department,
              machineNo: picked.task.machineNo,
              typeName: picked.task.typeName,
              work: picked.task.dept,
              subwork: picked.task.subwork,
              priority: picked.task.priority,
              stdMinutes: assignStd,
              planMinutes: planMin,
              balanceMinutes: available,
              confidence: confidenceText(picked.skill),
              planningEff: eff,
              targetDate: picked.task.targetDate
            });
          }
        });

      state.absences.forEach((a) => {
        if ((a.plannedDates || []).includes(date)) {
          const emp = clean(a.emp_code || a.empCode || a.empId);
          if (!absentDates.has(emp)) absentDates.set(emp, []);
          absentDates.get(emp).push(date);
        }
      });
    });

    const remainingStd = tasks.reduce((s, t) => s + Math.max(0, t.remainingStd), 0);
    const doneDemand = new Set(tasks.filter((t) => t.remainingStd <= 0.01).map((t) => t.demandId));
    state.plan = { dates, tasks, assignments, remainingStd, doneMachines: doneDemand.size, totalMachines: state.demand.length, absentDates };
    renderAll();
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
      const old = map.get(t.dept) || { dept: t.dept, required: 0, subworks: new Set() };
      old.required += t.stdMinutes;
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
    const rows = demandSorted().map((d) => `
      <tr>
        <td><input class="inline-input demand-priority" data-id="${d.id}" type="number" min="1" value="${esc(d.priority)}" /></td>
        <td>${esc(d.machineNo)}</td>
        <td>${esc(d.typeName)}</td>
        <td><input class="inline-input demand-target" data-id="${d.id}" type="date" value="${esc(d.targetDate)}" /></td>
        <td>${esc(d.seq)}</td>
        <td><button class="remove-btn" data-remove="${d.id}" type="button">Remove</button></td>
      </tr>`).join("");
    $("demandTable").innerHTML = `<table class="cap-table"><thead><tr><th>Priority No.</th><th>Machine No.</th><th>Type</th><th>Target Date</th><th>Seq</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    const rows = items.map((x) => `<tr><td>${esc(x.dept)}</td><td>${fmtHr(x.required)}</td><td>${x.subworks.size}</td><td>${esc([...x.subworks].slice(0, 4).join(", "))}${x.subworks.size > 4 ? "..." : ""}</td></tr>`).join("");
    $("requirementTable").innerHTML = `<table class="cap-table"><thead><tr><th>Department</th><th>Required Std Hours</th><th>Subworks</th><th>Critical Work Scope</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderResult() {
    const c = summarizeCapacity();
    const req = buildTasks().reduce((s, t) => s + t.stdMinutes, 0);
    const remaining = state.plan ? state.plan.remainingStd : req;
    const gap = c.totalMin - req;
    $("resultMetrics").innerHTML = [
      metric("Machine Demand", state.demand.length),
      metric("Required Std Hours", fmtHr(req)),
      metric("Available Hours", fmtHr(c.totalMin), c.totalMin >= req ? "green" : "orange"),
      metric("Capacity Gap", fmtHr(gap), gap >= 0 ? "green" : "red"),
      metric("Plan Completed", state.plan ? `${state.plan.doneMachines}/${state.plan.totalMachines}` : "-"),
      metric("Unplanned Std Hrs", state.plan ? fmtHr(remaining) : "-")
    ].join("");

    const box = $("warningBox");
    box.className = `warning-box ${gap >= 0 ? "ok" : ""}`;
    if (!state.demand.length) box.textContent = "Add machine demand to see shortage, overtime and multiskilling requirement.";
    else if (gap >= 0) box.textContent = "Basic capacity is sufficient by standard hours. Final plan still depends on skill availability and planned absences.";
    else box.textContent = `Shortage by standard capacity: ${fmtHr(Math.abs(gap))}. Generate the plan to see employee-wise gap, OT need and multiskilling requirement.`;
  }

  function renderPlan() {
    const host = $("employeePlanHost");
    if (!state.plan) {
      host.innerHTML = `<div class="empty-state">Production plan not generated yet.</div>`;
      return;
    }
    if (!state.plan.assignments.length) {
      host.innerHTML = `<div class="empty-state">No assignment generated. Check demand, date range, employee capacity and skill matrix.</div>`;
      return;
    }

    const byEmp = new Map();
    state.plan.assignments.forEach((a) => {
      const k = a.empId;
      if (!byEmp.has(k)) byEmp.set(k, { empId: a.empId, empName: a.empName, empDept: a.empDept, dates: new Map() });
      const emp = byEmp.get(k);
      if (!emp.dates.has(a.date)) emp.dates.set(a.date, []);
      emp.dates.get(a.date).push(a);
    });

    host.innerHTML = [...byEmp.values()].sort((a, b) => clean(a.empName).localeCompare(clean(b.empName))).map((emp) => {
      const totalPlan = [...emp.dates.values()].flat().reduce((s, x) => s + x.planMinutes, 0);
      const datesHtml = [...emp.dates.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rows]) => `
        <div class="date-segment">
          <div class="date-title">${dateText(date)} — ${fmtHr(rows.reduce((s, x) => s + x.planMinutes, 0))}</div>
          <table class="cap-table">
            <thead><tr><th>Priority</th><th>Machine No.</th><th>Type</th><th>Work</th><th>Subwork</th><th>Std Min</th><th>Plan Min</th><th>Balance</th><th>Confidence</th></tr></thead>
            <tbody>${rows.map(rowPlanHtml).join("")}</tbody>
          </table>
        </div>`).join("");
      return `<div class="employee-card"><div class="employee-head"><div><div class="employee-name">${esc(emp.empId)} - ${esc(emp.empName)}</div><div class="employee-meta">${esc(emp.empDept || "No department")}</div></div><div class="employee-meta">Total Load: ${fmtHr(totalPlan)}</div></div>${datesHtml}</div>`;
    }).join("");
  }

  function rowPlanHtml(a) {
    const cls = key(a.confidence).replace(/\s+/g, "") || "noskill";
    return `<tr><td>${esc(a.priority)}</td><td>${esc(a.machineNo)}</td><td>${esc(a.typeName)}</td><td>${esc(a.work)}</td><td>${esc(a.subwork)}</td><td>${fmtMin(a.stdMinutes)}</td><td>${fmtMin(a.planMinutes)}</td><td>${fmtMin(a.balanceMinutes)}</td><td><span class="badge ${cls === "noskill" ? "noskill" : cls}">${esc(a.confidence)}</span></td></tr>`;
  }

  function planText() {
    if (!state.plan?.assignments?.length) return "No production plan generated.";
    const lines = ["SP WorkTrack - Employee-wise Production Plan", `Period: ${dateText($("fromDate").value)} to ${dateText($("toDate").value)}`, ""];
    const byEmp = new Map();
    state.plan.assignments.forEach((a) => {
      if (!byEmp.has(a.empId)) byEmp.set(a.empId, []);
      byEmp.get(a.empId).push(a);
    });
    byEmp.forEach((rows, empId) => {
      lines.push(`${empId} - ${rows[0].empName}`);
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority).forEach((r) => {
        lines.push(`  ${dateText(r.date)} | P${r.priority} | ${r.machineNo} | ${r.typeName} | ${r.work} | ${r.subwork} | Std ${fmtMin(r.stdMinutes)} | Plan ${fmtMin(r.planMinutes)} | ${r.confidence}`);
      });
      lines.push("");
    });
    return lines.join("\n");
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
    $("addDemandBtn").onclick = addDemand;
    $("generatePlanBtn").onclick = generatePlan;
    $("printPlanBtn").onclick = () => window.print();
    $("copyPlanBtn").onclick = copyPlan;
    ["fromDate", "toDate", "shiftSelect"].forEach((id) => $(id).onchange = recalc);
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    loadData();
  });
})();
