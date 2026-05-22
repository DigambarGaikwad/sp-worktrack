// renderer/admin/adminButtonFix.js
// Safety wiring for full-page Admin screen.
// Scope after cleanup: wire admin add buttons once and keep Add Main Work fallback.

(function () {
  const MAX_WIRE_ATTEMPTS = 12;
  const WIRE_RETRY_MS = 250;
  let attempts = 0;

  document.addEventListener("DOMContentLoaded", scheduleWireButtons);

  function byId(id) {
    return document.getElementById(id);
  }

  function getAppVar(name, fallback) {
    try {
      // Required because app.js uses global lexical variables, not window properties.
      // eslint-disable-next-line no-eval
      const value = eval(name);
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function setAppVar(name, value) {
    try {
      window.__spwtAdminButtonFixValue = value;
      // Required for app.js global lexical variables.
      // eslint-disable-next-line no-new-func
      Function(`${name} = window.__spwtAdminButtonFixValue`)();
    } catch (err) {
      console.warn(`Could not set app variable ${name}`, err);
    } finally {
      delete window.__spwtAdminButtonFixValue;
    }
  }

  function getAppFn(name) {
    try {
      // Required because app.js functions are not exported as window properties.
      // eslint-disable-next-line no-eval
      const fn = eval(name);
      return typeof fn === "function" ? fn : null;
    } catch (err) {
      return null;
    }
  }

  function scheduleWireButtons() {
    attempts += 1;
    const wired = wireButtons();
    if (!wired && attempts < MAX_WIRE_ATTEMPTS) {
      setTimeout(scheduleWireButtons, WIRE_RETRY_MS);
    }
  }

  function wireButtons() {
    const buttonIds = [
      "addMachineBtn",
      "addEmployeeBtn",
      "addShiftBtn",
      "addTypeBtn",
      "addSubWorkBtn",
      "addMainWorkBtn",
      "addLossReasonBtn",
      "addRootAreaBtn"
    ];

    if (!buttonIds.some((id) => !!byId(id))) return false;

    wireAppFunctionButton("addMachineBtn", "adminAddMachine");
    wireAppFunctionButton("addEmployeeBtn", "adminAddEmployee");
    wireAppFunctionButton("addShiftBtn", "adminAddShift");
    wireAppFunctionButton("addTypeBtn", "adminAddType");
    wireAppFunctionButton("addSubWorkBtn", "adminAddSubWork");
    wireAppFunctionButton("addLossReasonBtn", "adminAddLossReason");
    wireAppFunctionButton("addRootAreaBtn", "adminAddRootArea");

    wireFallbackButton("addMainWorkBtn", addMainWorkDirect);
    return true;
  }

  function wireAppFunctionButton(id, fnName) {
    const btn = byId(id);
    const fn = getAppFn(fnName);
    if (!btn || !fn || btn.__spwtButtonFixWired) return;

    btn.__spwtButtonFixWired = true;
    btn.type = "button";
    btn.onclick = function (event) {
      event?.preventDefault?.();
      fn();
      focusAfterAction(id);
    };
  }

  function wireFallbackButton(id, handler) {
    const btn = byId(id);
    if (!btn || btn.__spwtButtonFixWired) return;

    btn.__spwtButtonFixWired = true;
    btn.type = "button";
    btn.onclick = handler;
  }

  function adminReady() {
    const mustAdmin = getAppFn("mustAdmin");
    if (mustAdmin) return mustAdmin();

    const adminOverrides = getAppVar("adminOverrides", null);
    if (!adminOverrides) {
      alert("Admin data not loaded.");
      return false;
    }
    return true;
  }

  function getSelectedType() {
    const fromSelect = byId("workTypeSelect")?.value || "";
    return fromSelect || getAppVar("selectedTypeForWorkEdit", "") || "";
  }

  function renderWorkScreen() {
    const renderAdminWorkSub = getAppFn("renderAdminWorkSub");
    if (renderAdminWorkSub) renderAdminWorkSub();
  }

  function addMainWorkDirect(event) {
    event?.preventDefault?.();
    if (!adminReady()) return;

    const adminOverrides = getAppVar("adminOverrides", null);
    if (!adminOverrides) return;

    adminOverrides.machineTypes = Array.isArray(adminOverrides.machineTypes) ? adminOverrides.machineTypes : [];
    adminOverrides.workCatalogByType = adminOverrides.workCatalogByType && typeof adminOverrides.workCatalogByType === "object"
      ? adminOverrides.workCatalogByType
      : {};

    const selectedType = getSelectedType() || adminOverrides.machineTypes[0]?.id || "";
    if (!selectedType) {
      alert("Select or create a Machine Category first.");
      return;
    }

    if (!adminOverrides.workCatalogByType[selectedType]) {
      adminOverrides.workCatalogByType[selectedType] = { mainWorks: [], subWorks: {} };
    }

    const catalog = adminOverrides.workCatalogByType[selectedType];
    catalog.mainWorks = Array.isArray(catalog.mainWorks) ? catalog.mainWorks : [];
    catalog.subWorks = catalog.subWorks && typeof catalog.subWorks === "object" ? catalog.subWorks : {};

    const name = createUniqueName(catalog.mainWorks, "New Main Work");
    catalog.mainWorks.push(name);
    catalog.subWorks[name] = Array.isArray(catalog.subWorks[name]) ? catalog.subWorks[name] : [];

    adminOverrides.mainWorks = Array.isArray(adminOverrides.mainWorks) ? adminOverrides.mainWorks : [];
    if (!adminOverrides.mainWorks.includes(name)) adminOverrides.mainWorks.push(name);

    adminOverrides.subWorks = adminOverrides.subWorks && typeof adminOverrides.subWorks === "object" ? adminOverrides.subWorks : {};
    adminOverrides.subWorks[name] = Array.isArray(adminOverrides.subWorks[name]) ? adminOverrides.subWorks[name] : [];

    setAppVar("selectedTypeForWorkEdit", selectedType);
    setAppVar("selectedDeptForTypeEdit", name);

    renderWorkScreen();
    focusLastInput("#mainWorkList [data-tmw-idx]", name);
  }

  function createUniqueName(existing, base) {
    let name = base;
    let n = 1;
    while ((existing || []).some((x) => String(x).trim().toLowerCase() === name.toLowerCase())) {
      n += 1;
      name = `${base} ${n}`;
    }
    return name;
  }

  function focusAfterAction(buttonId) {
    const map = {
      addLossReasonBtn: "#lossReasonsList [data-loss-idx]",
      addRootAreaBtn: "#rootAreasList [data-root-idx]",
      addSubWorkBtn: "#subWorkList input.admin-input",
      addMachineBtn: "#machinesList input.admin-input",
      addEmployeeBtn: "#employeesList input.admin-input",
      addShiftBtn: "#shiftsList input.admin-input",
      addTypeBtn: "#typeList input.admin-input"
    };
    if (map[buttonId]) focusLastInput(map[buttonId]);
  }

  function focusLastInput(selector, exactValue) {
    setTimeout(function () {
      const inputs = Array.from(document.querySelectorAll(selector));
      const target = exactValue
        ? inputs.find((input) => String(input.value || "").trim() === exactValue) || inputs[inputs.length - 1]
        : inputs[inputs.length - 1];
      if (target) {
        target.focus();
        target.select?.();
      }
    }, 50);
  }
})();
