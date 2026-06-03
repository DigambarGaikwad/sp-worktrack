// renderer/maintenanceEmployeeDropdownPatch.js
// Converts Maintenance → Delete Entries by Employee manual input into employee dropdown.

(function () {
  const REQUEST_TIMEOUT_MS = 20000;
  let loaded = false;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function fetchEmployees() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/employees?activeOnly=false`, { method: "GET", signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return Array.isArray(payload.employees) ? payload.employees : [];
    } finally {
      clearTimeout(timer);
    }
  }

  function showStatus(message, type = "") {
    const el = document.getElementById("deleteEmployeeResult") || document.getElementById("maintenanceStatus");
    if (!el) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.innerHTML = `<div style="margin-top:8px;font-weight:800;color:${color};">${esc(message)}</div>`;
  }

  function ensureSelectElement() {
    const current = document.getElementById("deleteEmpCode");
    if (!current) return null;
    if (current.tagName === "SELECT") return current;

    const select = document.createElement("select");
    select.id = "deleteEmpCode";
    select.className = current.className || "admin-select";
    select.style.width = "100%";
    select.innerHTML = `<option value="">Loading employees...</option>`;
    current.replaceWith(select);
    return select;
  }

  function renderOptions(select, employees) {
    const sorted = employees
      .filter(e => clean(e.empCode || e.emp_code))
      .sort((a, b) => clean(a.empCode || a.emp_code).localeCompare(clean(b.empCode || b.emp_code)));

    select.innerHTML = `<option value="">Select Employee</option>` + sorted.map((e) => {
      const code = clean(e.empCode || e.emp_code);
      const name = clean(e.name || e.full_name || e.empName || "");
      const active = e.active === false ? " - Inactive" : "";
      return `<option value="${esc(code)}">${esc(code)}${name ? " - " + esc(name) : ""}${active}</option>`;
    }).join("");
  }

  async function loadDropdown(force = false) {
    const tab = document.getElementById("tabMaintenance");
    if (!tab) return;
    const select = ensureSelectElement();
    if (!select) return;
    if (loaded && !force && select.options.length > 1) return;

    try {
      select.disabled = true;
      select.innerHTML = `<option value="">Loading employees...</option>`;
      const employees = await fetchEmployees();
      renderOptions(select, employees);
      loaded = true;
    } catch (err) {
      select.innerHTML = `<option value="">Employee load failed</option>`;
      showStatus("Employee dropdown load failed: " + (err?.message || err), "error");
    } finally {
      select.disabled = false;
    }
  }

  function init() {
    loadDropdown(false);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 500));
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.('[data-tab="tabMaintenance"]')) setTimeout(() => loadDropdown(false), 250);
  }, true);
  setInterval(() => {
    if (document.getElementById("tabMaintenance") && !document.getElementById("tabMaintenance").classList.contains("hidden")) {
      loadDropdown(false);
    }
  }, 2000);
})();
