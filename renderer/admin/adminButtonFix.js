// renderer/admin/adminButtonFix.js
// Safety patch for the full-page Admin screen.
// Uses delegated click handling so Add buttons keep working after tab/login re-rendering.

(function () {
  const buttonActionById = {
    addMachineBtn: "adminAddMachine",
    addEmployeeBtn: "adminAddEmployee",
    addShiftBtn: "adminAddShift",
    addLossReasonBtn: "adminAddLossReason",
    addRootAreaBtn: "adminAddRootArea",
    addTypeBtn: "adminAddType",
    addMainWorkBtn: "adminAddMainWork",
    addSubWorkBtn: "adminAddSubWork"
  };

  document.addEventListener("DOMContentLoaded", function () {
    setButtonTypes();
    setTimeout(setButtonTypes, 1500);
    setTimeout(setButtonTypes, 3000);
  });

  document.addEventListener("click", function (event) {
    const btn = event.target && event.target.closest ? event.target.closest("button") : null;
    if (!btn || !buttonActionById[btn.id]) return;

    event.preventDefault();
    event.stopPropagation();

    runLegacyAdminAction(buttonActionById[btn.id], btn.id);
  }, true);

  function setButtonTypes() {
    Object.keys(buttonActionById).forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.type = "button";
    });
  }

  function runLegacyAdminAction(functionName, buttonId) {
    try {
      const fn = window[functionName];

      if (typeof fn !== "function") {
        throw new Error(`${functionName} is not available on window. app.js may not have exported it.`);
      }

      fn();
    } catch (err) {
      console.error(`Admin button failed: ${buttonId} -> ${functionName}`, err);
      alert(`Button action failed: ${functionName}\n\n${err.message || err}`);
    }
  }
})();
