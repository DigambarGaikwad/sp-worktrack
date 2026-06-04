(function () {
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function getSelectedTypeName() {
    try {
      const typeId = selectedTypeForWorkEdit || document.getElementById("workTypeSelect")?.value || "";
      const type = (adminOverrides?.machineTypes || []).find(t => String(t.id) === String(typeId));
      return {
        id: typeId,
        name: type?.name || typeId || "No category selected"
      };
    } catch (err) {
      return { id: "", name: "No category selected" };
    }
  }

  function ensureCatalogForSelectedType() {
    adminOverrides.workCatalogByType = adminOverrides.workCatalogByType || {};

    const typeId = selectedTypeForWorkEdit || document.getElementById("workTypeSelect")?.value || "";
    if (!typeId) return null;

    selectedTypeForWorkEdit = typeId;

    if (!adminOverrides.workCatalogByType[typeId]) {
      adminOverrides.workCatalogByType[typeId] = {
        mainWorks: [],
        subWorks: {}
      };
    }

    const catalog = adminOverrides.workCatalogByType[typeId];
    catalog.mainWorks = Array.isArray(catalog.mainWorks) ? catalog.mainWorks : [];
    catalog.subWorks = catalog.subWorks && typeof catalog.subWorks === "object" ? catalog.subWorks : {};

    if (Object.prototype.hasOwnProperty.call(catalog.subWorks, "")) {
      delete catalog.subWorks[""];
    }

    return catalog;
  }

  function nextMainWorkName(catalog) {
    const base = "New Main Work";
    let name = base;
    let counter = 1;

    while ((catalog.mainWorks || []).includes(name)) {
      counter += 1;
      name = `${base} ${counter}`;
    }

    return name;
  }

  window.adminAddMainWork = function () {
    try {
      if (typeof mustAdmin === "function" && !mustAdmin()) return;

      const catalog = ensureCatalogForSelectedType();
      if (!catalog) {
        alert("Select Machine Category first.");
        return;
      }

      const name = nextMainWorkName(catalog);
      catalog.mainWorks.push(name);
      catalog.subWorks[name] = [];

      selectedDeptForTypeEdit = name;

      if (typeof renderAdminWorkSub === "function") {
        renderAdminWorkSub();
      }

      setTimeout(() => {
        updateEditingCategoryNote();
        const inputs = document.querySelectorAll("#mainWorkList [data-tmw-idx]");
        const last = inputs[inputs.length - 1];
        if (last) {
          last.focus();
          last.select();
        }
      }, 80);
    } catch (err) {
      console.error(err);
      alert("Add Main Work failed: " + (err?.message || err));
    }
  };

  function updateEditingCategoryNote() {
    const workPage = document.getElementById("tabWork");
    if (!workPage) return;

    const info = getSelectedTypeName();
    const label = document.getElementById("editingDeptLabel");
    const dept = label?.textContent || "None";

    let note = document.getElementById("editingCategoryNote");
    if (!note) {
      note = document.createElement("div");
      note.id = "editingCategoryNote";
      note.className = "small-hint";
      note.style.cssText = "margin:8px 0;padding:8px 10px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;font-weight:800;color:#1e3a8a;";

      const target = document.getElementById("workTypeSelect")?.closest(".field");
      if (target) target.insertAdjacentElement("afterend", note);
      else workPage.prepend(note);
    }

    note.innerHTML = `Editing Category: <b>${esc(info.name)}</b> <span style="font-weight:600;">(${esc(info.id)})</span> | Main Work: <b>${esc(dept)}</b>`;
  }

  function patchRenderNote() {
    if (window.__spwtMainWorkPatchWrapped) return;
    if (typeof renderAdminWorkSub !== "function") return;

    window.__spwtMainWorkPatchWrapped = true;
    const originalRender = renderAdminWorkSub;

    window.renderAdminWorkSub = function () {
      const result = originalRender.apply(this, arguments);
      setTimeout(updateEditingCategoryNote, 50);
      return result;
    };
  }

  document.addEventListener("click", function (event) {
    if (event.target?.closest?.("#addMainWorkBtn")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.adminAddMainWork();
      return;
    }

    if (event.target?.closest?.('[data-tab="tabWork"], #workTypeSelect, [data-tmw-edit]')) {
      setTimeout(updateEditingCategoryNote, 100);
    }
  }, true);

  document.addEventListener("change", function (event) {
    if (event.target?.closest?.("#workTypeSelect")) {
      setTimeout(updateEditingCategoryNote, 100);
    }
  }, true);

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(() => {
      patchRenderNote();
      updateEditingCategoryNote();
    }, 1000);
  });

  setInterval(() => {
    patchRenderNote();
    const tab = document.getElementById("tabWork");
    if (tab && !tab.classList.contains("hidden")) updateEditingCategoryNote();
  }, 1500);
})();
