// renderer/admin/adminButtonFix.js
// Safety patch for the full-page Admin screen.
// Fixes Add Loss Reason / Add Root Area after DB/admin login patches.

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
    wireNormalButton("addMainWorkBtn", "adminAddMainWork");
    wireNormalButton("addSubWorkBtn", "adminAddSubWork");

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
