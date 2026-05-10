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
    alert("Data load error. Please check your JSON files.\n\n" + (e?.message || e));
  }
});

// ===================== LOAD DATA =====================
async function loadData() {
  // Base JSON fallback compatibility
  machines = await fetch("data/machines.json").then(r => r.json());
  employees = await fetch("data/employees.json").then(r => r.json());
  shifts = await fetch("data/shifts.json").then(r => r.json());

  mainWorks = await fetch("data/mainWorks.json").then(r => r.json());
  subWorksMap = await fetch("data/subWorks.json").then(r => r.json());

  const dataSource = window.SPWT_CONFIG?.DATA_SOURCE || "local";
  const apiBaseUrl = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";

  if (dataSource === "db") {
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/master-data`);

      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }

      const payload = await res.json();

      if (!payload?.ok || !payload?.data) {
        throw new Error(payload?.message || "Invalid master data response");
      }

      adminOverrides = payload.data;
      console.log("Loaded master data from DB:", adminOverrides?.meta || {});
    } catch (err) {
      console.warn("DB master data load failed. Falling back to local adminOverrides.", err);
      adminOverrides = await window.api.getAdminOverrides();
    }
  } else {
    adminOverrides = await window.api.getAdminOverrides();
  }

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

  const flexibleMin = document.getElementById("flexibleShiftMinutes");
  if (flexibleMin) flexibleMin.oninput = updateSummaryDebounced;

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

  const addLossReasonBtn = document.getElementById("addLossReasonBtn");
  if (addLossReasonBtn) addLossReasonBtn.onclick = () => adminAddLossReason();

  const addRootAreaBtn = document.getElementById("addRootAreaBtn");
  if (addRootAreaBtn) addRootAreaBtn.onclick = () => adminAddRootArea();

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
    localStorage.removeItem("spwt_last_save");
    window.location.reload();
  };
}

function updateFlexibleShiftBox() {
  const shiftId = document.getElementById("shiftSelect")?.value;
  const shift = shifts.find((s) => String(s.id ?? s.name) === String(shiftId));
  const box = document.getElementById("flexibleShiftBox");
  if (!box) return;
  box.style.display = shift && shift.flexible === true ? "flex" : "none";
}

// ===================== SHIFT MINUTES =====================
function convertToMinutes(time) {
  const [h, m] = String(time || "0:0").split(":").map(Number);
  return (h * 60) + (m || 0);
}

function getMajorLossMinutes() {
  const selectedLoss = document.getElementById("lossReasonSelect")?.value || "";
  const lossMin = Number(document.getElementById("lossRemark")?.value || 0);
  return selectedLoss ? Math.max(0, lossMin) : 0;
}

function getGrossShiftAvailableMinutes() {
  const shiftId = document.getElementById("shiftSelect")?.value;
  const shift = shifts.find((s) => String(s.id ?? s.name) === String(shiftId));
  if (!shift) return 0;

  if (shift.flexible === true) {
    const flex = Number(document.getElementById("flexibleShiftMinutes")?.value || 0);
    return Math.max(0, flex);
  }

  const start = convertToMinutes(shift.start);
  const end = convertToMinutes(shift.end);

  let total = end - start;
  if (total < 0) total += 24 * 60;
  total = total - (Number(shift.breakMinutes) || 0);
  return Math.max(0, total);
}

function getShiftAvailableMinutes() {
  const gross = getGrossShiftAvailableMinutes();
  const loss = getMajorLossMinutes();
  return Math.max(0, gross - loss);
}

// ===================== WORK CARDS =====================
function resetWorkCards(count = 1) {
  const container = document.getElementById("workContainer");
  if (container) container.innerHTML = "";
  workCount = 0;
  for (let i = 0; i < count; i++) addWorkCard(false);
  updateSummary();
}


function parseChecklistLines(text) {
  return String(text || "")
    .split(/\n|;/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(.*?)\s*(?:=|:)\s*(\d+)\s*$/);
      if (m) return { name: m[1].trim(), standardTime: Number(m[2] || 0) };
      return { name: line, standardTime: 0 };
    });
}

function normalizeBookingPoints(raw) {
  if (Array.isArray(raw)) {
    return raw.map(x => {
      if (typeof x === "string") return { name: x, standardTime: 0 };
      return {
        name: String(x?.name || "").trim(),
        standardTime: Number(x?.standardTime || 0)
      };
    });
  }
  return parseChecklistLines(raw);
}

function normalizeQualityPoints(raw) {
  if (Array.isArray(raw)) {
    return raw.map(x => {
      if (typeof x === "string") {
        return { name: x, inputType: "status", mandatory: false };
      }
      return {
        name: String(x?.name || "").trim(),
        inputType: x?.inputType === "reading" ? "reading" : "status",
        mandatory: x?.mandatory === true
      };
    });
  }

  return String(raw || "")
    .split(/\n|;/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => ({ name: x, inputType: "status", mandatory: false }));
}

function ensureSubWorkDetails(item) {
  if (!item || typeof item !== "object") return;

  item.checkpoints = normalizeBookingPoints(
    item.checkpoints || item.bookingPoints || item.subSubWorks || item.workCheckpoints || []
  );

  item.qualityCheckpoints = normalizeQualityPoints(
    item.qualityCheckpoints || item.qualityFields || []
  );
}

function getCurrentSubWorkItem(card) {
  const typeId = card.dataset.typeId || "";
  const dep = card.querySelector(".deptSelect")?.value || "";
  const subName = card.querySelector(".subWorkSelect")?.value || "";
  const catalog = getCatalogForType(typeId);
  const items = Array.isArray(catalog.subWorks?.[dep]) ? catalog.subWorks[dep] : [];
  return items.find(x => String(x.name || x) === String(subName)) || null;
}

function normalizeCheckpointArray(raw) {
  if (Array.isArray(raw)) return raw.map(x => typeof x === "string" ? { name: x, standardTime: 0 } : x).filter(x => x && x.name);
  return parseChecklistLines(raw);
}

async function renderCheckpointFields(card) {
  const workBox = card.querySelector(".workCheckpointField");
  const workList = card.querySelector(".workCheckpointList");
  const qualBox = card.querySelector(".qualityCheckpointField");
  const qualList = card.querySelector(".qualityCheckpointList");
  const recheckBox = card.querySelector(".qualityRecheckField");
  const recheckInput = card.querySelector(".qualityRecheckInput");
  const std = card.querySelector(".standardTime");

  const item = getCurrentSubWorkItem(card);
  ensureSubWorkDetails(item);

  const workNature = card.querySelector(".typeSelect")?.value || "Normal";
  const qualityPoints = normalizeQualityPoints(item?.qualityCheckpoints || []);

  // IMPORTANT:
  // Booking points are handled only by renderBookingPoints().
  // This upper booking box is hidden to avoid duplicate/conflicting UI.
  if (workBox && workList) {
    workBox.style.display = "none";
    workList.innerHTML = "";
  }

  const machine = card.querySelector(".machineSelect")?.value || "";
  const department = card.querySelector(".deptSelect")?.value || "";
  const subWork = card.querySelector(".subWorkSelect")?.value || "";

  const machineObj = (machines || []).find(m => String(m.name) === String(machine));
  const typeId = String(machineObj?.type || "");
  const typeObj = (adminOverrides?.machineTypes || machineTypes || []).find(t => String(t.id) === typeId);
  const machineCategory = typeObj?.name || typeId || "";

  if (recheckBox) {
    if (workNature === "Rework" || workNature === "Other") {
      recheckBox.style.display = "flex";
    } else {
      recheckBox.style.display = "none";
      if (recheckInput) recheckInput.checked = false;
    }
  }

  const allowQuality =
    workNature === "Normal" ||
    ((workNature === "Rework" || workNature === "Other") && recheckInput?.checked);

  if (qualBox && qualList) {
    if (!allowQuality || qualityPoints.length === 0 || !machine || !department || !subWork) {
      qualBox.style.display = "none";
      qualList.innerHTML = "";
    } else {
      qualBox.style.display = "block";
      qualList.innerHTML = `<div class="small-hint">Checking previous quality records...</div>`;

      const completedQuality = await getCompletedQualityPointsFromSheet(
        machine,
        machineCategory,
        department,
        subWork
      );

      const completedMap = {};
      completedQuality.forEach(q => {
        completedMap[String(q.point || "").trim().toLowerCase()] = q;
      });

      qualList.innerHTML = qualityPoints.map((qp) => {
        const name = String(qp.name || "").trim();
        const label = escapeHtml(name);
        const mandatory = qp.mandatory === true ? "1" : "0";
        const old = completedMap[name.toLowerCase()];
        const isDone = !!old;

        if (isDone) {
          return `
            <div class="quality-entry-row quality-done-row">
              <label>
                ${label}${qp.mandatory === true ? " *" : ""}
                <div class="small-hint">
                  Already checked: ${escapeHtml(old.value || "")}
                  ${old.date ? " on " + escapeHtml(old.date) : ""}
                </div>
              </label>

              <div>
                <label class="quality-recheck-line">
                  <input type="checkbox"
                         class="qualityRecheckPointInput"
                         data-target-quality="${escapeAttr(name)}" />
                  Recheck / update
                </label>

                <div class="qualityRecheckValueBox" style="display:none;">
                  ${qp.inputType === "reading" ? `
                    <input type="text"
                           class="qualityValueInput"
                           data-quality-name="${escapeAttr(name)}"
                           data-quality-type="reading"
                           data-quality-mandatory="${mandatory}"
                           placeholder="Enter new reading e.g. 250 bar" />
                  ` : `
                    <select class="qualityValueInput"
                            data-quality-name="${escapeAttr(name)}"
                            data-quality-type="status"
                            data-quality-mandatory="${mandatory}">
                      <option value="">Select Status</option>
                      <option value="OK">OK</option>
                      <option value="NOT OK">NOT OK</option>
                    </select>
                  `}
                </div>
              </div>
            </div>
          `;
        }

        if (qp.inputType === "reading") {
          return `
            <div class="quality-entry-row">
              <label>${label}${qp.mandatory === true ? " *" : ""}</label>
              <input type="text"
                     class="qualityValueInput"
                     data-quality-name="${escapeAttr(name)}"
                     data-quality-type="reading"
                     data-quality-mandatory="${mandatory}"
                     placeholder="Enter reading e.g. 250 bar" />
            </div>
          `;
        }

        return `
          <div class="quality-entry-row">
            <label>${label}${qp.mandatory === true ? " *" : ""}</label>
            <select class="qualityValueInput"
                    data-quality-name="${escapeAttr(name)}"
                    data-quality-type="status"
                    data-quality-mandatory="${mandatory}">
              <option value="">Select Status</option>
              <option value="OK">OK</option>
              <option value="NOT OK">NOT OK</option>
            </select>
          </div>
        `;
      }).join("");
    }
  }

  if (recheckInput) {
    recheckInput.onchange = () => {
      renderCheckpointFields(card);
      updateSummaryDebounced();
    };
  }

  card.querySelectorAll(".qualityRecheckPointInput").forEach(chk => {
    chk.onchange = () => {
      const box = chk.closest(".quality-entry-row")?.querySelector(".qualityRecheckValueBox");
      if (box) box.style.display = chk.checked ? "block" : "none";

      if (!chk.checked && box) {
        box.querySelectorAll(".qualityValueInput").forEach(inp => inp.value = "");
      }

      updateSummaryDebounced();
    };
  });

  card.querySelectorAll(".qualityValueInput").forEach(inp => {
    inp.oninput = () => updateSummaryDebounced();
    inp.onchange = () => updateSummaryDebounced();
  });

  if (std && workNature !== "Normal") {
    std.value = "0";
  }

  updateSummaryDebounced();
}

function recalcStdFromCheckpoints(card) {
  const std = card.querySelector(".standardTime");
  const cps = Array.from(card.querySelectorAll(".workCheckpointInput"));
  if (!std) return;

  if (!cps.length) {
    const base = Number(card.dataset.baseStd || std.value || 0);
    std.value = String(base);
    return;
  }

  const selectedWithStd = cps
    .filter(cb => cb.checked && !cb.disabled)
    .reduce((sum, cb) => sum + Number(cb.dataset.std || 0), 0);

  const totalWithStd = cps
    .filter(cb => !cb.disabled)
    .reduce((sum, cb) => sum + Number(cb.dataset.std || 0), 0);

  if (totalWithStd > 0 || selectedWithStd > 0) {
    std.value = String(selectedWithStd);
  } else {
    std.value = "0";
  }
}

function getCheckedValues(card, selector) {
  return Array.from(card.querySelectorAll(selector))
    .filter(x => x.checked)
    .map(x => x.value)
    .filter(Boolean);
}

function getCheckedBookingPoints(card) {
  return Array.from(card.querySelectorAll(".bpCheck"))
    .filter(x => x.checked && !x.disabled)
    .map(x => {
      const row = x.closest(".booking-point-row");
      const bookInput = row?.querySelector(".bpBookTime");

      const maxRemaining = Number(x.dataset.remaining || x.dataset.time || 0);
      let bookedTime = Number(bookInput?.value || maxRemaining || 0);

      if (bookedTime < 0) bookedTime = 0;
      if (maxRemaining > 0 && bookedTime > maxRemaining) bookedTime = maxRemaining;

      return {
        name: x.value,
        standardTime: bookedTime,
        bookedTime: bookedTime,
        originalTime: Number(x.dataset.originalTime || 0),
        consumedTime: Number(x.dataset.consumed || 0),
        remainingTime: maxRemaining,
        status: x.dataset.status || "PENDING"
      };
    })
    .filter(x => x.name && Number(x.bookedTime || 0) > 0);
}

// ✅ Get completed booking points from backend
// ✅ Get completed/partial booking points from DB
async function getCompletedBookingPointsFromSheet(machine, machineCategory, department, subWork) {
  try {
    const apiBaseUrl = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";

    const params = new URLSearchParams({
      machine: machine || "",
      machineCategory: machineCategory || "",
      department: department || "",
      subWork: subWork || ""
    });

    const res = await fetch(`${apiBaseUrl}/api/production/booking-status?${params.toString()}`);
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) return [];

    const completed = Array.isArray(data.items) ? data.items : [];

    return completed.map((x) => {
      const std = Number(x.standardTime || 0);
      const consumed = Number(x.consumedTime || 0);
      const remaining = Number(x.remainingTime || Math.max(0, std - consumed));
      const status = String(x.status || (remaining <= 0 ? "DONE" : consumed > 0 ? "PARTIAL" : "PENDING")).trim();

      return {
        point: String(x.point || "").trim(),
        standardTime: std,
        consumedTime: consumed,
        remainingTime: remaining,
        completionPct: Number(x.completionPct || (std > 0 ? Math.min(100, (consumed / std) * 100) : 0)),
        status
      };
    }).filter(x => x.point);
  } catch (err) {
    console.warn("Completed booking fetch from DB failed:", err);
    return [];
  }
}
function buildBookingStatusMap(completedBooking) {
  const map = {};

  (completedBooking || []).forEach((x) => {
    const point = String(x.point || x.name || x || "").trim();
    if (!point) return;

    const std = Number(x.standardTime || 0);
    const consumed = Number(x.consumedTime || 0);
    const remaining = Number(x.remainingTime || Math.max(0, std - consumed));
    const status = String(x.status || "").trim().toUpperCase();

    map[point.toLowerCase()] = {
      point,
      standardTime: std,
      consumedTime: consumed,
      remainingTime: remaining,
      completionPct: Number(x.completionPct || 0),
      status: status || (remaining <= 0 ? "DONE" : consumed > 0 ? "PARTIAL" : "PENDING"),
      isDone: status === "DONE" || (std > 0 && remaining <= 0)
    };
  });

  return map;
}

function getBookingPointStatus(statusMap, pointName, configuredStd) {
  const name = String(pointName || "").trim();
  const old = statusMap[String(name).toLowerCase()];

  if (!old) {
    return {
      point: name,
      standardTime: Number(configuredStd || 0),
      consumedTime: 0,
      remainingTime: Number(configuredStd || 0),
      completionPct: 0,
      status: "PENDING",
      isDone: false
    };
  }

  const configured = Number(configuredStd || 0);
  const std = Number(old.standardTime || configured || 0);
  const consumed = Number(old.consumedTime || 0);
  const remaining = std > 0 ? Math.max(0, std - consumed) : Number(old.remainingTime || 0);
  const isDone = String(old.status || "").toUpperCase() === "DONE" || (std > 0 && remaining <= 0);

  return {
    point: name,
    standardTime: std,
    consumedTime: consumed,
    remainingTime: remaining,
    completionPct: std > 0 ? Math.min(100, (consumed / std) * 100) : Number(old.completionPct || 0),
    status: isDone ? "DONE" : consumed > 0 ? "PARTIAL" : "PENDING",
    isDone
  };
}

async function getCompletedQualityPointsFromSheet(machine, machineCategory, department, subWork) {
  try {
    const apiBaseUrl = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";

    const params = new URLSearchParams({
      machine: machine || "",
      machineCategory: machineCategory || "",
      department: department || "",
      subWork: subWork || ""
    });

    const res = await fetch(`${apiBaseUrl}/api/production/quality-status?${params.toString()}`);
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) return [];

    return Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    console.warn("Completed quality fetch from DB failed:", err);
    return [];
  }
}

function getQualityValues(card) {
  return Array.from(card.querySelectorAll(".qualityValueInput"))
    .filter(inp => {
      const box = inp.closest(".qualityRecheckValueBox");

      // If this quality point is already done and Recheck is NOT selected,
      // ignore it completely so mandatory validation will not trigger.
      if (box) {
        const recheck = inp.closest(".quality-entry-row")?.querySelector(".qualityRecheckPointInput");
        return recheck?.checked === true;
      }

      return true;
    })
    .map(inp => ({
      point: inp.dataset.qualityName || "",
      inputType: inp.dataset.qualityType || "status",
      mandatory: inp.dataset.qualityMandatory === "1",
      value: (inp.value || "").trim()
    }))
    .filter(q => q.point);
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

      <div class="field workCheckpointField" style="display:none; grid-column: 1 / -1;">
        <label>Sub-Sub Work / Booking Checkpoints</label>
        <div class="checkpoint-list workCheckpointList"></div>
      </div>

      <div class="field qualityRecheckField" style="display:none; grid-column: 1 / -1;">
  <label class="quality-recheck-line">
    <input type="checkbox" class="qualityRecheckInput" />
    As you are doing Rework/Other, do you want to check Quality Point again?
  </label>
</div>

<div class="field qualityCheckpointField" style="display:none; grid-column: 1 / -1;">
  <label>Quality Checkpoints</label>
  <div class="checkpoint-list qualityCheckpointList"></div>
</div>

      <div class="field">
        <label>Work Nature</label>
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
          ${(rootAreas || []).map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join("")}
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

      <div class="field efficiencyReasonField" style="display:none; grid-column: 1 / -1;">
        <label>Reason for Low Efficiency (Required when Actual Time > 120% of Standard Time)</label>
        <input class="efficiencyReasonInput" type="text" placeholder="Example: material issue / re-setting / tool problem / drawing clarification / waiting..."/>
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
  const efficiencyReasonField = card.querySelector(".efficiencyReasonField");
  const efficiencyReasonInput = card.querySelector(".efficiencyReasonInput");
  const rootAreaField = card.querySelector(".rootAreaField");
  const rootAreaSelect = card.querySelector(".rootAreaSelect");

  function checkEfficiencyReason() {
    const standard = parseInt(std?.value || "0", 10) || 0;
    const actual = parseInt(act?.value || "0", 10) || 0;
    const needsReason = standard > 0 && actual > (standard * 1.2);

    if (efficiencyReasonField) {
      efficiencyReasonField.style.display = needsReason ? "flex" : "none";
    }

    if (!needsReason && efficiencyReasonInput) {
      efficiencyReasonInput.value = "";
    }
  }

  function applyCatalogFromMachine() {
    const machineName = machineSel?.value || "";
    const typeId = getTypeIdForMachineName(machineName);
    const catalog = getCatalogForType(typeId);

    card.dataset.typeId = typeId || "";

    setDeptOptions(dept, catalog.mainWorks);

    sub.innerHTML = `<option value="">Select Sub Work</option>`;
    sub.disabled = true;
    std.value = "0";
    renderCheckpointFields(card);

    checkEfficiencyReason();
  }

  machineSel.onchange = () => {
    applyCatalogFromMachine();
    checkEfficiencyReason();
    updateSummaryDebounced();
  };

  dept.onchange = () => {
    const dep = dept.value;
    const typeId = card.dataset.typeId || "";
    const catalog = getCatalogForType(typeId);

    const items = Array.isArray(catalog.subWorks?.[dep]) ? catalog.subWorks[dep] : [];
    setSubWorkOptions(sub, items);

    std.value = "0";
    renderCheckpointFields(card);
    checkEfficiencyReason();
    updateSummaryDebounced();
  };

 sub.onchange = () => {
  const opt = sub.selectedOptions[0];
  const t = opt ? parseInt(opt.dataset.time || "0", 10) : 0;

  std.value = String(t);
  card.dataset.baseStd = String(t);

  const selectedSubWork = opt?.value || "";
  const typeId = card.dataset.typeId || "";
  const catalog = getCatalogForType(typeId);

  const deptName = dept.value;
  const subList = catalog?.subWorks?.[deptName] || [];
  const subObj = subList.find(s => s.name === selectedSubWork);

  // 🔥 NEW: Booking Points (priority)
  renderBookingPoints(card, subObj);

  // Existing logic (keep)
  renderCheckpointFields(card);

  checkEfficiencyReason();
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

  const subObj = getCurrentSubWorkItem(card);

  const workNature = card.querySelector(".typeSelect")?.value || "Normal";
const recheckBox = card.querySelector(".qualityRecheckField");
const recheckInput = card.querySelector(".qualityRecheckInput");

if (recheckBox) {
  if (workNature === "Rework" || workNature === "Other") {
    recheckBox.style.display = "flex";
  } else {
    recheckBox.style.display = "none";
    if (recheckInput) recheckInput.checked = false;
  }
}

  renderBookingPoints(card, subObj);
  renderCheckpointFields(card);

  checkEfficiencyReason();
  updateSummaryDebounced();
};

  act.oninput = () => {
    checkEfficiencyReason();
    updateSummaryDebounced();
  };

  act.onblur = () => {
    checkEfficiencyReason();
    updateSummaryDebounced();
  };

  std.onchange = () => {
    checkEfficiencyReason();
    updateSummaryDebounced();
  };

  if (efficiencyReasonInput) {
    efficiencyReasonInput.oninput = () => updateSummaryDebounced();
  }

  if (rootAreaSelect) {
    rootAreaSelect.onchange = () => updateSummaryDebounced();
  }
}
async function renderBookingPoints(card, subObj) {
  let box = card.querySelector(".bookingPointsBox");

  if (!box) {
    box = document.createElement("div");
    box.className = "bookingPointsBox";
    box.style.marginTop = "10px";
    card.appendChild(box);
  }

  const workNature = card.querySelector(".typeSelect")?.value || "Normal";
  const std = card.querySelector(".standardTime");
  const machine = card.querySelector(".machineSelect")?.value || "";
  const department = card.querySelector(".deptSelect")?.value || "";
  const subWork = card.querySelector(".subWorkSelect")?.value || "";

  const machineObj = (machines || []).find(m => String(m.name) === String(machine));
  const typeId = String(machineObj?.type || "");
  const typeObj = (adminOverrides?.machineTypes || machineTypes || []).find(t => String(t.id) === typeId);
  const machineCategory = typeObj?.name || typeId || "";

  if (workNature !== "Normal") {
    box.style.display = "none";
    box.innerHTML = "";
    if (std) std.value = "0";
    updateSummaryDebounced();
    return;
  }

  const bookingPoints = normalizeBookingPoints(subObj?.checkpoints || []);

  if (!subObj || bookingPoints.length === 0 || !machine || !department || !subWork) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px;">Booking Points</div>
    <div class="small-hint">Checking booking point remaining time...</div>
  `;

  const completed = await getCompletedBookingPointsFromSheet(
    machine,
    machineCategory,
    department,
    subWork
  );

  const statusMap = buildBookingStatusMap(completed);

  box.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px;">Booking Points</div>
    <div class="small-hint" style="margin-bottom:8px;">
      Select completed/partially completed points. Book Min is full remaining time by default; change it only for partial booking.
    </div>

    ${bookingPoints.map((cp) => {
      const name = String(cp.name || "").trim();
      if (!name) return "";

      const configuredStd = Number(cp.standardTime || 0);
      const st = getBookingPointStatus(statusMap, name, configuredStd);

      const isDone = st.isDone === true;
      const isPartial = !isDone && String(st.status || "").toUpperCase() === "PARTIAL";

      const remaining = isDone
        ? 0
        : isPartial
          ? Number(st.remainingTime || 0)
          : Number(configuredStd || st.standardTime || 0);

      const labelText = isDone
        ? `${name} — Completed`
        : isPartial
          ? `${name} (${remaining.toFixed(1)} min remaining / ${Number(st.standardTime || configuredStd || 0)} min)`
          : `${name} (${Number(configuredStd || 0)} min)`;

      return `
        <div class="booking-point-row ${isDone ? "booking-point-done" : isPartial ? "booking-point-partial" : ""}"
             style="display:grid; grid-template-columns: 1fr 130px; gap:12px; align-items:center; margin:8px 0;">
          
          <label style="display:flex; gap:8px; align-items:center;">
            <input type="checkbox"
                   class="bpCheck"
                   value="${escapeAttr(name)}"
                   data-time="${escapeAttr(remaining)}"
                   data-original-time="${escapeAttr(configuredStd)}"
                   data-consumed="${escapeAttr(st.consumedTime || 0)}"
                   data-remaining="${escapeAttr(remaining)}"
                   data-status="${escapeAttr(st.status || "PENDING")}"
                   ${isDone ? "disabled" : "checked"} />
            <span>${escapeHtml(labelText)}</span>
          </label>

          <div style="display:flex; align-items:center; gap:6px;">
            <span class="small-hint">Book</span>
            <input type="number"
                   class="bpBookTime"
                   min="0"
                   max="${escapeAttr(remaining)}"
                   value="${escapeAttr(remaining)}"
                   data-point="${escapeAttr(name)}"
                   data-max="${escapeAttr(remaining)}"
                   ${isDone ? "disabled" : ""}
                   style="width:72px; padding:6px 8px; border:1px solid #d0d7de; border-radius:8px;" />
            <span class="small-hint">min</span>
          </div>
        </div>
      `;
    }).join("")}
  `;

  function recalcBookingStd() {
    let total = 0;

    box.querySelectorAll(".bpCheck").forEach(chk => {
      const row = chk.closest(".booking-point-row");
      const inp = row?.querySelector(".bpBookTime");

      if (!inp) return;

      if (!chk.checked || chk.disabled) {
        inp.disabled = true;
        total += 0;
        return;
      }

      inp.disabled = false;

      const max = Number(inp.dataset.max || chk.dataset.remaining || chk.dataset.time || 0);
      let val = Number(inp.value || 0);

      if (val < 0) val = 0;
      if (max > 0 && val > max) val = max;

      inp.value = String(Number(val.toFixed(1)));
      total += val;
    });

    if (std) std.value = String(Number(total.toFixed(1)));
    updateSummaryDebounced();
  }

  box.querySelectorAll(".bpCheck").forEach(chk => {
    chk.onchange = recalcBookingStd;
  });

  box.querySelectorAll(".bpBookTime").forEach(inp => {
    inp.oninput = recalcBookingStd;
    inp.onchange = recalcBookingStd;
  });

  recalcBookingStd();
}

function deleteLastWorkCard() {
  const cards = document.querySelectorAll(".work-card");
  if (cards.length === 0) return;
  cards[cards.length - 1].remove();
  renumberWorkCards();
  updateSummaryDebounced();
}

// ===================== SUMMARY =====================
function updateSummary() {
  const available = getShiftAvailableMinutes();

  let utilized = 0;
  let standardBooked = 0;
  document.querySelectorAll(".work-card").forEach((card) => {
    utilized += parseInt(card.querySelector(".actualTime")?.value || "0", 10) || 0;
    standardBooked += parseInt(card.querySelector(".standardTime")?.value || "0", 10) || 0;
  });

  let remaining = available - utilized;
  if (remaining < 0) remaining = 0;

  const productivity = available > 0 ? ((standardBooked / available) * 100) : 0;

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
  const majorLossReason = document.getElementById("lossReasonSelect")?.value || "";
  const majorLossRemark = (document.getElementById("lossRemark")?.value || "").trim();
  const flexibleShiftMinutes = Number(document.getElementById("flexibleShiftMinutes")?.value || 0);

  const shiftObj = shifts.find(s => String(s.id ?? s.name) === String(shiftId)) || null;
  const empObj = employees.find(e => String(e.empId) === String(empId)) || null;

  const shiftAvailable = getShiftAvailableMinutes();

  const works = [];
  let utilized = 0;
  let standardBooked = 0;

  document.querySelectorAll(".work-card").forEach((card) => {
    const machine = card.querySelector(".machineSelect")?.value || "";
    const department = card.querySelector(".deptSelect")?.value || "";
    const subWork = card.querySelector(".subWorkSelect")?.value || "";
    const type = card.querySelector(".typeSelect")?.value || "Normal";
    const description = (card.querySelector(".descInput")?.value || "").trim();
    const rootArea = card.querySelector(".rootAreaSelect")?.value || "";
    const efficiencyReason = (card.querySelector(".efficiencyReasonInput")?.value || "").trim();

    const workCheckpoints = getCheckedBookingPoints(card);
    const qualityValues = getQualityValues(card);

    const standard = parseInt(card.querySelector(".standardTime")?.value || "0", 10) || 0;
    const actual = parseInt(card.querySelector(".actualTime")?.value || "0", 10) || 0;

    const hasAnything = machine || department || subWork || description || actual > 0 || standard > 0;
    if (!hasAnything) return;

    const missingQuality = qualityValues.filter(q => q.mandatory && !q.value);
    if (missingQuality.length > 0) {
      alert(
        "Please fill mandatory quality fields:\n\n" +
        missingQuality.map(m => "- " + m.point).join("\n")
      );
      throw new Error("Quality validation failed");
    }

    utilized += actual;
    standardBooked += standard;

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
      efficiencyReason,
      workCheckpoints,
      quality: qualityValues,
      standardTime: standard,
      actualTime: actual,
    });
  });

  const remaining = Math.max(0, shiftAvailable - utilized);
  const productivity = shiftAvailable > 0 ? Number(((standardBooked / shiftAvailable) * 100).toFixed(1)) : 0;

  return {
    secret: window.SPWT_CONFIG?.SECRET || "",
    workDate,
    shiftId: shiftObj?.id ?? shiftId,
    shiftName: shiftObj?.name || "",
    shiftStart: shiftObj?.start || "",
    shiftEnd: shiftObj?.end || "",
    breakMinutes: shiftObj?.breakMinutes || 0,
    workType,
    majorLossReason,
    majorLossRemark,
    flexibleShiftMinutes,
    teamMemberId: empObj?.empId || empId,
    teamMemberName: empObj?.name || "",
    summary: { shiftAvailable, utilized, remaining, productivity },
    works,
  };
}

// ===================== ENTRY VALIDATION HELPERS =====================
function getDuplicateWorkKeys(works) {
  const seen = new Map();
  const duplicates = [];

  (works || []).forEach((w, idx) => {
    const key = [
      String(w.machine || "").trim().toLowerCase(),
      String(w.department || "").trim().toLowerCase(),
      String(w.subWork || "").trim().toLowerCase(),
      String(w.type || "Normal").trim().toLowerCase(),
      String(w.description || "").trim().toLowerCase(),
      String(w.rootArea || "").trim().toLowerCase(),
    ].join("|");

    if (!String(w.machine || "").trim() && !String(w.department || "").trim() && !String(w.subWork || "").trim()) return;

    if (seen.has(key)) {
      duplicates.push({ first: seen.get(key) + 1, second: idx + 1 });
    } else {
      seen.set(key, idx);
    }
  });

  return duplicates;
}

function validateEntryPayload(payload) {
  const errs = [];
  const warnings = [];

  if (!payload.workDate) errs.push("Work Date is required");
  if (!payload.shiftId) errs.push("Shift is required");
  if (!payload.teamMemberId) errs.push("Team Member is required");
  const sh = (shifts || []).find(s => String(s.id ?? s.name) === String(payload.shiftId));
  if (sh?.flexible === true && (!payload.flexibleShiftMinutes || Number(payload.flexibleShiftMinutes) <= 0)) errs.push("Flexible Shift Minutes is required for flexible shift");
  if (!payload.works || payload.works.length === 0) errs.push("Add at least 1 work entry");

  (payload.works || []).forEach((w, idx) => {
    const i = idx + 1;
    if (!w.machine) errs.push(`Work ${i}: Machine is required`);
    if (!w.department) errs.push(`Work ${i}: Department is required`);
    if (!w.subWork) errs.push(`Work ${i}: Sub Work is required`);
    if (!w.actualTime || Number(w.actualTime) <= 0) errs.push(`Work ${i}: Actual Time must be > 0`);

    if (Number(w.standardTime || 0) > 0 && Number(w.actualTime || 0) > Number(w.standardTime || 0) * 1.2 && !String(w.efficiencyReason || "").trim()) {
      errs.push(`Work ${i}: Reason for low efficiency is required because Actual Time is more than 120% of Standard Time`);
    }

    const t = String(w.type || "").toLowerCase();
    if ((t === "other" || t === "rework") && !String(w.description || "").trim()) {
      errs.push(`Work ${i}: Description required for Other/Rework`);
    }
    if (t === "rework" && !String(w.rootArea || "").trim()) {
      errs.push(`Work ${i}: Root Area is required for Rework`);
    }
  });

  (payload.works || []).forEach((w, idx) => {
    if (Number(w.standardTime || 0) > 0 && Number(w.actualTime || 0) > Number(w.standardTime || 0) * 1.2) {
      warnings.push(`Work ${idx + 1}: Actual Time is more than 120% of Standard Time; reason will be saved in Google Sheet`);
    }
  });

  getDuplicateWorkKeys(payload.works).forEach(d => {
    warnings.push(`Duplicate-looking entry: Work ${d.second} looks same as Work ${d.first}`);
  });

  if (payload.summary?.shiftAvailable > 0 && payload.summary?.utilized > payload.summary?.shiftAvailable) {
    warnings.push(`Utilized time (${payload.summary.utilized} min) is more than shift available time (${payload.summary.shiftAvailable} min)`);
  }

  return { errs, warnings };
}

function renumberWorkCards() {
  document.querySelectorAll(".work-card").forEach((card, idx) => {
    card.dataset.index = String(idx + 1);
    const title = card.querySelector(".work-title");
    if (title) title.textContent = `Work ${idx + 1}`;
  });
  workCount = document.querySelectorAll(".work-card").length;
}


function showEntryMessage(message, type = "error") {
  let box = document.getElementById("entryMessageBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "entryMessageBox";
    box.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;max-width:720px;width:calc(100% - 32px);padding:12px 16px;border-radius:12px;box-shadow:0 6px 22px rgba(0,0,0,.22);font-weight:600;white-space:pre-line;display:none;";
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.style.background = type === "success" ? "#e8fff0" : type === "warn" ? "#fff8df" : "#fff1f1";
  box.style.color = type === "success" ? "#105c2f" : type === "warn" ? "#6b4b00" : "#8a1f1f";
  box.style.border = type === "success" ? "1px solid #84d39b" : type === "warn" ? "1px solid #e2c34d" : "1px solid #e39797";
  box.style.display = "block";
  clearTimeout(window.__spwtEntryMsgTimer);
  window.__spwtEntryMsgTimer = setTimeout(() => { box.style.display = "none"; }, 7000);
}

function focusFirstEntryError() {
  const cards = Array.from(document.querySelectorAll(".work-card"));
  for (const card of cards) {
    const std = Number(card.querySelector(".standardTime")?.value || 0);
    const act = Number(card.querySelector(".actualTime")?.value || 0);
    const reasonField = card.querySelector(".efficiencyReasonField");
    const reasonInput = card.querySelector(".efficiencyReasonInput");
    if (std > 0 && act > std * 1.2 && reasonInput && !reasonInput.value.trim()) {
      if (reasonField) reasonField.style.display = "flex";
      reasonInput.focus();
      reasonInput.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
  }
  return false;
}

function buildDbSubmitPayload(payload) {
  const selectedEmpId =
    payload.empId ||
    payload.empCode ||
    payload.employeeId ||
    payload.teamMemberId ||
    payload.teamMember ||
    document.getElementById("employeeSelect")?.value ||
    "";

  const selectedShiftId =
    payload.shiftId ||
    payload.shiftCode ||
    payload.shift ||
    document.getElementById("shiftSelect")?.value ||
    "";

  const empObj = (employees || []).find(e =>
    String(e.empId) === String(selectedEmpId) ||
    String(e.id) === String(selectedEmpId)
  );

  const shiftObj = (shifts || []).find(s =>
    String(s.id ?? s.name) === String(selectedShiftId)
  );

  const employeeName =
    payload.empName ||
    payload.teamMemberName ||
    payload.employeeName ||
    empObj?.name ||
    "";

  const majorLossReason =
    payload.majorLossReason ||
    payload.lossReason ||
    document.getElementById("lossReasonSelect")?.value ||
    "";

  const majorLossMinutes =
    Number(
      payload.majorLossMinutes ??
      payload.lossMinutes ??
      document.getElementById("lossRemark")?.value ??
      0
    ) || 0;

  const shiftAvailable = Number(payload.summary?.shiftAvailable || payload.shiftAvailable || 0);
  const utilized = Number(payload.summary?.utilized || payload.utilized || 0);

  return {
    ...payload,

    // Backend-compatible employee fields
    empCode: selectedEmpId,
    empName: employeeName,

    // Backend-compatible shift fields
    shiftCode: selectedShiftId,
    shiftName: shiftObj?.name || payload.shiftName || selectedShiftId || "",
    shiftStart: shiftObj?.start || payload.shiftStart || "",
    shiftEnd: shiftObj?.end || payload.shiftEnd || "",
    breakMinutes: Number(shiftObj?.breakMinutes || payload.breakMinutes || 0),

    workType: payload.workType || document.getElementById("workTypeTop")?.value || "Normal",

    grossShiftAvailable: shiftAvailable + majorLossMinutes,
    shiftAvailable,

    majorLossReason,
    majorLossMinutes,

    totalActualMinutes: utilized,

    // Backend accepts works, but lines is clearer and safer
    lines: (payload.works || []).map(w => ({
      ...w,

      machine: w.machine || "",
      machineTypeCode: w.machineTypeId || w.machineTypeCode || "",
      machineCategory: w.machineCategory || "",

      department: w.department || "",
      subWork: w.subWork || "",

      type: w.type || "Normal",
      actualTime: Number(w.actualTime || 0),
      standardTime: Number(w.standardTime || 0),

      rootArea: w.rootArea || "",
      efficiencyReason: w.efficiencyReason || "",
      description: w.description || "",

      // Backend expects qualityCheckpoints or qualityPoints
      qualityCheckpoints: Array.isArray(w.quality)
        ? w.quality
        : (Array.isArray(w.qualityCheckpoints) ? w.qualityCheckpoints : []),

      // Backend expects workCheckpoints or bookingPoints
      workCheckpoints: Array.isArray(w.workCheckpoints)
        ? w.workCheckpoints
        : []
    })),

    source: "electron-db"
  };
}

async function submitToDbApi(payload) {
  const apiBaseUrl = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";

  const res = await fetch(`${apiBaseUrl}/api/production/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || `DB submit failed with status ${res.status}`);
  }

  return data;
}
// ===================== SUBMIT (LOCKED) =====================
async function submit() {
  if (isSubmitting) return;
  isSubmitting = true;

  const submitBtn = document.getElementById("submitBtn");
  const saveBtn = document.getElementById("saveBtn");

  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }
    if (saveBtn) saveBtn.disabled = true;

    const payload = buildPayload();
    const { errs, warnings } = validateEntryPayload(payload);

    if (errs.length > 0) {
      showEntryMessage("Please fix:\n• " + errs.join("\n• "), "error");
      focusFirstEntryError();
      return;
    }

    if (warnings.length > 0) {
      showEntryMessage("Warning:\n• " + warnings.join("\n• ") + "\n\nPress Submit again if everything is correct.", "warn");
      const now = Date.now();
      if (!window.__spwtLastWarningSubmit || now - window.__spwtLastWarningSubmit > 10000) {
        window.__spwtLastWarningSubmit = now;
        return;
      }
    }

    const submitTarget = window.SPWT_CONFIG?.SUBMIT_TARGET || "sheets";
    const enableSheetsFallback = window.SPWT_CONFIG?.ENABLE_SHEETS_FALLBACK === true;

    let submitResult = null;
    let savedTo = "";

    if (submitTarget === "db") {
      try {
        const dbPayload = buildDbSubmitPayload(payload);
        submitResult = await submitToDbApi(dbPayload);
        savedTo = "DB";

        // Keep DB response attached for summary/debug only.
        payload.dbSubmitResult = submitResult;
        payload.dbEntryNo = submitResult.entryNo || "";
      } catch (dbErr) {
        console.error("DB submit failed:", dbErr);

        if (!enableSheetsFallback) {
          showEntryMessage("DB Save Failed: " + (dbErr?.message || "Unknown error"), "error");
          focusFirstEntryError();
          return;
        }

        console.warn("Trying Google Sheet fallback because DB submit failed...");
        savedTo = "Google Sheet fallback";
      }
    }

    if (submitTarget !== "db" || savedTo === "Google Sheet fallback") {
      const webAppUrl = window.SPWT_CONFIG?.SHEETS_WEBAPP_URL;
      if (!webAppUrl) {
        showEntryMessage("Google Sheet URL not found in renderer/config.js", "error");
        return;
      }

      const res = await window.api.submitToSheets({ webAppUrl, data: payload });
      if (!res || !res.ok) {
        showEntryMessage("Save Failed: " + (res?.error || "Unknown"), "error");
        focusFirstEntryError();
        return;
      }

      submitResult = res;
      savedTo = savedTo || "Google Sheet";
    }

    showEntryMessage(`Saved successfully to ${savedTo}.`, "success");
    showSummaryScreen(payload);

  } catch (e) {
    console.error(e);
    showEntryMessage("Submit error: " + (e?.message || e), "error");
    focusFirstEntryError();
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
  if (tabId === "tabLossReasons") renderAdminLossReasons();
  if (tabId === "tabRootAreas") renderAdminRootAreas();
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
  const host = document.getElementById("shiftsList");
  if (!host) return;
  adminOverrides.shifts = adminOverrides.shifts || [];

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th><th>Start</th><th>End</th><th>Break</th><th>Flexible?</th><th>Active</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.shifts.map((s, idx) => `
          <tr>
            <td><input class="admin-input" data-sh-idx="${idx}" data-field="name" value="${escapeAttr(s.name || '')}"/></td>
            <td><input class="admin-input" data-sh-idx="${idx}" data-field="start" type="time" value="${escapeAttr(s.start || '')}" ${s.flexible === true ? 'disabled' : ''}/></td>
            <td><input class="admin-input" data-sh-idx="${idx}" data-field="end" type="time" value="${escapeAttr(s.end || '')}" ${s.flexible === true ? 'disabled' : ''}/></td>
            <td><input class="admin-input" data-sh-idx="${idx}" data-field="breakMinutes" type="number" min="0" value="${Number(s.breakMinutes || 0)}" ${s.flexible === true ? 'disabled' : ''}/></td>
            <td style="text-align:center;"><input type="checkbox" data-sh-idx="${idx}" data-field="flexible" ${s.flexible === true ? 'checked' : ''}/></td>
            <td style="text-align:center;"><input type="checkbox" data-sh-idx="${idx}" data-field="active" ${s.active !== false ? 'checked' : ''}/></td>
            <td><button class="btn grey" data-sh-del="${idx}">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="small-hint">Flexible shift is useful for overtime hours. Operator enters available minutes during entry.</div>
  `;

  host.querySelectorAll('[data-sh-idx]').forEach(el => {
    const idx = Number(el.getAttribute('data-sh-idx'));
    const field = el.getAttribute('data-field');
    const apply = () => {
      if (field === 'breakMinutes') adminOverrides.shifts[idx][field] = Number(el.value || 0);
      else if (field === 'active' || field === 'flexible') adminOverrides.shifts[idx][field] = !!el.checked;
      else adminOverrides.shifts[idx][field] = el.value;
      if (field === 'flexible') renderAdminShifts();
    };
    el.oninput = apply;
    el.onchange = apply;
  });

  host.querySelectorAll('[data-sh-del]').forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute('data-sh-del'));
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
// ----- LOSS REASONS -----
function renderAdminLossReasons() {
  const host = document.getElementById("lossReasonsList");
  if (!host) return;

  adminOverrides.lossReasons = normalizeNameList(adminOverrides.lossReasons, []);

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Loss Reason</th>
          <th style="width:160px;">Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.lossReasons.map((r, idx) => `
          <tr>
            <td>
              <input class="admin-input"
                     data-loss-idx="${idx}"
                     value="${escapeAttr(r || "")}"
                     placeholder="No Power / No Load / Meeting / 5S / Short Leave" />
            </td>
            <td>
              <button class="btn grey" data-loss-del="${idx}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="small-hint">Only define loss reason here. Operator enters loss time during entry.</div>
  `;

  host.querySelectorAll("[data-loss-idx]").forEach(inp => {
    inp.oninput = () => {
      const idx = Number(inp.getAttribute("data-loss-idx"));
      adminOverrides.lossReasons[idx] = inp.value.trim();
      lossReasons = normalizeNameList(adminOverrides.lossReasons, []);
    };
  });

  host.querySelectorAll("[data-loss-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-loss-del"));
      adminOverrides.lossReasons.splice(idx, 1);
      lossReasons = normalizeNameList(adminOverrides.lossReasons, []);
      renderAdminLossReasons();
    };
  });
}

function adminAddLossReason() {
  if (!mustAdmin()) return;
  adminOverrides.lossReasons = normalizeNameList(adminOverrides.lossReasons, []);
  adminOverrides.lossReasons.push("");
  renderAdminLossReasons();
}


// ----- REWORK ROOT AREAS -----
function renderAdminRootAreas() {
  const host = document.getElementById("rootAreasList");
  if (!host) return;

  adminOverrides.rootAreas = Array.isArray(adminOverrides.rootAreas)
    ? adminOverrides.rootAreas
    : [];

  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Root Area</th>
          <th style="width:160px;">Action</th>
        </tr>
      </thead>
      <tbody>
        ${adminOverrides.rootAreas.map((r, idx) => `
          <tr>
            <td>
              <input class="admin-input"
                     data-root-idx="${idx}"
                     value="${escapeAttr(r || "")}"
                     placeholder="Design / Manufacturing / Assembly / Supplier / Customer" />
            </td>
            <td>
              <button class="btn grey" data-root-del="${idx}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  host.querySelectorAll("[data-root-idx]").forEach(inp => {
    inp.oninput = () => {
      const idx = Number(inp.getAttribute("data-root-idx"));
      adminOverrides.rootAreas[idx] = inp.value.trim();
    };
  });

  host.querySelectorAll("[data-root-del]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-root-del"));
      adminOverrides.rootAreas.splice(idx, 1);
      renderAdminRootAreas();
    };
  });
}

function adminAddRootArea() {
  if (!mustAdmin()) return;
  adminOverrides.rootAreas = Array.isArray(adminOverrides.rootAreas)
    ? adminOverrides.rootAreas
    : [];

  adminOverrides.rootAreas.push("");
  renderAdminRootAreas();
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
  catalog.subWorks = catalog.subWorks && typeof catalog.subWorks === "object" ? catalog.subWorks : {};
  if (Object.prototype.hasOwnProperty.call(catalog.subWorks, "")) delete catalog.subWorks[""];

  if (!selectedDeptForTypeEdit || !catalog.mainWorks.includes(selectedDeptForTypeEdit)) {
    selectedDeptForTypeEdit = catalog.mainWorks[0] || "";
  }

  mainHost.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Main Work / Department</th>
          <th style="width:220px;">Action</th>
        </tr>
      </thead>
      <tbody>
        ${catalog.mainWorks.map((d, idx) => `
          <tr>
            <td><input class="admin-input" data-tmw-idx="${idx}" value="${escapeAttr(d)}"/></td>
            <td style="display:flex;gap:10px;">
              <button type="button" class="btn grey" data-tmw-edit="${idx}">Edit</button>
              <button type="button" class="btn grey" data-tmw-del="${idx}">Delete</button>
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

      if (!newName) {
        inp.value = oldName;
        return;
      }

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
      selectedDeptForTypeEdit = catalog.mainWorks[Number(btn.getAttribute("data-tmw-edit"))] || "";
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
  items.forEach(ensureSubWorkDetails);

  subHost.innerHTML = `
    <div class="admin-subwork-list">
      ${items.map((it, idx) => `
        <div class="admin-subwork-card wide-admin-card">
          <div class="admin-subwork-head">
            <div>
              <b>Sub Work ${idx + 1}</b>
              <div class="small-hint">Define base time, optional booking points, and optional quality points.</div>
            </div>
            <button type="button" class="btn grey" data-tsw-del="${idx}">Delete Sub Work</button>
          </div>

          <div class="admin-grid">
            <div class="field">
              <label>Sub Work Name</label>
              <input class="admin-input" data-tsw-idx="${idx}" data-field="name" value="${escapeAttr(it.name || "")}" />
            </div>

            <div class="field">
              <label>Base Std Time (min)</label>
              <input class="admin-input" data-tsw-idx="${idx}" data-field="standardTime" type="number" min="0" value="${Number(it.standardTime || 0)}" />
            </div>
          </div>

          <div class="admin-section-box">
            <div class="admin-subwork-head">
              <div>
                <b>Booking Points</b>
                <div class="small-hint">Operator will see checkbox list. Std time will be booked from selected points.</div>
              </div>
              <button type="button" class="btn blue" data-add-booking="${idx}">+ Add Booking Point</button>
            </div>

            <div class="mini-table">
              ${(it.checkpoints || []).map((bp, bpIdx) => `
                <div class="mini-row booking-row">
                  <input class="admin-input"
                         data-bp-time="${idx}:${bpIdx}"
                         type="number"
                         min="0"
                         value="${Number(bp.standardTime || 0)}"
                         placeholder="Std min" />

                  <input class="admin-input"
                         data-bp-name="${idx}:${bpIdx}"
                         value="${escapeAttr(bp.name || "")}"
                         placeholder="Description e.g. Motor wiring" />

                  <button type="button" class="btn grey" data-bp-del="${idx}:${bpIdx}">Delete</button>
                </div>
              `).join("") || `<div class="small-hint">No booking points. Full sub work standard time will be used.</div>`}
            </div>
          </div>

          <div class="admin-section-box">
            <div class="admin-subwork-head">
              <div>
                <b>Quality Points</b>
                <div class="small-hint">Operator enters reading/status only. Other details will be automatic.</div>
              </div>
              <button type="button" class="btn blue" data-add-quality="${idx}">+ Add Quality Point</button>
            </div>

            <div class="mini-table">
              ${(it.qualityCheckpoints || []).map((qp, qpIdx) => `
                <div class="mini-row quality-row">
                  <input class="admin-input"
                         data-qp-name="${idx}:${qpIdx}"
                         value="${escapeAttr(qp.name || "")}"
                         placeholder="Parameter e.g. Pressure / Leakage / Continuity" />

                  <select class="admin-select" data-qp-type="${idx}:${qpIdx}">
                    <option value="status" ${qp.inputType !== "reading" ? "selected" : ""}>OK / Not OK</option>
                    <option value="reading" ${qp.inputType === "reading" ? "selected" : ""}>Reading</option>
                  </select>

                  <label class="mini-check">
                    <input type="checkbox" data-qp-mandatory="${idx}:${qpIdx}" ${qp.mandatory === true ? "checked" : ""}/>
                    Mandatory
                  </label>

                  <button type="button" class="btn grey" data-qp-del="${idx}:${qpIdx}">Delete</button>
                </div>
              `).join("") || `<div class="small-hint">No quality points for this sub work.</div>`}
            </div>
          </div>
        </div>
      `).join("") || `<div class="small-hint">No sub work added for this department.</div>`}
    </div>
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
      items.splice(Number(btn.getAttribute("data-tsw-del")), 1);
      renderAdminWorkSub();
    };
  });

  subHost.querySelectorAll("[data-add-booking]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-add-booking"));
      ensureSubWorkDetails(items[idx]);
      items[idx].checkpoints.push({ name: "", standardTime: 0 });
      renderAdminWorkSub();
    };
  });

  subHost.querySelectorAll("[data-bp-name]").forEach(inp => {
    inp.oninput = () => {
      const [idx, bpIdx] = inp.getAttribute("data-bp-name").split(":").map(Number);
      items[idx].checkpoints[bpIdx].name = inp.value.trim();
    };
  });

  subHost.querySelectorAll("[data-bp-time]").forEach(inp => {
    inp.oninput = () => {
      const [idx, bpIdx] = inp.getAttribute("data-bp-time").split(":").map(Number);
      items[idx].checkpoints[bpIdx].standardTime = Number(inp.value || 0);
    };
  });

  subHost.querySelectorAll("[data-bp-del]").forEach(btn => {
    btn.onclick = () => {
      const [idx, bpIdx] = btn.getAttribute("data-bp-del").split(":").map(Number);
      items[idx].checkpoints.splice(bpIdx, 1);
      renderAdminWorkSub();
    };
  });

  subHost.querySelectorAll("[data-add-quality]").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-add-quality"));
      ensureSubWorkDetails(items[idx]);
      items[idx].qualityCheckpoints.push({
        name: "",
        inputType: "status",
        mandatory: false
      });
      renderAdminWorkSub();
    };
  });

  subHost.querySelectorAll("[data-qp-name]").forEach(inp => {
    inp.oninput = () => {
      const [idx, qpIdx] = inp.getAttribute("data-qp-name").split(":").map(Number);
      items[idx].qualityCheckpoints[qpIdx].name = inp.value.trim();
    };
  });

  subHost.querySelectorAll("[data-qp-type]").forEach(sel => {
    sel.onchange = () => {
      const [idx, qpIdx] = sel.getAttribute("data-qp-type").split(":").map(Number);
      items[idx].qualityCheckpoints[qpIdx].inputType = sel.value === "reading" ? "reading" : "status";
    };
  });

  subHost.querySelectorAll("[data-qp-mandatory]").forEach(chk => {
    chk.onchange = () => {
      const [idx, qpIdx] = chk.getAttribute("data-qp-mandatory").split(":").map(Number);
      items[idx].qualityCheckpoints[qpIdx].mandatory = chk.checked === true;
    };
  });

  subHost.querySelectorAll("[data-qp-del]").forEach(btn => {
    btn.onclick = () => {
      const [idx, qpIdx] = btn.getAttribute("data-qp-del").split(":").map(Number);
      items[idx].qualityCheckpoints.splice(qpIdx, 1);
      renderAdminWorkSub();
    };
  });
}

function adminAddSubWork() {
  if (!mustAdmin()) return;
  if (!selectedTypeForWorkEdit) return alert("Select a Machine Category first.");
  if (!selectedDeptForTypeEdit) return alert("Select a Main Work first.");

  const catalog = adminOverrides.workCatalogByType[selectedTypeForWorkEdit];
  if (!catalog) return alert("Catalog not found for selected category.");

  catalog.subWorks[selectedDeptForTypeEdit] = catalog.subWorks[selectedDeptForTypeEdit] || [];

  catalog.subWorks[selectedDeptForTypeEdit].push({
    name: "New Sub Work",
    standardTime: 0,
    checkpoints: [],
    qualityCheckpoints: []
  });

  renderAdminWorkSub();
}

function adminAddSubWork() {
  if (!mustAdmin()) return;
  if (!selectedTypeForWorkEdit) return alert("Select a Machine Category first.");
  if (!selectedDeptForTypeEdit) return alert("Select a Main Work first.");

  const catalog = adminOverrides.workCatalogByType[selectedTypeForWorkEdit];
  if (!catalog) return alert("Catalog not found for selected category.");

  catalog.subWorks[selectedDeptForTypeEdit] = catalog.subWorks[selectedDeptForTypeEdit] || [];
  catalog.subWorks[selectedDeptForTypeEdit].push({ name: "New Sub Work", standardTime: 0, checkpoints: [], qualityCheckpoints: [] });

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
function getCleanAdminOverridesForSave() {
  const clean = JSON.parse(JSON.stringify(adminOverrides || {}));

  clean.admin = clean.admin || { pin: "1234" };

  clean.machines = Array.isArray(clean.machines) ? clean.machines : [];
  clean.employees = Array.isArray(clean.employees) ? clean.employees : [];
  clean.shifts = Array.isArray(clean.shifts) ? clean.shifts : [];
  clean.lossReasons = Array.isArray(clean.lossReasons) ? clean.lossReasons : [];
  clean.rootAreas = Array.isArray(clean.rootAreas) ? clean.rootAreas : [];
  clean.machineTypes = Array.isArray(clean.machineTypes) ? clean.machineTypes : [];
  clean.mainWorks = Array.isArray(clean.mainWorks) ? clean.mainWorks : [];
  clean.subWorks = clean.subWorks && typeof clean.subWorks === "object" ? clean.subWorks : {};
  clean.workCatalogByType = clean.workCatalogByType && typeof clean.workCatalogByType === "object"
    ? clean.workCatalogByType
    : {};

  if (Object.prototype.hasOwnProperty.call(clean.subWorks, "")) {
    delete clean.subWorks[""];
  }

  Object.keys(clean.workCatalogByType || {}).forEach((tid) => {
    const cat = clean.workCatalogByType[tid] || {};
    cat.mainWorks = Array.isArray(cat.mainWorks) ? cat.mainWorks : [];
    cat.subWorks = cat.subWorks && typeof cat.subWorks === "object" ? cat.subWorks : {};

    if (Object.prototype.hasOwnProperty.call(cat.subWorks, "")) {
      delete cat.subWorks[""];
    }

    Object.keys(cat.subWorks || {}).forEach((dept) => {
      cat.subWorks[dept] = Array.isArray(cat.subWorks[dept]) ? cat.subWorks[dept] : [];

      cat.subWorks[dept] = cat.subWorks[dept].map((sw) => {
        const item = {
          name: String(sw?.name || "").trim(),
          standardTime: Number(sw?.standardTime || 0),
          checkpoints: Array.isArray(sw?.checkpoints) ? sw.checkpoints : [],
          qualityCheckpoints: Array.isArray(sw?.qualityCheckpoints) ? sw.qualityCheckpoints : []
        };

        item.checkpoints = item.checkpoints.map((bp) => ({
          name: String(bp?.name || "").trim(),
          standardTime: Number(bp?.standardTime || 0)
        })).filter((bp) => bp.name);

        item.qualityCheckpoints = item.qualityCheckpoints.map((qp) => ({
          name: String(qp?.name || "").trim(),
          inputType: qp?.inputType === "reading" ? "reading" : "status",
          mandatory: qp?.mandatory === true
        })).filter((qp) => qp.name);

        return item;
      }).filter((sw) => sw.name);
    });

    clean.workCatalogByType[tid] = cat;
  });

  return clean;
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

    const cleanAdminOverrides = getCleanAdminOverridesForSave();
const res = await window.api.saveAdminOverrides(cleanAdminOverrides);
    if (!res?.ok) {
      alert("❌ Save failed: " + (res?.error || "Unknown"));
      return;
    }
    // Sync admin data to Google Sheet also
const webAppUrl = window.SPWT_CONFIG?.SHEETS_WEBAPP_URL;
const secret = window.SPWT_CONFIG?.SECRET;

if (webAppUrl && secret && window.api.syncAdminOverridesToSheets) {
  const syncRes = await window.api.syncAdminOverridesToSheets({
  webAppUrl,
  secret,
  adminOverrides: cleanAdminOverrides
});

  if (!syncRes?.ok) {
    alert("⚠ Local saved, but Google sync failed: " + (syncRes?.error || "Unknown"));
    return;
  }
}

    showEntryMessage("✅ Admin changes saved. Admin screen is still open; use ✕ Close when finished.", "success");

    // Reload runtime data and keep admin screen open for multiple changes
    await loadData();
    populateHeaderDropdowns();
    const activeTab = document.querySelector(".tab.active")?.dataset?.tab || "tabMachines";
    switchAdminTab(activeTab);
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

// ===================== ADMIN BOOKING / QUALITY BUTTON FIX =====================
function getCurrentAdminSubWorkItems_() {
  if (!adminOverrides) return null;
  if (!selectedTypeForWorkEdit || !selectedDeptForTypeEdit) return null;

  const catalog = adminOverrides.workCatalogByType?.[selectedTypeForWorkEdit];
  if (!catalog) return null;

  catalog.subWorks = catalog.subWorks || {};
  catalog.subWorks[selectedDeptForTypeEdit] = Array.isArray(catalog.subWorks[selectedDeptForTypeEdit])
    ? catalog.subWorks[selectedDeptForTypeEdit]
    : [];

  catalog.subWorks[selectedDeptForTypeEdit].forEach(ensureSubWorkDetails);

  return catalog.subWorks[selectedDeptForTypeEdit];
}

function adminAddBookingPointByIndex(idx) {
  const items = getCurrentAdminSubWorkItems_();
  if (!items || !items[idx]) return;

  ensureSubWorkDetails(items[idx]);

  items[idx].checkpoints.push({
    name: "",
    standardTime: 0
  });

  renderAdminWorkSub();
}

function adminAddQualityPointByIndex(idx) {
  const items = getCurrentAdminSubWorkItems_();
  if (!items || !items[idx]) return;

  ensureSubWorkDetails(items[idx]);

  items[idx].qualityCheckpoints.push({
    name: "",
    inputType: "status",
    mandatory: false
  });

  renderAdminWorkSub();
}

if (!window.__spwtAdminPointButtonsFixed) {
  window.__spwtAdminPointButtonsFixed = true;

  document.addEventListener("click", function (e) {
    const bookingBtn = e.target.closest("[data-add-booking]");
    if (bookingBtn) {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(bookingBtn.getAttribute("data-add-booking"));
      adminAddBookingPointByIndex(idx);
      return;
    }

    const qualityBtn = e.target.closest("[data-add-quality]");
    if (qualityBtn) {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(qualityBtn.getAttribute("data-add-quality"));
      adminAddQualityPointByIndex(idx);
      return;
    }
  }, true);
}