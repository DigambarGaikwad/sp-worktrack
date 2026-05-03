// renderer/app.js (STABLE BUILD - prevents double listeners + prevents multi popups + smooth typing)

// ===================== DATA STATE =====================
let machines = [];
let employees = [];
let shifts = [];
let mainWorks = [];      // ["Tubing","Mechanical",...]
let subWorksMap = {};    // { Tubing:[{name,standardTime},...], ... }

// NEW
let machineTypes = [];         // [{id,name},...]
let workCatalogByType = {};    // { typeId: { mainWorks:[], subWorks:{} }, ... }

let workCount = 0;

let adminOverrides = null;
let isAdminLoggedIn = false;

// Admin Work tab state (type-wise)
let selectedTypeForWorkEdit = "";
let selectedDeptForTypeEdit = "";

// Locks to prevent double actions
let isSubmitting = false;
let isAdminSaving = false;

// Prevent duplicate wiring
let uiWired = false;

// Debounce for smooth input typing
let summaryTimer = null;
function updateSummaryDebounced() {
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    try { updateSummary(); } catch (e) { console.error(e); }
  }, 80);
}

// ===================== INIT =====================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadData();
    setCurrentDate();
    populateHeaderDropdowns();
    wireButtonsOnce();

    // start with 1 card
    resetWorkCards(1);
    updateSummary();
  } catch (e) {
    console.error(e);
    alert("Data load error. Please check your JSON files.\n\n" + (e?.message || e));
  }
});

// ===================== LOAD DATA =====================
async function loadData() {
  // Base JSON (kept for fallback compatibility)
  machines = await fetch("data/machines.json").then(r => r.json());
  employees = await fetch("data/employees.json").then(r => r.json());
  shifts = await fetch("data/shifts.json").then(r => r.json());

  mainWorks = await fetch("data/mainWorks.json").then(r => r.json());
  subWorksMap = await fetch("data/subWorks.json").then(r => r.json());

  // Admin overrides (electron)
  adminOverrides = await window.api.getAdminOverrides();

  applyOverrides();
}

function applyOverrides() {
  if (!adminOverrides) return;

  // apply lists
  if (Array.isArray(adminOverrides.machines) && adminOverrides.machines.length) machines = adminOverrides.machines;
  if (Array.isArray(adminOverrides.employees) && adminOverrides.employees.length) employees = adminOverrides.employees;
  if (Array.isArray(adminOverrides.shifts) && adminOverrides.shifts.length) shifts = adminOverrides.shifts;

  // Work/SubWork overrides (global/fallback)
  if (Array.isArray(adminOverrides.mainWorks) && adminOverrides.mainWorks.length) mainWorks = adminOverrides.mainWorks;
  if (adminOverrides.subWorks && Object.keys(adminOverrides.subWorks).length) subWorksMap = adminOverrides.subWorks;

  // Clean dangerous empty dept key ""
  if (subWorksMap && typeof subWorksMap === "object" && Object.prototype.hasOwnProperty.call(subWorksMap, "")) {
    delete subWorksMap[""];
  }

  // Machine types
  if (Array.isArray(adminOverrides.machineTypes) && adminOverrides.machineTypes.length) {
    machineTypes = adminOverrides.machineTypes;
  } else {
    machineTypes = [
      { id: "Online", name: "Online" },
      { id: "Booster-AirCooled", name: "Booster - Air Cooled" },
      { id: "Booster-WaterCooled", name: "Booster - Water Cooled" },
      { id: "600SCMC", name: "600 SCMC" },
      { id: "400SCMH", name: "400 SCMH" }
    ];
  }

  // Type-wise catalog
  if (adminOverrides.workCatalogByType && typeof adminOverrides.workCatalogByType === "object") {
    workCatalogByType = adminOverrides.workCatalogByType;
  } else {
    workCatalogByType = {};
  }

  // Clean empty dept key inside each catalog too
  Object.keys(workCatalogByType || {}).forEach(typeId => {
    const cat = workCatalogByType[typeId];
    if (cat?.subWorks && typeof cat.subWorks === "object" && Object.prototype.hasOwnProperty.call(cat.subWorks, "")) {
      delete cat.subWorks[""];
    }
  });
}

// ===================== DATE =====================
function setCurrentDate() {
  const today = new Date();
  const formatted = today.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const currentDateEl = document.getElementById("currentDate");
  if (currentDateEl) currentDateEl.innerText = formatted;

  const workDate = document.getElementById("workDate");
  if (workDate) workDate.valueAsDate = today;
}

// ===================== HEADER DROPDOWNS =====================
function populateHeaderDropdowns() {
  // Shifts
  const shiftSelect = document.getElementById("shiftSelect");
  if (shiftSelect) {
    shiftSelect.innerHTML = `<option value="">Select Shift</option>`;
    shifts
      .filter(s => s.active !== false)
      .forEach((s) => {
        const opt = document.createElement("option");
        opt.value = String(s.id ?? s.name);
        opt.textContent = `${s.name} (${s.start}-${s.end})`;
        shiftSelect.appendChild(opt);
      });

    // IMPORTANT: use onchange to avoid duplicate listeners
    shiftSelect.onchange = updateSummaryDebounced;
  }

  // Employees
  const employeeSelect = document.getElementById("employeeSelect");
  if (employeeSelect) {
    employeeSelect.innerHTML = `<option value="">Select Team Member</option>`;
    employees
      .filter(e => e.active !== false)
      .forEach((e) => {
        const opt = document.createElement("option");
        opt.value = e.empId;
        opt.textContent = `${e.empId} - ${e.name}`;
        employeeSelect.appendChild(opt);
      });
  }

  // IMPORTANT: use onchange to avoid duplicate listeners
  const workTypeTop = document.getElementById("workTypeTop");
  if (workTypeTop) workTypeTop.onchange = updateSummaryDebounced;

  const workDate = document.getElementById("workDate");
  if (workDate) workDate.onchange = updateSummaryDebounced;

  updateSummary();
}

// ===================== BUTTONS (WIRE ONCE) =====================
function wireButtonsOnce() {
  if (uiWired) return;
  uiWired = true;

  // Work add/delete
  const add1 = document.getElementById("addWorkBtn");
  if (add1) add1.onclick = () => addWorkCard();

  const add2 = document.getElementById("addWorkBtnBottom");
  if (add2) add2.onclick = () => addWorkCard();

  const delLast = document.getElementById("deleteLastBtn");
  if (delLast) delLast.onclick = () => deleteLastWorkCard();

  // Save/Submit
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.onclick = () => saveLocal();

  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) submitBtn.onclick = () => submit();

  // About modal
  const aboutBtn = document.getElementById("aboutBtn");
  if (aboutBtn) aboutBtn.onclick = () => document.getElementById("aboutModal")?.classList.remove("hidden");

  const aboutCloseBtn = document.getElementById("aboutCloseBtn");
  if (aboutCloseBtn) aboutCloseBtn.onclick = () => document.getElementById("aboutModal")?.classList.add("hidden");

    const dashBtn = document.getElementById("dashboardBtn");
  if (dashBtn) dashBtn.onclick = () => {
    window.location.href = "renderer/dashboard_v2/dashboard.html";
  };

  // Admin open/close
  const settings = document.querySelector(".settings");
  if (settings) settings.onclick = () => openAdminModal();

  const adminCloseBtn = document.getElementById("adminCloseBtn");
  if (adminCloseBtn) adminCloseBtn.onclick = () => closeAdminModal();

  const adminCancelBtn = document.getElementById("adminCancelBtn");
  if (adminCancelBtn) adminCancelBtn.onclick = () => closeAdminModal();

  // Admin login/logout/save/pin
  const adminLoginBtn = document.getElementById("adminLoginBtn");
  if (adminLoginBtn) adminLoginBtn.onclick = () => adminLogin();

  const adminLogoutBtn = document.getElementById("adminLogoutBtn");
  if (adminLogoutBtn) adminLogoutBtn.onclick = () => adminLogout();

  const adminSaveBtn = document.getElementById("adminSaveBtn");
  if (adminSaveBtn) adminSaveBtn.onclick = () => adminSaveChanges();

  const savePinBtn = document.getElementById("savePinBtn");
  if (savePinBtn) savePinBtn.onclick = () => adminSavePin();

  // Admin add buttons
  const addMachineBtn = document.getElementById("addMachineBtn");
  if (addMachineBtn) addMachineBtn.onclick = () => adminAddMachine();

  const addEmployeeBtn = document.getElementById("addEmployeeBtn");
  if (addEmployeeBtn) addEmployeeBtn.onclick = () => adminAddEmployee();

  const addShiftBtn = document.getElementById("addShiftBtn");
  if (addShiftBtn) addShiftBtn.onclick = () => adminAddShift();

  const addTypeBtn = document.getElementById("addTypeBtn");
  if (addTypeBtn) addTypeBtn.onclick = () => adminAddType();

  const addMainWorkBtn = document.getElementById("addMainWorkBtn");
  if (addMainWorkBtn) addMainWorkBtn.onclick = () => adminAddMainWork();

  const addSubWorkBtn = document.getElementById("addSubWorkBtn");
  if (addSubWorkBtn) addSubWorkBtn.onclick = () => adminAddSubWork();

  // Tabs: wire once using event delegation
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => switchAdminTab(btn.dataset.tab);
  });

  // Summary screen actions
  const backBtn = document.getElementById("backToEntryBtn");
  if (backBtn) backBtn.onclick = () => hideSummaryScreen();

  const newEntryBtn = document.getElementById("newEntryBtn");
  if (newEntryBtn) newEntryBtn.onclick = () => {
    clearEntryAndStartNew();
    hideSummaryScreen();
  };
}

// ===================== SHIFT MINUTES =====================
function convertToMinutes(time) {
  const [h, m] = String(time || "0:0").split(":").map(Number);
  return (h * 60) + (m || 0);
}

function getShiftAvailableMinutes() {
  const shiftId = document.getElementById("shiftSelect")?.value;
  const shift = shifts.find((s) => String(s.id ?? s.name) === String(shiftId));
  if (!shift) return 0;

  const start = convertToMinutes(shift.start);
  const end = convertToMinutes(shift.end);

  let total = end - start;
  if (total < 0) total += 24 * 60; // overnight
  return total - (Number(shift.breakMinutes) || 0);
}

// ===================== WORK CARDS =====================
function resetWorkCards(count = 1) {
  const container = document.getElementById("workContainer");
  if (container) container.innerHTML = "";
  workCount = 0;
  for (let i = 0; i < count; i++) addWorkCard(false);
  updateSummary();
}

function addWorkCard(scroll = true) {
  workCount++;
  const container = document.getElementById("workContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "work-card";
  card.dataset.index = String(workCount);

  card.innerHTML = `
    <div class="work-card-head">
      <div class="work-title">Work ${workCount}</div>
    </div>

    <div class="work-grid">
      <div class="field">
        <label>Machine</label>
        <select class="machineSelect">
          <option value="">Select Machine</option>
          ${machines.filter(m => m.active !== false).map(m => {
            const typeObj = (adminOverrides?.machineTypes || machineTypes || []).find(t => String(t.id) === String(m.type));
            const typeName = typeObj?.name || m.type || "";
            const display = typeName ? `${m.name} • ${typeName}` : m.name;
            return `<option value="${escapeAttr(m.name)}">${escapeHtml(display)}</option>`;
          }).join("")}
        </select>
      </div>

      <div class="field">
        <label>Department</label>
        <select class="deptSelect">
          <option value="">Select Department</option>
          ${mainWorks.map(d => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Sub Work</label>
        <select class="subWorkSelect" disabled>
          <option value="">Select Sub Work</option>
        </select>
      </div>

      <div class="field">
        <label>Type</label>
        <select class="typeSelect">
          <option value="Normal">Normal</option>
          <option value="Other">Other</option>
          <option value="Rework">Rework</option>
        </select>
      </div>

      <div class="field descField" style="display:none;">
        <label>Description (Required for Other/Rework)</label>
        <input class="descInput" type="text" placeholder="Write description..."/>
      </div>

      <div class="field rootAreaField" style="display:none;">
        <label>Root Area (for Rework)</label>
        <select class="rootAreaSelect">
          <option value="">Select Root Area</option>
          <option value="Engineering">Engineering</option>
          <option value="Vendor">Vendor</option>
          <option value="Production">Production</option>
          <option value="Quality">Quality</option>
          <option value="Site Team (O&M)">Site Team (O&M)</option>
          <option value="Customer Change">Customer Change</option>
          <option value="Others">Others</option>
        </select>
      </div>

      <div class="field">
        <label>Standard Time (min)</label>
        <input class="standardTime" type="number" value="0" readonly />
      </div>

      <div class="field">
        <label>Actual Time (min)</label>
        <input class="actualTime" type="number" min="0" placeholder="Minutes"/>
      </div>
    </div>
  `;

  container.appendChild(card);
  attachCardEvents(card);

  if (scroll) {
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => card.querySelector(".actualTime")?.focus(), 120);
  }

  updateSummaryDebounced();
}

function attachCardEvents(card) {
  const machineSel = card.querySelector(".machineSelect");
  const dept = card.querySelector(".deptSelect");
  const sub = card.querySelector(".subWorkSelect");
  const type = card.querySelector(".typeSelect");
  const descField = card.querySelector(".descField");
  const descInput = card.querySelector(".descInput");
  const std = card.querySelector(".standardTime");
  const act = card.querySelector(".actualTime");
  const rootAreaField = card.querySelector(".rootAreaField");
  const rootAreaSelect = card.querySelector(".rootAreaSelect");

  function applyCatalogFromMachine() {
    const machineName = machineSel?.value || "";
    const typeId = getTypeIdForMachineName(machineName);
    const catalog = getCatalogForType(typeId);

    card.dataset.typeId = typeId || "";

    setDeptOptions(dept, catalog.mainWorks);

    sub.innerHTML = `<option value="">Select Sub Work</option>`;
    sub.disabled = true;
    std.value = "0";
  }

  machineSel.onchange = () => {
    applyCatalogFromMachine();
    updateSummaryDebounced();
  };

  dept.onchange = () => {
    const dep = dept.value;
    const typeId = card.dataset.typeId || "";
    const catalog = getCatalogForType(typeId);

    const items = Array.isArray(catalog.subWorks?.[dep]) ? catalog.subWorks[dep] : [];
    setSubWorkOptions(sub, items);

    std.value = "0";
    updateSummaryDebounced();
  };

  sub.onchange = () => {
    const opt = sub.selectedOptions[0];
    const t = opt ? parseInt(opt.dataset.time || "0", 10) : 0;
    std.value = String(t);
    updateSummaryDebounced();
  };

  type.onchange = () => {
    const v = type.value;

    if (v === "Rework") {
      if (rootAreaField) rootAreaField.style.display = "flex";
    } else {
      if (rootAreaField) rootAreaField.style.display = "none";
      if (rootAreaSelect) rootAreaSelect.value = "";
    }

    if (v === "Other" || v === "Rework") {
      descField.style.display = "flex";
      descInput?.focus();
    } else {
      descField.style.display = "none";
      if (descInput) descInput.value = "";
    }

    updateSummaryDebounced();
  };

  // Smooth typing (debounced)
  act.oninput = () => updateSummaryDebounced();
  if (rootAreaSelect) rootAreaSelect.onchange = () => updateSummaryDebounced();
}

function deleteLastWorkCard() {
  const cards = document.querySelectorAll(".work-card");
  if (cards.length === 0) return;
  cards[cards.length - 1].remove();
  workCount = Math.max(workCount - 1, 0);
  updateSummaryDebounced();
}

// ===================== SUMMARY =====================
function updateSummary() {
  const available = getShiftAvailableMinutes();

  let utilized = 0;
  document.querySelectorAll(".work-card .actualTime").forEach((inp) => {
    utilized += parseInt(inp.value || "0", 10) || 0;
  });

  let remaining = available - utilized;
  if (remaining < 0) remaining = 0;

  const productivity = available > 0 ? ((utilized / available) * 100) : 0;

  const av = document.getElementById("availableMin");
  const ut = document.getElementById("utilizedMin");
  const re = document.getElementById("remainingMin");
  const pr = document.getElementById("productivityPct");

  if (av) av.innerText = `${available} min`;
  if (ut) ut.innerText = `${utilized} min`;
  if (re) re.innerText = `${remaining} min`;

  if (pr) {
    pr.innerText = `${productivity.toFixed(1)}%`;
    if (productivity >= 90) pr.style.color = "green";
    else if (productivity >= 70) pr.style.color = "orange";
    else pr.style.color = "red";
  }
}

// ===================== SAVE LOCAL =====================
async function saveLocal() {
  const data = buildPayload();
  localStorage.setItem("spwt_last_save", JSON.stringify(data));
  alert("✅ Saved locally.");
}

// ===================== BUILD PAYLOAD =====================
function buildPayload() {
  const workDate = document.getElementById("workDate")?.value || "";
  const shiftId = document.getElementById("shiftSelect")?.value || "";
  const empId = document.getElementById("employeeSelect")?.value || "";
  const workType = document.getElementById("workTypeTop")?.value || "Normal";

  const shiftObj = shifts.find(s => String(s.id ?? s.name) === String(shiftId)) || null;
  const empObj = employees.find(e => String(e.empId) === String(empId)) || null;

  const shiftAvailable = getShiftAvailableMinutes();

  const works = [];
  let utilized = 0;

  document.querySelectorAll(".work-card").forEach((card) => {
    const machine = card.querySelector(".machineSelect")?.value || "";
    const department = card.querySelector(".deptSelect")?.value || "";
    const subWork = card.querySelector(".subWorkSelect")?.value || "";
    const type = card.querySelector(".typeSelect")?.value || "Normal";
    const description = (card.querySelector(".descInput")?.value || "").trim();
    const rootArea = card.querySelector(".rootAreaSelect")?.value || "";

    const standard = parseInt(card.querySelector(".standardTime")?.value || "0", 10) || 0;
    const actual = parseInt(card.querySelector(".actualTime")?.value || "0", 10) || 0;

    const hasAnything = machine || department || subWork || description || actual > 0 || standard > 0;
    if (!hasAnything) return;

    utilized += actual;

    const mObj = (machines || []).find(mm => String(mm.name) === String(machine));
    const typeId = (mObj?.type || "").toString();

    const typeObj = (adminOverrides?.machineTypes || machineTypes || []).find(t => String(t.id) === String(typeId));
    const typeName = typeObj?.name || typeId || "";

    works.push({
      machine,
      machineTypeId: typeId,
      machineCategory: typeName,
      department,
      subWork,
      type,
      description,
      rootArea,
      standardTime: standard,
      actualTime: actual,
    });
  });

  const remaining = Math.max(0, shiftAvailable - utilized);
  const productivity = shiftAvailable > 0 ? Number(((utilized / shiftAvailable) * 100).toFixed(1)) : 0;

  return {
    secret: window.SPWT_CONFIG?.SECRET || "",
    workDate,
    shiftId: shiftObj?.id ?? shiftId,
    shiftName: shiftObj?.name || "",
    shiftStart: shiftObj?.start || "",
    shiftEnd: shiftObj?.end || "",
    breakMinutes: shiftObj?.breakMinutes || 0,
    workType,
    teamMemberId: empObj?.empId || empId,
    teamMemberName: empObj?.name || "",
    summary: { shiftAvailable, utilized, remaining, productivity },
    works,
  };
}

// ===================== SUBMIT (LOCKED) =====================
async function submit() {
  if (isSubmitting) return; // prevent double click multi popup
  isSubmitting = true;

  const submitBtn = document.getElementById("submitBtn");
  const saveBtn = document.getElementById("saveBtn");

  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }
    if (saveBtn) saveBtn.disabled = true;

    const payload = buildPayload();
    const errs = [];

    if (!payload.workDate) errs.push("Work Date is required");
    if (!payload.shiftId) errs.push("Shift is required");
    if (!payload.teamMemberId) errs.push("Team Member is required");
    if (!payload.works || payload.works.length === 0) errs.push("Add at least 1 work entry");

    (payload.works || []).forEach((w, idx) => {
      const i = idx + 1;
      if (!w.machine) errs.push(`Work ${i}: Machine is required`);
      if (!w.department) errs.push(`Work ${i}: Department is required`);
      if (!w.subWork) errs.push(`Work ${i}: Sub Work is required`);
      if (!w.actualTime || Number(w.actualTime) <= 0) errs.push(`Work ${i}: Actual Time must be > 0`);

      const t = String(w.type || "").toLowerCase();
      if ((t === "other" || t === "rework") && !String(w.description || "").trim()) {
        errs.push(`Work ${i}: Description required for Other/Rework`);
      }
      if (t === "rework" && !String(w.rootArea || "").trim()) {
        errs.push(`Work ${i}: Root Area is required for Rework`);
      }
    });

    if (errs.length > 0) {
      alert("Please fix:\n\n• " + errs.join("\n• "));
      return;
    }

    const webAppUrl = window.SPWT_CONFIG?.SHEETS_WEBAPP_URL;
    if (!webAppUrl) {
      alert("❌ Google Sheet URL not found in renderer/config.js");
      return;
    }

    const res = await window.api.submitToSheets({ webAppUrl, data: payload });
    if (!res || !res.ok) {
      alert("❌ Save Failed: " + (res?.error || "Unknown"));
      return;
    }

    // Show summary screen and clear entry
    showSummaryScreen(payload);
    clearEntryAndStartNew();

  } catch (e) {
    console.error(e);
    alert("Submit Error: " + (e?.message || e));
  } finally {
    isSubmitting = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit"; }
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ===================== ADMIN MODAL =====================
function openAdminModal() {
  const modal = document.getElementById("adminModal");
  if (!modal) return;

  modal.classList.remove("hidden");

  isAdminLoggedIn = false;
  document.getElementById("adminLoginBox")?.classList.remove("hidden");
  document.getElementById("adminPanel")?.classList.add("hidden");

  const pin = document.getElementById("adminPinInput");
  if (pin) pin.value = "";
}

function closeAdminModal() {
  document.getElementById("adminModal")?.classList.add("hidden");
}

function adminLogin() {
  const pin = (document.getElementById("adminPinInput")?.value || "").trim();
  const real = adminOverrides?.admin?.pin || "1234";

  if (pin !== real) {
    alert("❌ Wrong PIN");
    return;
  }

  isAdminLoggedIn = true;
  document.getElementById("adminLoginBox")?.classList.add("hidden");
  document.getElementById("adminPanel")?.classList.remove("hidden");

  switchAdminTab("tabMachines");
}

function adminLogout() {
  isAdminLoggedIn = false;
  document.getElementById("adminPanel")?.classList.add("hidden");
  document.getElementById("adminLoginBox")?.classList.remove("hidden");
}

function switchAdminTab(tabId) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tabId}"]`)?.classList.add("active");

  document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
  document.getElementById(tabId)?.classList.remove("hidden");

  if (tabId === "tabMachines") renderAdminMachines();
  if (tabId === "tabEmployees") renderAdminEmployees();
  if (tabId === "tabShifts") renderAdminShifts();
  if (tabId === "tabWork") renderAdminWorkSub();
}

function mustAdmin() {
  if (!isAdminLoggedIn) {
    alert("⚠ Admin login required.");
    return false;
  }
  if (!adminOverrides) {
    alert("⚠ Admin data not loaded. Close & open settings again.");
    return false;
  }

  adminOverrides.admin = adminOverrides.admin || { pin: "1234" };
  adminOverrides.machines = adminOverrides.machines || [];
  adminOverrides.employees = adminOverrides.employees || [];
  adminOverrides.shifts = adminOverrides.shifts || [];

  // Global fallback lists
  adminOverrides.mainWorks = adminOverrides.mainWorks || [];
  adminOverrides.subWorks = adminOverrides.subWorks || {};

  // clean empty key
  if (Object.prototype.hasOwnProperty.call(adminOverrides.subWorks, "")) delete adminOverrides.subWorks[""];

  // Machine types
  adminOverrides.machineTypes = adminOverrides.machineTypes || machineTypes || [
    { id: "Online", name: "Online" },
    { id: "Booster-AirCooled", name: "Booster - Air Cooled" },
    { id: "Booster-WaterCooled", name: "Booster - Water Cooled" },
    { id: "600SCMC", name: "600 SCMC" },
    { id: "400SCMH", name: "400 SCMH" }
  ];

  // Type-wise catalog
  adminOverrides.workCatalogByType = adminOverrides.workCatalogByType || {};

  // Ensure every type has a catalog (template from global lists)
  (adminOverrides.machineTypes || []).forEach(t => {
    if (!adminOverrides.workCatalogByType[t.id]) {
      adminOverrides.workCatalogByType[t.id] = {
        mainWorks: Array.isArray(adminOverrides.mainWorks) ? [...adminOverrides.mainWorks] : [],
        subWorks: adminOverrides.subWorks ? JSON.parse(JSON.stringify(adminOverrides.subWorks)) : {}
      };
    }

    const cat = adminOverrides.workCatalogByType[t.id];
    cat.mainWorks = Array.isArray(cat.mainWorks) ? cat.mainWorks : [];
    cat.subWorks = (cat.subWorks && typeof cat.subWorks === "object") ? cat.subWorks : {};

    if (Object.prototype.hasOwnProperty.call(cat.subWorks, "")) delete cat.subWorks[""];
  });

  return true;
}

// ----- MACHINES -----
function renderAdminMachines() {
  if (!mustAdmin()) return;
  ensureMachineIds();

  const host = document.getElementById("machinesList");
  if (!host) return;

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width:45%">Machine Name</th>
          <th style="width:25%">Type</th>
          <th style="width:15%">Status</th>
          <th style="width:15%">Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.machines.map((m, idx) => {
          const name = (m?.name ?? "").toString();
          const active = m?.active !== false;
          const typeId = (m?.type ?? "").toString() || (adminOverrides.machineTypes?.[0]?.id || "Online");

          const typeOptions = (adminOverrides.machineTypes || machineTypes || []).map(t => {
            const sel = String(t.id) === String(typeId) ? "selected" : "";
            return `<option value="${escapeAttr(t.id)}" ${sel}>${escapeHtml(t.name)}</option>`;
          }).join("");

          return `
            <tr>
              <td>
                <input class="admin-input" data-m-idx="${idx}" data-field="name"
                       value="${escapeAttr(name)}" placeholder="NEGDCL 26001"/>
              </td>

              <td>
                <select class="admin-select" data-m-idx="${idx}" data-field="type">
                  ${typeOptions}
                </select>
              </td>

              <td>
                <select class="admin-select" data-m-idx="${idx}" data-field="active">
                  <option value="true" ${active ? "selected" : ""}>Active</option>
                  <option value="false" ${!active ? "selected" : ""}>Completed</option>
                </select>
              </td>

              <td><button class="btn grey" data-m-del="${idx}">Delete</button></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  host.querySelectorAll("[data-m-idx]").forEach(el => {
    const idx = Number(el.getAttribute("data-m-idx"));
    const field = el.getAttribute("data-field");

    if (el.tagName === "INPUT") {
      el.oninput = () => {
        if (field === "name") adminOverrides.machines[idx].name = el.value.trim();
      };
    } else {
      el.onchange = () => {
        if (field === "active") adminOverrides.machines[idx].active = (el.value === "true");
        if (field === "type") adminOverrides.machines[idx].type = el.value;
      };
    }
  });

  host.querySelectorAll("[data-m-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-m-del"));
      adminOverrides.machines.splice(idx, 1);
      renderAdminMachines();
    };
  });
}

function adminAddMachine() {
  if (!mustAdmin()) return;

  ensureMachineIds();
  const nextId = Math.max(0, ...adminOverrides.machines.map(m => Number(m.id || 0))) + 1;
  const fallbackType = adminOverrides.machineTypes?.[0]?.id || "Online";

  adminOverrides.machines.push({
    id: nextId,
    name: "",
    type: fallbackType,
    active: true
  });

  renderAdminMachines();
}

// ----- EMPLOYEES -----
function renderAdminEmployees() {
  if (!mustAdmin()) return;
  const host = document.getElementById("employeesList");
  if (!host) return;

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width:25%">Emp ID</th>
          <th style="width:45%">Name</th>
          <th style="width:15%">Active</th>
          <th style="width:15%">Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.employees.map((e, idx) => {
          const empId = (e?.empId ?? "").toString();
          const name = (e?.name ?? "").toString();
          const active = e?.active !== false;
          return `
            <tr>
              <td><input class="admin-input" data-e-idx="${idx}" data-field="empId" value="${escapeAttr(empId)}" placeholder="SPT001"/></td>
              <td><input class="admin-input" data-e-idx="${idx}" data-field="name" value="${escapeAttr(name)}" placeholder="Employee Name"/></td>
              <td>
                <select class="admin-select" data-e-idx="${idx}" data-field="active">
                  <option value="true" ${active ? "selected" : ""}>Yes</option>
                  <option value="false" ${!active ? "selected" : ""}>No</option>
                </select>
              </td>
              <td><button class="btn grey" data-e-del="${idx}">Delete</button></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  host.querySelectorAll("[data-e-idx]").forEach(el => {
    const idx = Number(el.getAttribute("data-e-idx"));
    const field = el.getAttribute("data-field");

    el.oninput = () => {
      if (field === "empId") adminOverrides.employees[idx].empId = el.value.trim();
      if (field === "name") adminOverrides.employees[idx].name = el.value.trim();
    };
    el.onchange = () => {
      if (field === "active") adminOverrides.employees[idx].active = (el.value === "true");
    };
  });

  host.querySelectorAll("[data-e-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-e-del"));
      adminOverrides.employees.splice(idx, 1);
      renderAdminEmployees();
    };
  });
}

function adminAddEmployee() {
  if (!mustAdmin()) return;
  adminOverrides.employees.push({ empId: "", name: "", active: true });
  renderAdminEmployees();
}

// ----- SHIFTS -----
function renderAdminShifts() {
  if (!mustAdmin()) return;
  const host = document.getElementById("shiftsList");
  if (!host) return;

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width:25%">Name</th>
          <th style="width:15%">Start</th>
          <th style="width:15%">End</th>
          <th style="width:15%">Break</th>
          <th style="width:10%">Active</th>
          <th style="width:20%">Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.shifts.map((s, idx) => {
          const name = (s?.name ?? "").toString();
          const start = (s?.start ?? "09:00").toString();
          const end = (s?.end ?? "18:00").toString();
          const br = Number(s?.breakMinutes ?? 0);
          const active = s?.active !== false;

          return `
            <tr>
              <td><input class="admin-input" data-s-idx="${idx}" data-field="name" value="${escapeAttr(name)}"/></td>
              <td><input class="admin-input" data-s-idx="${idx}" data-field="start" type="time" value="${escapeAttr(start)}"/></td>
              <td><input class="admin-input" data-s-idx="${idx}" data-field="end" type="time" value="${escapeAttr(end)}"/></td>
              <td><input class="admin-input" data-s-idx="${idx}" data-field="breakMinutes" type="number" min="0" value="${br}"/></td>
              <td>
                <select class="admin-select" data-s-idx="${idx}" data-field="active">
                  <option value="true" ${active ? "selected" : ""}>Yes</option>
                  <option value="false" ${!active ? "selected" : ""}>No</option>
                </select>
              </td>
              <td><button class="btn grey" data-s-del="${idx}">Delete</button></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  host.querySelectorAll("[data-s-idx]").forEach(el => {
    const idx = Number(el.getAttribute("data-s-idx"));
    const field = el.getAttribute("data-field");

    const apply = () => {
      if (field === "name") adminOverrides.shifts[idx].name = el.value.trim();
      if (field === "start") adminOverrides.shifts[idx].start = el.value;
      if (field === "end") adminOverrides.shifts[idx].end = el.value;
      if (field === "breakMinutes") adminOverrides.shifts[idx].breakMinutes = Number(el.value || 0);
      if (field === "active") adminOverrides.shifts[idx].active = (el.value === "true");
    };

    el.oninput = apply;
    el.onchange = apply;
  });

  host.querySelectorAll("[data-s-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-s-del"));
      adminOverrides.shifts.splice(idx, 1);
      renderAdminShifts();
    };
  });
}

function adminAddShift() {
  if (!mustAdmin()) return;
  adminOverrides.shifts.push({
    id: String(Date.now()),
    name: "",
    start: "09:00",
    end: "18:00",
    breakMinutes: 0,
    active: true
  });
  renderAdminShifts();
}

// ----- WORK & SUB WORK (TYPE-WISE) -----
function renderAdminWorkSub() {
  if (!mustAdmin()) return;

  const typeSel = document.getElementById("workTypeSelect");
  const mainHost = document.getElementById("mainWorkList");
  const subHost = document.getElementById("subWorkList");
  const label = document.getElementById("editingDeptLabel");
  if (!typeSel || !mainHost || !subHost || !label) return;

  const types = adminOverrides.machineTypes || [];
  typeSel.innerHTML = types.map(t => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.name)}</option>`).join("");

  if (!selectedTypeForWorkEdit || !types.some(t => String(t.id) === String(selectedTypeForWorkEdit))) {
    selectedTypeForWorkEdit = types[0]?.id || "";
  }
  typeSel.value = selectedTypeForWorkEdit;

  const typeListHost = document.getElementById("typeList");
  if (typeListHost) renderTypeListInline(typeListHost);

  typeSel.onchange = () => {
    selectedTypeForWorkEdit = typeSel.value;
    selectedDeptForTypeEdit = "";
    renderAdminWorkSub();
  };

  const catalog = adminOverrides.workCatalogByType[selectedTypeForWorkEdit];
  if (!catalog) return;

  catalog.mainWorks = Array.isArray(catalog.mainWorks) ? catalog.mainWorks : [];
  catalog.subWorks = (catalog.subWorks && typeof catalog.subWorks === "object") ? catalog.subWorks : {};
  if (Object.prototype.hasOwnProperty.call(catalog.subWorks, "")) delete catalog.subWorks[""];

  if (!selectedDeptForTypeEdit || !catalog.mainWorks.includes(selectedDeptForTypeEdit)) {
    selectedDeptForTypeEdit = catalog.mainWorks[0] || "";
  }

  mainHost.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Main Work (Department)</th><th style="width:220px;">Action</th></tr></thead>
      <tbody>
        ${catalog.mainWorks.map((d, idx) => `
          <tr>
            <td><input class="admin-input" data-tmw-idx="${idx}" value="${escapeAttr(d)}"/></td>
            <td style="display:flex;gap:10px;">
              <button class="btn grey" data-tmw-edit="${idx}">Edit</button>
              <button class="btn grey" data-tmw-del="${idx}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  mainHost.querySelectorAll("[data-tmw-idx]").forEach(inp => {
    inp.onblur = () => {
      const idx = Number(inp.getAttribute("data-tmw-idx"));
      const oldName = catalog.mainWorks[idx];
      const newName = (inp.value || "").trim();

      if (!newName) { inp.value = oldName; return; }
      if (oldName === newName) return;

      catalog.mainWorks[idx] = newName;
      catalog.subWorks[newName] = catalog.subWorks[oldName] || [];
      if (catalog.subWorks[oldName]) delete catalog.subWorks[oldName];

      if (selectedDeptForTypeEdit === oldName) selectedDeptForTypeEdit = newName;
      renderAdminWorkSub();
    };
  });

  mainHost.querySelectorAll("[data-tmw-edit]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-tmw-edit"));
      selectedDeptForTypeEdit = catalog.mainWorks[idx] || "";
      renderAdminWorkSub();
    };
  });

  mainHost.querySelectorAll("[data-tmw-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-tmw-del"));
      const name = catalog.mainWorks[idx];

      catalog.mainWorks.splice(idx, 1);
      if (name) delete catalog.subWorks[name];

      selectedDeptForTypeEdit = catalog.mainWorks[0] || "";
      renderAdminWorkSub();
    };
  });

  label.textContent = selectedDeptForTypeEdit || "None";

  const items = Array.isArray(catalog.subWorks[selectedDeptForTypeEdit])
    ? catalog.subWorks[selectedDeptForTypeEdit]
    : [];
  catalog.subWorks[selectedDeptForTypeEdit] = items;

  subHost.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Sub Work</th><th style="width:180px;">Std Time (min)</th><th style="width:120px;">Action</th></tr></thead>
      <tbody>
        ${items.map((it, idx) => `
          <tr>
            <td><input class="admin-input" data-tsw-idx="${idx}" data-field="name" value="${escapeAttr(it.name || "")}"/></td>
            <td><input class="admin-input" data-tsw-idx="${idx}" data-field="standardTime" type="number" min="0" value="${Number(it.standardTime || 0)}"/></td>
            <td><button class="btn grey" data-tsw-del="${idx}">Delete</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  subHost.querySelectorAll("[data-tsw-idx]").forEach(el => {
    const idx = Number(el.getAttribute("data-tsw-idx"));
    const field = el.getAttribute("data-field");

    const apply = () => {
      if (field === "name") items[idx].name = el.value.trim();
      if (field === "standardTime") items[idx].standardTime = Number(el.value || 0);
    };

    el.oninput = apply;
    el.onchange = apply;
  });

  subHost.querySelectorAll("[data-tsw-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-tsw-del"));
      items.splice(idx, 1);
      renderAdminWorkSub();
    };
  });
}

function adminAddMainWork() {
  if (!mustAdmin()) return;
  if (!selectedTypeForWorkEdit) return alert("Select a Machine Category first.");

  const catalog = adminOverrides.workCatalogByType[selectedTypeForWorkEdit];
  if (!catalog) return alert("Catalog not found for selected category.");

  const name = "New Department";
  catalog.mainWorks.push(name);
  catalog.subWorks[name] = catalog.subWorks[name] || [];

  selectedDeptForTypeEdit = name;
  renderAdminWorkSub();
}

function adminAddSubWork() {
  if (!mustAdmin()) return;
  if (!selectedTypeForWorkEdit) return alert("Select a Machine Category first.");
  if (!selectedDeptForTypeEdit) return alert("Select a Main Work first.");

  const catalog = adminOverrides.workCatalogByType[selectedTypeForWorkEdit];
  if (!catalog) return alert("Catalog not found for selected category.");

  catalog.subWorks[selectedDeptForTypeEdit] = catalog.subWorks[selectedDeptForTypeEdit] || [];
  catalog.subWorks[selectedDeptForTypeEdit].push({ name: "New Sub Work", standardTime: 0 });

  renderAdminWorkSub();
}

function renderTypeListInline(host) {
  adminOverrides.machineTypes = adminOverrides.machineTypes || [];
  adminOverrides.workCatalogByType = adminOverrides.workCatalogByType || {};

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width:45%">Category Name</th>
          <th style="width:35%">Key (ID)</th>
          <th style="width:20%">Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.machineTypes.map((t, idx) => `
          <tr>
            <td>
              <input class="admin-input" data-ty-idx="${idx}" data-field="name" value="${escapeAttr(t.name || "")}" />
            </td>
            <td>
              <input class="admin-input" data-ty-idx="${idx}" data-field="id" value="${escapeAttr(t.id || "")}" />
            </td>
            <td>
              <button class="btn grey" data-ty-del="${idx}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="small-hint" style="margin-top:8px;">
      Tip: If you change the Key (ID), it will create a new category catalog. Keep ID stable once used.
    </div>
  `;

  host.querySelectorAll("[data-ty-idx]").forEach(el => {
    const idx = Number(el.getAttribute("data-ty-idx"));
    const field = el.getAttribute("data-field");

    el.oninput = () => {
      adminOverrides.machineTypes[idx][field] = (el.value || "").trim();
    };

    el.onblur = () => {
      if (field !== "id") return;
      const id = (adminOverrides.machineTypes[idx].id || "").trim();
      if (!id) return;

      if (!adminOverrides.workCatalogByType[id]) {
        adminOverrides.workCatalogByType[id] = {
          mainWorks: [...(adminOverrides.mainWorks || [])],
          subWorks: adminOverrides.subWorks ? JSON.parse(JSON.stringify(adminOverrides.subWorks)) : {}
        };
      }

      // clean empty key if exists
      if (adminOverrides.workCatalogByType[id]?.subWorks && Object.prototype.hasOwnProperty.call(adminOverrides.workCatalogByType[id].subWorks, "")) {
        delete adminOverrides.workCatalogByType[id].subWorks[""];
      }
    };
  });

  host.querySelectorAll("[data-ty-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-ty-del"));
      const removed = adminOverrides.machineTypes[idx];

      adminOverrides.machineTypes.splice(idx, 1);

      if (removed?.id && adminOverrides.workCatalogByType?.[removed.id]) {
        delete adminOverrides.workCatalogByType[removed.id];
      }

      const fallback = adminOverrides.machineTypes[0]?.id || "Online";
      (adminOverrides.machines || []).forEach(m => {
        if (String(m.type) === String(removed?.id)) m.type = fallback;
      });

      if (selectedTypeForWorkEdit === removed?.id) {
        selectedTypeForWorkEdit = fallback;
        selectedDeptForTypeEdit = "";
      }

      renderAdminWorkSub();
    };
  });
}

function adminAddType() {
  if (!mustAdmin()) return;

  adminOverrides.machineTypes = adminOverrides.machineTypes || [];
  adminOverrides.workCatalogByType = adminOverrides.workCatalogByType || {};

  const id = "NewType-" + Date.now();
  adminOverrides.machineTypes.push({ id, name: "New Category" });

  adminOverrides.workCatalogByType[id] = {
    mainWorks: [...(adminOverrides.mainWorks || [])],
    subWorks: adminOverrides.subWorks ? JSON.parse(JSON.stringify(adminOverrides.subWorks)) : {}
  };

  if (adminOverrides.workCatalogByType[id]?.subWorks && Object.prototype.hasOwnProperty.call(adminOverrides.workCatalogByType[id].subWorks, "")) {
    delete adminOverrides.workCatalogByType[id].subWorks[""];
  }

  selectedTypeForWorkEdit = id;
  selectedDeptForTypeEdit = "";

  renderAdminWorkSub();
}

// ----- SAVE ADMIN CHANGES (LOCKED) -----
async function adminSaveChanges() {
  if (!mustAdmin()) return;
  if (isAdminSaving) return; // prevent multiple popup / multi-save
  isAdminSaving = true;

  const btn = document.getElementById("adminSaveBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

    // extra: ensure no empty dept key before saving
    if (adminOverrides?.subWorks && Object.prototype.hasOwnProperty.call(adminOverrides.subWorks, "")) {
      delete adminOverrides.subWorks[""];
    }
    Object.keys(adminOverrides?.workCatalogByType || {}).forEach(tid => {
      const cat = adminOverrides.workCatalogByType[tid];
      if (cat?.subWorks && Object.prototype.hasOwnProperty.call(cat.subWorks, "")) delete cat.subWorks[""];
    });

    const res = await window.api.saveAdminOverrides(adminOverrides);
    if (!res?.ok) {
      alert("❌ Save failed: " + (res?.error || "Unknown"));
      return;
    }

    alert("✅ Admin changes saved.");

    // Reload runtime data, repopulate dropdowns, rebuild fresh cards
    await loadData();
    populateHeaderDropdowns();
    resetWorkCards(1);

    closeAdminModal();
  } catch (e) {
    console.error(e);
    alert("❌ Save error: " + (e?.message || e));
  } finally {
    isAdminSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; }
  }
}

// ----- SAVE PIN -----
async function adminSavePin() {
  if (!mustAdmin()) return;

  const p1 = (document.getElementById("newPin1")?.value || "").trim();
  const p2 = (document.getElementById("newPin2")?.value || "").trim();

  if (!p1 || p1.length < 4) return alert("PIN must be at least 4 digits.");
  if (p1 !== p2) return alert("PIN does not match.");

  adminOverrides.admin.pin = p1;

  const res = await window.api.saveAdminOverrides(adminOverrides);
  if (!res?.ok) return alert("❌ Save failed: " + (res?.error || "Unknown"));

  document.getElementById("newPin1").value = "";
  document.getElementById("newPin2").value = "";
  alert("✅ PIN updated.");
}

// ===================== TYPE HELPERS =====================
function ensureMachineIds() {
  if (!adminOverrides?.machines) return;
  let maxId = 0;
  adminOverrides.machines.forEach(m => {
    const n = Number(m.id || 0);
    if (n > maxId) maxId = n;
  });
  adminOverrides.machines.forEach(m => {
    if (!m.id) {
      maxId += 1;
      m.id = maxId;
    }
  });
}

function getMachineByName(name) {
  return (machines || []).find(m => String(m.name) === String(name));
}

function getTypeIdForMachineName(name) {
  const m = getMachineByName(name);
  return (m && m.type) ? String(m.type) : "";
}

function getCatalogForType(typeId) {
  const byType = workCatalogByType || {};
  const cat = byType[typeId];
  if (cat && Array.isArray(cat.mainWorks) && cat.subWorks && typeof cat.subWorks === "object") {
    return cat;
  }
  return { mainWorks: mainWorks || [], subWorks: subWorksMap || {} };
}

function setDeptOptions(selectEl, deptList) {
  selectEl.innerHTML =
    `<option value="">Select Department</option>` +
    (deptList || []).map(d => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`).join("");
}

function setSubWorkOptions(selectEl, items) {
  selectEl.innerHTML = `<option value="">Select Sub Work</option>`;
  (items || []).forEach(w => {
    const opt = document.createElement("option");
    opt.value = w.name;
    opt.textContent = `${w.name} (${Number(w.standardTime || 0)} min)`;
    opt.dataset.time = String(Number(w.standardTime || 0));
    selectEl.appendChild(opt);
  });
  selectEl.disabled = !(items && items.length);
}

// ===================== HELPERS =====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

// ===================== SUMMARY SCREEN =====================
function showSummaryScreen(payload){
  const scr = document.getElementById("summaryScreen");
  if (!scr) return;

  const meta = document.getElementById("sumMetaLine");
  const dt = payload.workDate || "";
  const emp = `${payload.teamMemberId || ""} - ${payload.teamMemberName || ""}`.trim();
  const sh = `${payload.shiftName || ""} (${payload.shiftStart || ""}-${payload.shiftEnd || ""})`.trim();
  if (meta) meta.textContent = `${dt} • ${emp} • ${sh}`;

  document.getElementById("sumShiftAvail").textContent = `${Number(payload.summary?.shiftAvailable || 0)} min`;
  document.getElementById("sumUtilized").textContent   = `${Number(payload.summary?.utilized || 0)} min`;
  document.getElementById("sumRemaining").textContent  = `${Number(payload.summary?.remaining || 0)} min`;
  document.getElementById("sumProductivity").textContent = `${Number(payload.summary?.productivity || 0).toFixed(1)}%`;

  const host = document.getElementById("sumWorksTable");
  const works = Array.isArray(payload.works) ? payload.works : [];

  const rowsHtml = works.map((w, i) => {
    const t = String(w.type || "Normal");
    const low = t.toLowerCase();
    const badgeClass =
      low === "rework" ? "badge-rework" :
      low === "other"  ? "badge-other"  :
                         "badge-normal";

    const rowClass =
      low === "rework" ? "row-rework" :
      low === "other"  ? "row-other"  :
                         "";

    return `
      <tr class="${rowClass}">
        <td>${i+1}</td>
        <td>${escapeHtml(w.machine || "")}</td>
        <td>${escapeHtml(w.department || "")}</td>
        <td>${escapeHtml(w.subWork || "")}</td>
        <td><span class="sum-badge ${badgeClass}">${escapeHtml(t)}</span></td>
        <td>${escapeHtml(w.description || "")}</td>
        <td>${Number(w.standardTime || 0)}</td>
        <td><b>${Number(w.actualTime || 0)}</b></td>
      </tr>
    `;
  }).join("");

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Machine</th>
          <th>Department</th>
          <th>Sub Work</th>
          <th>Type</th>
          <th>Description</th>
          <th>Std (min)</th>
          <th>Actual (min)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="8">No work rows.</td></tr>`}
      </tbody>
    </table>
  `;

  scr.classList.remove("hidden");
}

function hideSummaryScreen(){
  document.getElementById("summaryScreen")?.classList.add("hidden");
}

function clearEntryAndStartNew(){
  const workDate = document.getElementById("workDate");
  if (workDate) workDate.valueAsDate = new Date();

  const shiftSelect = document.getElementById("shiftSelect");
  if (shiftSelect) shiftSelect.value = "";

  const empSelect = document.getElementById("employeeSelect");
  if (empSelect) empSelect.value = "";

  const workTypeTop = document.getElementById("workTypeTop");
  if (workTypeTop) workTypeTop.value = "Normal";

  resetWorkCards(1);

  localStorage.removeItem("spwt_last_save");
  updateSummaryDebounced();

  window.scrollTo({ top: 0, behavior: "smooth" });
}