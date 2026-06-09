// renderer/admin/adminPerformanceCommentsPatch.js
// Admin UI for monthly employee performance report comments.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 500));
  setInterval(init, 2000);

  function init() {
    const tabs = document.querySelector("#adminPanel .tabs");
    const panel = $("adminPanel");
    if (!tabs || !panel || $("tabPerformanceComments")) return;

    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.dataset.tab = "tabPerformanceComments";
    btn.textContent = "Performance Comments";
    tabs.insertBefore(btn, tabs.querySelector('[data-tab="tabPin"]') || null);

    const page = document.createElement("div");
    page.className = "tab-page hidden";
    page.id = "tabPerformanceComments";
    page.innerHTML = html();

    const hr = panel.querySelector("hr");
    if (hr) panel.insertBefore(page, hr);
    else panel.appendChild(page);

    btn.addEventListener("click", () => {
      showTab();
      populateYearsMonths();
      populateEmployees();
      loadComment();
    });

    ["perfCommentYear", "perfCommentMonth", "perfCommentEmployee"].forEach((id) => {
      $(id)?.addEventListener("change", loadComment);
    });
    $("savePerfCommentBtn")?.addEventListener("click", saveComment);

    populateYearsMonths();
    populateEmployees();
  }

  function html() {
    return `
      <div class="row-between">
        <div>
          <div class="section-title">Employee Performance Comments</div>
          <div class="small-hint">Monthly remarks shown in Employee Performance Report for selected year, month and employee.</div>
        </div>
      </div>

      <div class="card admin-controls-card">
        <div class="grid-2">
          <div class="field"><label>Year</label><select id="perfCommentYear" class="admin-select"></select></div>
          <div class="field"><label>Month</label><select id="perfCommentMonth" class="admin-select"></select></div>
          <div class="field"><label>Employee</label><select id="perfCommentEmployee" class="admin-select"></select></div>
          <div class="field"><label>Department</label><input id="perfCommentDepartment" class="admin-input" readonly /></div>
        </div>

        <div class="field"><label>Positive Points</label><textarea id="perfCommentPositives" class="admin-input" rows="3" placeholder="Good output, discipline, quality support..."></textarea></div>
        <div class="field"><label>Negative Points / Improvement Areas</label><textarea id="perfCommentNegatives" class="admin-input" rows="3" placeholder="Attendance, rework, speed, documentation..."></textarea></div>
        <div class="field"><label>Initiatives</label><textarea id="perfCommentInitiatives" class="admin-input" rows="3" placeholder="Improvement activity, kaizen, support work..."></textarea></div>
        <div class="field"><label>Multi-skill Initiative</label><textarea id="perfCommentMultiSkill" class="admin-input" rows="3" placeholder="Training on other department/sub-work, multi-skill progress..."></textarea></div>

        <div class="row admin-controls-actions">
          <button class="btn green" id="savePerfCommentBtn" type="button">Save Performance Comment</button>
          <span class="small-hint" id="perfCommentStatus"></span>
        </div>
      </div>
    `;
  }

  function showTab() {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === "tabPerformanceComments"));
    document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("hidden", p.id !== "tabPerformanceComments"));
  }

  function populateYearsMonths() {
    const y = $("perfCommentYear");
    const m = $("perfCommentMonth");
    if (!y || !m || y.options.length) return;
    const now = new Date();
    const currentYear = now.getFullYear();
    y.innerHTML = [currentYear - 1, currentYear, currentYear + 1]
      .map((year) => `<option value="${year}" ${year === currentYear ? "selected" : ""}>${year}</option>`).join("");
    m.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((month) => `<option value="${month}" ${month === now.getMonth() + 1 ? "selected" : ""}>${monthName(month)}</option>`).join("");
  }

  function populateEmployees() {
    const select = $("perfCommentEmployee");
    if (!select) return;
    const old = select.value;
    const list = getEmployees();
    select.innerHTML = `<option value="">Select Employee</option>` + list.map((e) => {
      const val = [e.code, e.name, e.department].map(encodeURIComponent).join("|");
      const label = `${e.code ? e.code + " - " : ""}${e.name}${e.department ? " (" + e.department + ")" : ""}`;
      return `<option value="${esc(val)}">${esc(label)}</option>`;
    }).join("");
    if (old) select.value = old;
  }

  function getEmployees() {
    try {
      // app.js keeps employees as a global lexical binding in this window.
      // eslint-disable-next-line no-eval
      const rows = eval("employees") || [];
      return rows
        .filter((e) => e && e.active !== false)
        .map((e) => ({ code: clean(e.empId || e.emp_code || e.code), name: clean(e.name || e.full_name || e.emp_name), department: clean(e.department) }))
        .filter((e) => e.code || e.name)
        .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code));
    } catch {
      return [];
    }
  }

  function selectedEmployee() {
    const [code, name, department] = String($("perfCommentEmployee")?.value || "").split("|").map(decodeURIComponent);
    return { empCode: clean(code), empName: clean(name), department: clean(department) };
  }

  function setStatus(msg, ok = true) {
    const el = $("perfCommentStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = ok ? "#15803d" : "#b91c1c";
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(options.headers || {}),
          ...(window.SPWT_ADMIN_TOKEN_HEADER?.() || {})
        }
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || `Request failed ${res.status}`);
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadComment() {
    const emp = selectedEmployee();
    const dept = $("perfCommentDepartment");
    if (dept) dept.value = emp.department || "";
    if (!emp.empCode && !emp.empName) return clearFields();

    try {
      setStatus("Loading...");
      const qs = new URLSearchParams({
        year: $("perfCommentYear")?.value || "",
        month: $("perfCommentMonth")?.value || "",
        empCode: emp.empCode,
        empName: emp.empName
      });
      const row = await requestJson(`/api/admin/performance-comment?${qs.toString()}`);
      setFields(row || {});
      setStatus(row ? "Loaded." : "No comment saved yet.");
    } catch (err) {
      setStatus(err.message || String(err), false);
    }
  }

  async function saveComment() {
    const emp = selectedEmployee();
    if (!emp.empCode && !emp.empName) return setStatus("Select employee first.", false);

    const body = {
      year: Number($("perfCommentYear")?.value || new Date().getFullYear()),
      month: Number($("perfCommentMonth")?.value || new Date().getMonth() + 1),
      ...emp,
      positives: clean($("perfCommentPositives")?.value),
      negatives: clean($("perfCommentNegatives")?.value),
      initiatives: clean($("perfCommentInitiatives")?.value),
      multiSkillInitiative: clean($("perfCommentMultiSkill")?.value)
    };

    try {
      setStatus("Saving...");
      await requestJson("/api/admin/performance-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setStatus("Saved.");
    } catch (err) {
      setStatus(err.message || String(err), false);
    }
  }

  function setFields(row) {
    $("perfCommentPositives") && ($("perfCommentPositives").value = row.positives || "");
    $("perfCommentNegatives") && ($("perfCommentNegatives").value = row.negatives || "");
    $("perfCommentInitiatives") && ($("perfCommentInitiatives").value = row.initiatives || "");
    $("perfCommentMultiSkill") && ($("perfCommentMultiSkill").value = row.multiSkillInitiative || "");
  }

  function clearFields() { setFields({}); setStatus(""); }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function monthName(month) { return new Date(2026, Number(month) - 1, 1).toLocaleString("en-IN", { month: "long" }); }
})();
