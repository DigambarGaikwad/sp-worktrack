// renderer/admin/adminButtonFix.js
// Safety wiring for the full-page Admin screen.
// Cleanup: replaced repeated fixed timeouts with bounded retry wiring and one-time handlers.

(function () {
  const MAX_WIRE_ATTEMPTS = 12;
  const WIRE_RETRY_MS = 250;
  let attempts = 0;

  document.addEventListener("DOMContentLoaded", function () {
    scheduleWireButtons();
  });

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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

    const presentCount = buttonIds.filter((id) => !!byId(id)).length;
    if (presentCount === 0) return false;

    wireAppFunctionButton("addMachineBtn", "adminAddMachine");
    wireAppFunctionButton("addEmployeeBtn", "adminAddEmployee");
    wireAppFunctionButton("addShiftBtn", "adminAddShift");
    wireAppFunctionButton("addTypeBtn", "adminAddType");
    wireAppFunctionButton("addSubWorkBtn", "adminAddSubWork");

    wireFallbackButton("addMainWorkBtn", addMainWorkDirect);
    wireFallbackButton("addLossReasonBtn", addLossReasonDirect);
    wireFallbackButton("addRootAreaBtn", addRootAreaDirect);

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

  function addLossReasonDirect(event) {
    event?.preventDefault?.();
    if (!adminReady()) return;

    const appFn = getAppFn("adminAddLossReason");
    if (appFn) {
      appFn();
      focusLastInput("#lossReasonsList [data-loss-idx]");
      return;
    }

    const adminOverrides = getAppVar("adminOverrides", null);
    if (!adminOverrides) return;

    adminOverrides.lossReasons = Array.isArray(adminOverrides.lossReasons) ? adminOverrides.lossReasons : [];
    adminOverrides.lossReasons.push("New Loss Reason");
    renderSimpleList({
      hostId: "lossReasonsList",
      items: adminOverrides.lossReasons,
      inputAttr: "data-loss-idx",
      delAttr: "data-loss-del",
      placeholder: "Loss Reason",
      header: "Loss Reason",
      hint: "Only define loss reason here. Operator enters loss time during entry.",
      onChange: (idx, value) => { adminOverrides.lossReasons[idx] = value.trim(); },
      onDelete: (idx) => { adminOverrides.lossReasons.splice(idx, 1); renderLossReasonsFallback(adminOverrides); }
    });
    focusLastInput("#lossReasonsList [data-loss-idx]");
  }

  function addRootAreaDirect(event) {
    event?.preventDefault?.();
    if (!adminReady()) return;

    const appFn = getAppFn("adminAddRootArea");
    if (appFn) {
      appFn();
      focusLastInput("#rootAreasList [data-root-idx]");
      return;
    }

    const adminOverrides = getAppVar("adminOverrides", null);
    if (!adminOverrides) return;

    adminOverrides.rootAreas = Array.isArray(adminOverrides.rootAreas) ? adminOverrides.rootAreas : [];
    adminOverrides.rootAreas.push("New Root Area");
    renderRootAreasFallback(adminOverrides);
    focusLastInput("#rootAreasList [data-root-idx]");
  }

  function renderLossReasonsFallback(adminOverrides) {
    renderSimpleList({
      hostId: "lossReasonsList",
      items: adminOverrides.lossReasons,
      inputAttr: "data-loss-idx",
      delAttr: "data-loss-del",
      placeholder: "Loss Reason",
      header: "Loss Reason",
      hint: "Only define loss reason here. Operator enters loss time during entry.",
      onChange: (idx, value) => { adminOverrides.lossReasons[idx] = value.trim(); },
      onDelete: (idx) => { adminOverrides.lossReasons.splice(idx, 1); renderLossReasonsFallback(adminOverrides); }
    });
  }

  function renderRootAreasFallback(adminOverrides) {
    renderSimpleList({
      hostId: "rootAreasList",
      items: adminOverrides.rootAreas,
      inputAttr: "data-root-idx",
      delAttr: "data-root-del",
      placeholder: "Root Area",
      header: "Root Area",
      hint: "",
      onChange: (idx, value) => { adminOverrides.rootAreas[idx] = value.trim(); },
      onDelete: (idx) => { adminOverrides.rootAreas.splice(idx, 1); renderRootAreasFallback(adminOverrides); }
    });
  }

  function renderSimpleList({ hostId, items, inputAttr, delAttr, placeholder, header, hint, onChange, onDelete }) {
    const host = byId(hostId);
    if (!host) return;

    host.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>${escapeHtml(header)}</th><th style="width:160px;">Action</th></tr>
        </thead>
        <tbody>
          ${(items || []).map((item, idx) => `
            <tr>
              <td><input class="admin-input" ${inputAttr}="${idx}" value="${escapeHtml(item)}" placeholder="${escapeHtml(placeholder)}" /></td>
              <td><button type="button" class="btn grey" ${delAttr}="${idx}">Delete</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${hint ? `<div class="small-hint">${escapeHtml(hint)}</div>` : ""}
    `;

    host.querySelectorAll(`[${inputAttr}]`).forEach((input) => {
      input.oninput = function () {
        onChange(Number(input.getAttribute(inputAttr)), input.value);
      };
    });

    host.querySelectorAll(`[${delAttr}]`).forEach((btn) => {
      btn.onclick = function () {
        onDelete(Number(btn.getAttribute(delAttr)));
      };
    });
  }
})();
