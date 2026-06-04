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
let lossReasons = [];
let rootAreas = [];
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
    alert("Data load error. Please check DB server/PocketBase connection.\n\n" + (e?.message || e));
  }
});

// ===================== LOAD DATA =====================
async function loadData() {
  const dataSource = window.SPWT_CONFIG?.DATA_SOURCE || "db";
  const apiBaseUrl = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";

  if (dataSource === "db") {
    const res = await fetch(`${apiBaseUrl}/api/admin/master-data`);

    if (!res.ok) {
      throw new Error(`DB master data API error ${res.status}. Start backend server and PocketBase.`);
    }

    const payload = await res.json();

    if (!payload?.ok || !payload?.data) {
      throw new Error(payload?.message || "Invalid DB master data response");
    }

    adminOverrides = payload.data;
    console.log("Loaded master data from DB:", adminOverrides?.meta || {});
    applyOverrides();
    return;
  }

  // Legacy local mode only. DB edition does not use these dummy JSON files.
  machines = await fetch("data/machines.json").then(r => r.json());
  employees = await fetch("data/employees.json").then(r => r.json());
  shifts = await fetch("data/shifts.json").then(r => r.json());
  mainWorks = await fetch("data/mainWorks.json").then(r => r.json());
  subWorksMap = await fetch("data/subWorks.json").then(r => r.json());
  adminOverrides = await window.api.getAdminOverrides();
  applyOverrides();
}

function normalizeNameList(list, fallback) {
  const arr = Array.isArray(list) && list.length ? list : fallback;
  return arr
    .map(x => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") return String(x.name || x.reason || x.label || "").trim();
      return "";
    })
    .filter(Boolean);
}

function applyOverrides() {
  if (!adminOverrides) return;

  if (Array.isArray(adminOverrides.machines) && adminOverrides.machines.length) machines = adminOverrides.machines;
  if (Array.isArray(adminOverrides.employees) && adminOverrides.employees.length) employees = adminOverrides.employees;
  if (Array.isArray(adminOverrides.shifts) && adminOverrides.shifts.length) shifts = adminOverrides.shifts;

  lossReasons = normalizeNameList(adminOverrides.lossReasons, [
    "No Power", "No Load", "Short Leave", "Meeting", "5S", "Training",
    "Material Waiting", "Machine Breakdown", "Others"
  ]);

  rootAreas = normalizeNameList(adminOverrides.rootAreas, [
    "Engineering", "Vendor", "Production", "Quality", "Site Team (O&M)", "Customer Change", "Others"
  ]);

  adminOverrides.lossReasons = [...lossReasons];
  adminOverrides.rootAreas = [...rootAreas];

  if (Array.isArray(adminOverrides.mainWorks) && adminOverrides.mainWorks.length) mainWorks = adminOverrides.mainWorks;
  if (adminOverrides.subWorks && Object.keys(adminOverrides.subWorks).length) subWorksMap = adminOverrides.subWorks;

  if (subWorksMap && typeof subWorksMap === "object" && Object.prototype.hasOwnProperty.call(subWorksMap, "")) {
    delete subWorksMap[""];
  }

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

  workCatalogByType = adminOverrides.workCatalogByType && typeof adminOverrides.workCatalogByType === "object"
    ? adminOverrides.workCatalogByType
    : {};

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
  const shiftSelect = document.getElementById("shiftSelect");
  if (shiftSelect) {
    shiftSelect.innerHTML = `<option value="">Select Shift</option>`;
    shifts.filter(s => s.active !== false).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = String(s.id ?? s.name);
      opt.textContent = s.flexible === true ? `${s.name} (Flexible)` : `${s.name} (${s.start}-${s.end})`;
      shiftSelect.appendChild(opt);
    });
    shiftSelect.onchange = () => { updateFlexibleShiftBox(); updateSummaryDebounced(); };
  }

  const employeeSelect = document.getElementById("employeeSelect");
  if (employeeSelect) {
    employeeSelect.innerHTML = `<option value="">Select Team Member</option>`;
    employees.filter(e => e.active !== false).forEach((e) => {
      const opt = document.createElement("option");
      opt.value = e.empId;
      opt.textContent = `${e.empId} - ${e.name}`;
      employeeSelect.appendChild(opt);
    });
  }

  const workTypeTop = document.getElementById("workTypeTop");
  if (workTypeTop) workTypeTop.onchange = updateSummaryDebounced;

  const lossReasonSelect = document.getElementById("lossReasonSelect");
  if (lossReasonSelect) {
    lossReasonSelect.innerHTML = `<option value="">No Major Loss</option>` +
      (lossReasons || []).map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join("");
    lossReasonSelect.onchange = updateSummaryDebounced;
  }

  const lossTime = document.getElementById("lossRemark");
  if (lossTime) {
    lossTime.type = "number";
    lossTime.min = "0";
    lossTime.placeholder = "Loss time in minutes";
    lossTime.oninput = updateSummaryDebounced;
    const lbl = lossTime.closest(".field")?.querySelector("label");
    if (lbl) lbl.textContent = "Loss Time (min)";
  }

  const rootAreaSelect = document.getElementById("rootAreaSelect");
  if (rootAreaSelect) {
    rootAreaSelect.innerHTML = `<option value="">Select Root Area</option>` +
      (rootAreas || []).map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join("");
  }

  const machineSelect = document.getElementById("machineSelect");
  if (machineSelect) {
    machineSelect.innerHTML = `<option value="">Select Machine</option>`;
    machines.filter(m => m.active !== false).forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name;
      opt.dataset.type = m.type || "";
      machineSelect.appendChild(opt);
    });
    machineSelect.onchange = () => { applyMachineTypeFromMachine(); updateAllWorkCardOptions(); updateSummaryDebounced(); };
  }

  const machineTypeSelect = document.getElementById("machineTypeSelect");
  if (machineTypeSelect) {
    machineTypeSelect.innerHTML = `<option value="">Select Machine Category</option>`;
    machineTypes.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      machineTypeSelect.appendChild(opt);
    });
    machineTypeSelect.onchange = () => { updateAllWorkCardOptions(); updateSummaryDebounced(); };
  }

  updateAllWorkCardOptions();
}

function getMachineTypeName(typeId) {
  const t = machineTypes.find(x => x.id === typeId);
  return t ? t.name : typeId;
}

function getCurrentTypeId() {
  return document.getElementById("machineTypeSelect")?.value || "";
}

function getCatalogForCurrentType() {
  const tid = getCurrentTypeId();
  return (tid && workCatalogByType[tid]) ? workCatalogByType[tid] : { mainWorks, subWorks: subWorksMap };
}

function applyMachineTypeFromMachine() {
  const machineSelect = document.getElementById("machineSelect");
  const machineTypeSelect = document.getElementById("machineTypeSelect");
  if (!machineSelect || !machineTypeSelect) return;
  const opt = machineSelect.selectedOptions?.[0];
  if (opt?.dataset?.type) machineTypeSelect.value = opt.dataset.type;
}

// rest of file unchanged below
