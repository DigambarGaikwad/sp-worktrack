(function () {
  function canAdmin() {
    try {
      return typeof mustAdmin !== "function" || mustAdmin();
    } catch (err) {
      return true;
    }
  }

  function uniqueName(list, base) {
    let name = base;
    let n = 1;
    while ((list || []).map(x => String(x).trim().toLowerCase()).includes(name.toLowerCase())) {
      n += 1;
      name = `${base} ${n}`;
    }
    return name;
  }

  function focusLast(selector) {
    setTimeout(() => {
      const inputs = document.querySelectorAll(selector);
      const last = inputs[inputs.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    }, 120);
  }

  window.adminAddLossReason = function () {
    try {
      if (!canAdmin()) return;

      adminOverrides.lossReasons = Array.isArray(adminOverrides.lossReasons)
        ? adminOverrides.lossReasons
        : [];

      adminOverrides.lossReasons.push(uniqueName(adminOverrides.lossReasons, "New Loss Reason"));

      if (typeof renderAdminLossReasons === "function") {
        renderAdminLossReasons();
      }

      focusLast("#lossReasonsList [data-loss-idx]");
    } catch (err) {
      console.error(err);
      alert("Add Loss Reason failed: " + (err?.message || err));
    }
  };

  window.adminAddRootArea = function () {
    try {
      if (!canAdmin()) return;

      adminOverrides.rootAreas = Array.isArray(adminOverrides.rootAreas)
        ? adminOverrides.rootAreas
        : [];

      adminOverrides.rootAreas.push(uniqueName(adminOverrides.rootAreas, "New Root Area"));

      if (typeof renderAdminRootAreas === "function") {
        renderAdminRootAreas();
      }

      focusLast("#rootAreasList [data-root-idx]");
    } catch (err) {
      console.error(err);
      alert("Add Root Area failed: " + (err?.message || err));
    }
  };

  document.addEventListener("click", function (event) {
    if (event.target?.closest?.("#addLossReasonBtn")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.adminAddLossReason();
      return;
    }

    if (event.target?.closest?.("#addRootAreaBtn")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.adminAddRootArea();
    }
  }, true);
})();
