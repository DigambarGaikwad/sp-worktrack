// renderer/admin/adminButtonFix.js
// Safety patch for the full-page Admin screen.
// Fixes DB-mode Admin add buttons that are missing or unstable on separate admin.html page.

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(wireButtons, 1200);
    setTimeout(wireButtons, 2500);
    setTimeout(wireButtons, 4000);
  });

  function byId(id) {
    return document.getElementById(id);
  }

  function getAppVar(name, fallback) {
    try {
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
      // eslint-disable-next-line no-new-func
      Function(`${name} = window.__spwtAdminButtonFixValue`)();
      delete window.__spwtAdminButtonFixValue;
    } catch (err) {
      console.warn(`Could not set app variable ${name}`, err);
    }
  }

  function getAppFn(name) {
    try {
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

  function wireButtons() {
    wireNormalButton("addMachineBtn", "adminAddMachine");
    wireNormalButton("addEmployeeBtn", "adminAddEmployee");
    wireNormalButton("addShiftBtn", "adminAddShift");
    wireNormalButton("addTypeBtn", "adminAddType");
    wireNormalButton("addSubWorkBtn", "adminAddSubWork");

    const mainWorkBtn = byId("addMainWorkBtn");
    if (mainWorkBtn) {
      mainWorkBtn.type = "button";
      mainWorkBtn.onclick = addMainWorkDirect;
    }

    const lossBtn = byId("addLossReasonBtn");
    if (lossBtn) {
      lossBtn.type = "button";
      lossBtn.onclick = addLossReasonDirect;
    }

    const rootBtn = byId("addRootAreaBtn");
    if (rootBtn) {
      rootBtn.type = "button";
      rootBtn.onclick = addRootAreaDirect;
    }
  }

  function wireNormalButton(id, fnName) {
    const btn = byId(id);
    const fn = getAppFn(fnName);
    if (!btn || !fn) return;
    btn.type = "button";
    btn.onclick = function (event) {
      if (event) event.preventDefault();
      fn();
    };
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
    if (event) event.preventDefault();
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

    let base = "New Main Work";
    let name = base;
    let n = 1;
    while (catalog.mainWorks.some((x) => String(x).trim().toLowerCase() === name.toLowerCase())) {
      n += 1;
      name = `${base} ${n}`;
    }

    catalog.mainWorks.push(name);
    catalog.subWorks[name] = Array.isArray(catalog.subWorks[name]) ? catalog.subWorks[name] : [];

    const globalMainWorks = Array.isArray(adminOverrides.mainWorks) ? adminOverrides.mainWorks : [];
    if (!globalMainWorks.includes(name)) globalMainWorks.push(name);
    adminOverrides.mainWorks = globalMainWorks;
    adminOverrides.subWorks = adminOverrides.subWorks && typeof adminOverrides.subWorks === "object" ? adminOverrides.subWorks : {};
    adminOverrides.subWorks[name] = Array.isArray(adminOverrides.subWorks[name]) ? adminOverrides.subWorks[name] : [];

    setAppVar("selectedTypeForWorkEdit", selectedType);
    setAppVar("selectedDeptForTypeEdit", name);

    renderWorkScreen();

    setTimeout(function () {
      const inputs = Array.from(document.querySelectorAll("#mainWorkList [data-tmw-idx]"));
      const target = inputs.find((input) => String(input.value || "").trim() === name) || inputs[inputs.length - 1];
      if (target) {
        target.focus();
        target.select();
      }
    }, 50);
  }

  function addLossReasonDirect(event) {
    if (event) event.preventDefault();
    if (!adminReady()) return;

    const adminOverrides = getAppVar("adminOverrides", null);
    if (!adminOverrides) return;

    adminOverrides.lossReasons = Array.isArray(adminOverrides.lossReasons) ? adminOverrides.lossReasons : [];
    adminOverrides.lossReasons.push("New Loss Reason");

    renderLossReasonsDirect(adminOverrides);
  }

  function addRootAreaDirect(event) {
    if (event) event.preventDefault();
    if (!adminReady()) return;

    const adminOverrides = getAppVar("adminOverrides", null);
    if (!adminOverrides) return;

    adminOverrides.rootAreas = Array.isArray(adminOverrides.rootAreas) ? adminOverrides.rootAreas : [];
    adminOverrides.rootAreas.push("New Root Area");

    renderRootAreasDirect(adminOverrides);
  }

  function renderLossReasonsDirect(adminOverrides) {
    const host = byId("lossReasonsList");
    if (!host) return;

    host.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>Loss Reason</th><th style="width:160px;">Action</th></tr>
        </thead>
        <tbody>
          ${adminOverrides.lossReasons.map((r, idx) => `
            <tr>
              <td><input class="admin-input" data-loss-idx="${idx}" value="${escapeHtml(r)}" placeholder="Loss Reason" /></td>
              <td><button type="button" class="btn grey" data-loss-del="${idx}">Delete</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="small-hint">Only define loss reason here. Operator enters loss time during entry.</div>
    `;

    host.querySelectorAll("[data-loss-idx]").forEach((input) => {
      input.oninput = function () {
        const idx = Number(input.getAttribute("data-loss-idx"));
        adminOverrides.lossReasons[idx] = input.value.trim();
      };
    });

    host.querySelectorAll("[data-loss-del]").forEach((btn) => {
      btn.onclick = function () {
        const idx = Number(btn.getAttribute("data-loss-del"));
        adminOverrides.lossReasons.splice(idx, 1);
        renderLossReasonsDirect(adminOverrides);
      };
    });

    const inputs = host.querySelectorAll("[data-loss-idx]");
    const last = inputs[inputs.length - 1];
    if (last) {
      last.focus();
      last.select();
    }
  }

  function renderRootAreasDirect(adminOverrides) {
    const host = byId("rootAreasList");
    if (!host) return;

    host.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>Root Area</th><th style="width:160px;">Action</th></tr>
        </thead>
        <tbody>
          ${adminOverrides.rootAreas.map((r, idx) => `
            <tr>
              <td><input class="admin-input" data-root-idx="${idx}" value="${escapeHtml(r)}" placeholder="Root Area" /></td>
              <td><button type="button" class="btn grey" data-root-del="${idx}">Delete</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    host.querySelectorAll("[data-root-idx]").forEach((input) => {
      input.oninput = function () {
        const idx = Number(input.getAttribute("data-root-idx"));
        adminOverrides.rootAreas[idx] = input.value.trim();
      };
    });

    host.querySelectorAll("[data-root-del]").forEach((btn) => {
      btn.onclick = function () {
        const idx = Number(btn.getAttribute("data-root-del"));
        adminOverrides.rootAreas.splice(idx, 1);
        renderRootAreasDirect(adminOverrides);
      };
    });

    const inputs = host.querySelectorAll("[data-root-idx]");
    const last = inputs[inputs.length - 1];
    if (last) {
      last.focus();
      last.select();
    }
  }
})();
