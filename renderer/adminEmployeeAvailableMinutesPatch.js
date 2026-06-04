// renderer/adminEmployeeAvailableMinutesPatch.js
// Adds Available Minutes / Day to Employee master and saves it separately to DB.

(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 15000;

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function hoursText(minutes) { return `${(num(minutes, 0) / 60).toFixed(1)} hr`; }

  function getGlobal(name, fallback) {
    try {
      // app.js uses top-level let variables; direct eval can read those global lexical bindings.
      // eslint-disable-next-line no-eval
      const value = eval(name);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function tokenHeaders() {
    return window.SPWT_ADMIN_TOKEN_HEADER ? window.SPWT_ADMIN_TOKEN_HEADER() : {};
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload;
    } finally { clearTimeout(timer); }
  }

  function status(message, type = "") {
    let el = $("employeeMinutesStatus");
    const btn = $("saveEmployeeMinutesBtn");
    if (!el && btn) {
      el = document.createElement("span");
      el.id = "employeeMinutesStatus";
      el.className = "small-hint";
      el.style.fontWeight = "900";
      btn.insertAdjacentElement("afterend", el);
    }
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function getEmployees() {
    const admin = getGlobal("adminOverrides", null);
    const fromAdmin = Array.isArray(admin?.employees) ? admin.employees : [];
    if (fromAdmin.length) return fromAdmin;
    const fromGlobal = getGlobal("employees", []);
    return Array.isArray(fromGlobal) ? fromGlobal : [];
  }

  function syncHourLabel(input) {
    const label = input.closest("td")?.querySelector(".emp-min-hours");
    if (label) label.textContent = hoursText(input.value);
  }

  function readVisibleMinutes() {
    const list = getEmployees();
    document.querySelectorAll("[data-emp-min-idx]").forEach(input => {
      const idx = Number(input.dataset.empMinIdx);
      if (!list[idx]) return;
      const minutes = Math.max(0, Math.min(1440, Math.round(num(input.value, 0))));
      input.value = String(minutes);
      list[idx].availableMinutesDay = minutes;
      list[idx].available_minutes_day = minutes;
      syncHourLabel(input);
    });
  }

  async function saveMinutes() {
    try {
      readVisibleMinutes();
      const records = getEmployees().map(e => ({
        empCode: clean(e.empId || e.emp_code || e.code),
        availableMinutesDay: num(e.availableMinutesDay ?? e.available_minutes_day, 0)
      })).filter(r => r.empCode);

      if (!records.length) throw new Error("No employee records found on screen. Reload Admin page and try again.");

      status("Saving employee available minutes...");
      const payload = await requestJson("/api/admin/employee-available-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tokenHeaders() },
        body: JSON.stringify({ records })
      });
      status(`Available minutes saved for ${payload.data?.count || 0} employee(s).`, "success");
    } catch (err) {
      status("Save failed: " + (err?.message || err), "error");
    }
  }

  function enhanceEmployeeTable() {
    const host = $("employeesList");
    const table = host?.querySelector("table");
    if (!table || table.dataset.minutesEnhanced === "1") return;
    const rows = table.querySelectorAll("tbody tr");
    if (!rows.length) return;

    const headRow = table.querySelector("thead tr");
    const actionHead = headRow?.lastElementChild;
    const thMin = document.createElement("th");
    thMin.textContent = "Available Min/Day";
    thMin.style.minWidth = "170px";
    thMin.title = "Used for absent capacity loss hours. Example: 480 for 8 hrs, 600 for 10 hrs.";
    const thHr = document.createElement("th");
    thHr.textContent = "Hours/Day";
    thHr.style.minWidth = "95px";
    if (actionHead) {
      headRow.insertBefore(thMin, actionHead);
      headRow.insertBefore(thHr, actionHead);
    } else {
      headRow?.appendChild(thMin);
      headRow?.appendChild(thHr);
    }

    const employees = getEmployees();
    rows.forEach((row, idx) => {
      const actionCell = row.lastElementChild;
      const value = num(employees[idx]?.availableMinutesDay ?? employees[idx]?.available_minutes_day, 0);

      const tdMin = document.createElement("td");
      tdMin.innerHTML = `<input class="admin-input" data-emp-min-idx="${idx}" type="number" min="0" max="1440" step="1" value="${value}" placeholder="480" title="Available minutes per day" style="min-width:135px;width:150px;text-align:right;font-weight:900;" />`;

      const tdHr = document.createElement("td");
      tdHr.innerHTML = `<span class="emp-min-hours" style="font-weight:900;color:#0b3f73;">${hoursText(value)}</span>`;

      if (actionCell) {
        row.insertBefore(tdMin, actionCell);
        row.insertBefore(tdHr, actionCell);
      } else {
        row.appendChild(tdMin);
        row.appendChild(tdHr);
      }
    });

    table.querySelectorAll("[data-emp-min-idx]").forEach(input => {
      input.addEventListener("input", () => syncHourLabel(input));
      input.addEventListener("change", () => { readVisibleMinutes(); });
    });

    table.dataset.minutesEnhanced = "1";

    if (!$("saveEmployeeMinutesBtn")) {
      const box = document.createElement("div");
      box.className = "row admin-controls-actions";
      box.style.marginTop = "10px";
      box.innerHTML = `<button class="btn green" id="saveEmployeeMinutesBtn" type="button">Save Available Minutes / Day</button><span class="small-hint">Used for Absent Report capacity loss. 480 = 8 hr, 600 = 10 hr. Blank/0 uses fallback.</span>`;
      host.insertAdjacentElement("afterend", box);
      $("saveEmployeeMinutesBtn")?.addEventListener("click", saveMinutes);
    }
  }

  function wire() {
    enhanceEmployeeTable();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(wire, 1000));
  document.addEventListener("click", () => setTimeout(wire, 150), true);
  setInterval(wire, 1500);
})();
