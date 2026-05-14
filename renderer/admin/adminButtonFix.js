// renderer/admin/adminButtonFix.js
// Safety patch for the full-page Admin screen.
// It re-wires Admin add buttons after DB/login patches so the original app.js
// admin functions continue to work on the separate admin.html page.

(function () {
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(wireAdminAddButtons, 1500);
    setTimeout(wireAdminAddButtons, 3000);
  });

  function getFn(name) {
    try {
      // app.js is loaded as a classic script; function declarations are reachable here.
      // eslint-disable-next-line no-eval
      const fn = eval(name);
      return typeof fn === "function" ? fn : null;
    } catch (err) {
      return null;
    }
  }

  function bind(id, fnName) {
    const el = $(id);
    const fn = getFn(fnName);
    if (!el || !fn) return;

    el.onclick = function () {
      try {
        fn();
      } catch (err) {
        console.error(`Admin button failed: ${id} -> ${fnName}`, err);
        alert(`Button action failed: ${fnName}\n\n${err.message || err}`);
      }
    };
  }

  function wireAdminAddButtons() {
    bind("addMachineBtn", "adminAddMachine");
    bind("addEmployeeBtn", "adminAddEmployee");
    bind("addShiftBtn", "adminAddShift");
    bind("addLossReasonBtn", "adminAddLossReason");
    bind("addRootAreaBtn", "adminAddRootArea");
    bind("addTypeBtn", "adminAddType");
    bind("addMainWorkBtn", "adminAddMainWork");
    bind("addSubWorkBtn", "adminAddSubWork");
  }
})();
