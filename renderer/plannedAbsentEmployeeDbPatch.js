(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";

  function clean(value) {
    return String(value ?? "").trim();
  }

  function esc(value) {
    return clean(value).replace(/[&<>'"]/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[ch]));
  }

  async function fetchEmployeesFromDb() {
    const res = await fetch(`${API_BASE_URL}/api/employees?activeOnly=false`);
    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.message || `Employee API failed ${res.status}`);
    }

    return Array.isArray(payload.employees) ? payload.employees : [];
  }

  function renderPlannedAbsentEmployees(select, employees) {
    const current = select.value;

    const rows = employees
      .filter(e => clean(e.empCode || e.emp_code || e.empId || e.code))
      .sort((a, b) => clean(a.empCode || a.emp_code || a.empId || a.code).localeCompare(clean(b.empCode || b.emp_code || b.empId || b.code)));

    select.innerHTML = `<option value="">Select Employee</option>` + rows.map(e => {
      const code = clean(e.empCode || e.emp_code || e.empId || e.code);
      const name = clean(e.name || e.full_name || e.empName || e.emp_name);
      const dept = clean(e.department);
      const activeNote = e.active === false ? " - Inactive" : "";
      const value = `${esc(code)}|${esc(name)}|${esc(dept)}`;
      const label = `${code}${name ? " - " + name : ""}${dept ? " (" + dept + ")" : ""}${activeNote}`;
      return `<option value="${value}">${esc(label)}</option>`;
    }).join("");

    if (current && Array.from(select.options).some(o => o.value === current)) {
      select.value = current;
    }
  }

  async function loadPlannedAbsentEmployees(force = false) {
    const select = document.getElementById("plannedAbsentEmployee");
    if (!select) return;

    if (!force && select.options.length > 1) return;

    try {
      select.disabled = true;
      select.innerHTML = `<option value="">Loading employees from DB...</option>`;

      const employees = await fetchEmployeesFromDb();
      renderPlannedAbsentEmployees(select, employees);

      if (!employees.length) {
        select.innerHTML = `<option value="">No employees found in DB</option>`;
      }
    } catch (err) {
      console.error(err);
      select.innerHTML = `<option value="">Employee load failed</option>`;

      let toast = document.getElementById("adminDbToast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "adminDbToast";
        toast.className = "admin-db-toast";
        document.body.appendChild(toast);
      }
      toast.textContent = "Planned Absent employee load failed: " + (err?.message || err);
      toast.className = "admin-db-toast show error";
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => toast.classList.remove("show"), 3500);
    } finally {
      select.disabled = false;
    }
  }

  document.addEventListener("click", function (event) {
    if (event.target?.closest?.('[data-tab="tabPlannedAbsent"]')) {
      setTimeout(() => loadPlannedAbsentEmployees(true), 250);
    }
  }, true);

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(() => loadPlannedAbsentEmployees(true), 1200);
  });

  setInterval(() => {
    const tab = document.getElementById("tabPlannedAbsent");
    if (tab && !tab.classList.contains("hidden")) {
      loadPlannedAbsentEmployees(false);
    }
  }, 2000);
})();
