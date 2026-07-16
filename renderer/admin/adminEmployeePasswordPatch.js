// renderer/admin/adminEmployeePasswordPatch.js
// Adds employee password reset column in Admin > Employees.
(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3032";
  const statusByEmp = new Map();
  let loadingStatus = false;
  let renderWrapped = false;

  function $(id) { return document.getElementById(id); }
  function clean(v) { return String(v ?? "").trim(); }
  function normEmp(v) { return clean(v).toUpperCase(); }
  function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }
  function tokenHeaders() {
    try {
      const token = window.SPWT_ADMIN_ACCESS?.getToken?.() || "";
      return token ? { "X-SPWT-Admin-Token": token } : {};
    } catch { return {}; }
  }

  async function requestJson(path, options = {}) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), ...tokenHeaders() }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(body?.message || `Request failed ${res.status}`);
    return body;
  }

  async function loadPasswordStatus() {
    if (loadingStatus || !window.SPWT_ADMIN_ACCESS?.getToken?.()) return;
    loadingStatus = true;
    try {
      const body = await requestJson("/api/employee-auth/admin/status", { method: "GET" });
      statusByEmp.clear();
      (body.data || []).forEach((x) => statusByEmp.set(normEmp(x.empCode), x));
      renderPasswordCells();
    } catch (err) {
      console.warn("Employee password status load skipped:", err.message || err);
    } finally {
      loadingStatus = false;
    }
  }

  function statusText(empCode) {
    const st = statusByEmp.get(normEmp(empCode));
    if (!st) return "Password not set";
    return st.hasPassword ? "Password set" : "Password not set";
  }

  function addStyles() {
    if ($("employeePasswordPatchStyle")) return;
    const style = document.createElement("style");
    style.id = "employeePasswordPatchStyle";
    style.textContent = `
      .employee-password-cell { min-width: 260px; }
      .employee-password-wrap { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .employee-password-wrap .admin-input { min-width: 145px; flex:1 1 145px; }
      .employee-password-status { width:100%; margin-top:4px; font-weight:700; }
      .employee-password-status.set { color:#166534; }
      .employee-password-status.missing { color:#b45309; }
    `;
    document.head.appendChild(style);
  }

  function employeeRows() {
    const host = $("employeesList");
    const table = host?.querySelector("table.admin-table");
    if (!table) return [];
    return Array.from(table.querySelectorAll("tbody tr"));
  }

  function ensureHeader(table) {
    const headRow = table?.querySelector("thead tr");
    if (!headRow || headRow.querySelector(".employee-password-head")) return;
    const th = document.createElement("th");
    th.className = "employee-password-head";
    th.style.width = "22%";
    th.textContent = "Password";
    headRow.insertBefore(th, headRow.lastElementChild);
  }

  function cellHtml(idx, empCode) {
    const st = statusText(empCode);
    const set = /^password set$/i.test(st);
    return `
      <div class="employee-password-wrap">
        <input class="admin-input employee-password-input" type="password" placeholder="New password / PIN" data-emp-pass-input="${idx}" autocomplete="new-password" />
        <button type="button" class="btn green" data-emp-pass-reset="${idx}">Reset</button>
        <div class="small-hint employee-password-status ${set ? "set" : "missing"}" data-emp-pass-status="${idx}">${escapeHtml(st)}</div>
      </div>`;
  }

  function renderPasswordCells() {
    addStyles();
    const host = $("employeesList");
    const table = host?.querySelector("table.admin-table");
    if (!table) return;
    ensureHeader(table);

    employeeRows().forEach((row) => {
      const empInput = row.querySelector('[data-field="empId"]');
      if (!empInput) return;
      const idx = Number(empInput.getAttribute("data-e-idx"));
      const empCode = normEmp(empInput.value);
      let cell = row.querySelector(".employee-password-cell");
      if (!cell) {
        cell = document.createElement("td");
        cell.className = "employee-password-cell";
        row.insertBefore(cell, row.lastElementChild);
      }
      cell.innerHTML = cellHtml(idx, empCode);
    });

    host.querySelectorAll("[data-emp-pass-reset]").forEach((btn) => {
      if (btn.__spwtEmpPassWired) return;
      btn.__spwtEmpPassWired = true;
      btn.onclick = () => resetPassword(Number(btn.getAttribute("data-emp-pass-reset")));
    });
  }

  async function resetPassword(idx) {
    const row = employeeRows().find((r) => Number(r.querySelector('[data-field="empId"]')?.getAttribute("data-e-idx")) === idx);
    if (!row) return;
    const empCode = normEmp(row.querySelector('[data-field="empId"]')?.value || "");
    const empName = clean(row.querySelector('[data-field="name"]')?.value || "");
    const input = row.querySelector(`[data-emp-pass-input="${idx}"]`);
    const password = clean(input?.value || "");
    if (!empCode) { alert("Enter Employee ID first."); row.querySelector('[data-field="empId"]')?.focus(); return; }
    if (!password || password.length < 4) { alert("Enter employee password/PIN, minimum 4 characters."); input?.focus(); return; }

    try {
      btnBusy(row, true);
      const body = await requestJson("/api/employee-auth/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empCode, empName, password })
      });
      statusByEmp.set(empCode, { empCode, hasPassword: true, updatedAt: body.data?.updatedAt || "" });
      if (input) input.value = "";
      renderPasswordCells();
      alert(`Password reset for ${empCode}.`);
    } catch (err) {
      alert("Employee password reset failed:\n\n" + (err.message || err));
    } finally {
      btnBusy(row, false);
    }
  }

  function btnBusy(row, busy) {
    const btn = row.querySelector("[data-emp-pass-reset]");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? "Saving..." : "Reset";
  }

  function wrapRender() {
    if (renderWrapped || typeof window.renderAdminEmployees !== "function") return;
    const original = window.renderAdminEmployees;
    window.renderAdminEmployees = function (...args) {
      const result = original.apply(this, args);
      setTimeout(() => { renderPasswordCells(); loadPasswordStatus(); }, 0);
      return result;
    };
    renderWrapped = true;
  }

  function wire() {
    addStyles();
    wrapRender();
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.('[data-tab="tabEmployees"]')) setTimeout(() => { renderPasswordCells(); loadPasswordStatus(); }, 50);
    }, true);
    const host = $("employeesList");
    if (host && !host.__spwtEmployeePasswordObserved) {
      host.__spwtEmployeePasswordObserved = true;
      new MutationObserver(() => renderPasswordCells()).observe(host, { childList: true, subtree: true });
    }
    setTimeout(() => { renderPasswordCells(); loadPasswordStatus(); }, 800);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();
