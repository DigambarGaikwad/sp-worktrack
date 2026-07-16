// renderer/employeeEntryAuthPatch.js
// Verifies selected employee before production entry so one employee cannot submit as another.
(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3032";
  const authState = { empCode: "", empName: "", token: "" };
  let loginBusy = false;

  function $(id) { return document.getElementById(id); }
  function clean(v) { return String(v ?? "").trim(); }
  function normEmp(v) { return clean(v).toUpperCase(); }
  function selectedEmployee() {
    const sel = $("employeeSelect");
    const empCode = normEmp(sel?.value || "");
    const empName = clean(sel?.selectedOptions?.[0]?.textContent || "").replace(/^\s*[^-]+-\s*/, "");
    return { empCode, empName };
  }
  function showEntryMessageSafe(message, type = "error") {
    if (typeof window.showEntryMessage === "function") window.showEntryMessage(message, type);
    else alert(message);
  }

  async function postJson(path, body) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
    return payload;
  }

  function isVerifiedFor(empCode) {
    return !!empCode && authState.empCode === normEmp(empCode) && !!authState.token;
  }

  function setEntryLocked(locked) {
    const addBtn = $("addWorkBtnBottom");
    const submitBtn = $("submitBtn");
    if (addBtn) addBtn.disabled = !!locked;
    if (submitBtn) submitBtn.disabled = !!locked;
    updateAuthHint();
  }

  function updateAuthHint() {
    let hint = $("employeeAuthHint");
    const sel = $("employeeSelect");
    if (!sel) return;
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "employeeAuthHint";
      hint.className = "small-hint";
      sel.closest(".field")?.appendChild(hint);
    }
    const emp = selectedEmployee();
    if (!emp.empCode) { hint.textContent = ""; return; }
    const verified = isVerifiedFor(emp.empCode);
    hint.textContent = verified ? "Employee verified for this entry." : "Employee password verification required.";
    hint.style.color = verified ? "#166534" : "#b45309";
    hint.style.fontWeight = "800";
  }

  function ensureModal() {
    if ($("employeeAuthOverlay")) return;
    const style = document.createElement("style");
    style.id = "employeeAuthStyle";
    style.textContent = `
      #employeeAuthOverlay { position:fixed; inset:0; background:rgba(15,23,42,.46); z-index:60000; display:none; align-items:center; justify-content:center; padding:18px; }
      #employeeAuthOverlay.show { display:flex; }
      .employee-auth-card { width:min(440px, 96vw); background:#fff; border-radius:18px; box-shadow:0 24px 70px rgba(15,23,42,.28); overflow:hidden; }
      .employee-auth-head { padding:16px 18px; border-bottom:1px solid #e5edf7; display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
      .employee-auth-body { padding:18px; }
      .employee-auth-title { font-size:20px; font-weight:900; color:#0f172a; }
      .employee-auth-msg { margin-top:10px; font-weight:800; }
      .employee-auth-error { color:#b91c1c; }
      .employee-auth-ok { color:#166534; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "employeeAuthOverlay";
    overlay.innerHTML = `
      <div class="employee-auth-card">
        <div class="employee-auth-head">
          <div>
            <div class="employee-auth-title">Employee Password Required</div>
            <div class="small-hint" id="employeeAuthWho">Select employee first.</div>
          </div>
          <button type="button" class="btn grey" id="employeeAuthCancelBtn">Cancel</button>
        </div>
        <div class="employee-auth-body">
          <div class="field">
            <label>Employee Password / PIN</label>
            <input id="employeeAuthPasswordInput" class="admin-input" type="password" placeholder="Enter employee password" autocomplete="current-password" />
          </div>
          <div class="row" style="margin-top:12px;justify-content:flex-start;">
            <button type="button" class="btn green" id="employeeAuthVerifyBtn">Verify & Continue</button>
          </div>
          <div id="employeeAuthMessage" class="small-hint employee-auth-msg"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    $("employeeAuthCancelBtn").onclick = () => closeModal(false);
    $("employeeAuthVerifyBtn").onclick = verifyEmployeePassword;
    $("employeeAuthPasswordInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); verifyEmployeePassword(); }
    });
  }

  function openModal() {
    const emp = selectedEmployee();
    if (!emp.empCode || isVerifiedFor(emp.empCode)) return;
    ensureModal();
    $("employeeAuthWho").textContent = `${emp.empCode}${emp.empName ? " - " + emp.empName : ""}`;
    $("employeeAuthMessage").textContent = "";
    $("employeeAuthMessage").className = "small-hint employee-auth-msg";
    const input = $("employeeAuthPasswordInput");
    if (input) input.value = "";
    $("employeeAuthOverlay").classList.add("show");
    requestAnimationFrame(() => input?.focus());
  }

  function closeModal(verified) {
    $("employeeAuthOverlay")?.classList.remove("show");
    setEntryLocked(!verified && !!selectedEmployee().empCode && !isVerifiedFor(selectedEmployee().empCode));
  }

  async function verifyEmployeePassword() {
    if (loginBusy) return;
    const emp = selectedEmployee();
    const password = clean($("employeeAuthPasswordInput")?.value || "");
    const msg = $("employeeAuthMessage");
    if (!emp.empCode) { closeModal(false); return; }
    if (!password) { if (msg) { msg.textContent = "Enter employee password."; msg.className = "small-hint employee-auth-msg employee-auth-error"; } $("employeeAuthPasswordInput")?.focus(); return; }

    try {
      loginBusy = true;
      const btn = $("employeeAuthVerifyBtn");
      if (btn) { btn.disabled = true; btn.textContent = "Checking..."; }
      const body = await postJson("/api/employee-auth/login", { empCode: emp.empCode, password });
      authState.empCode = emp.empCode;
      authState.empName = emp.empName;
      authState.token = body.data?.token || "";
      if (msg) { msg.textContent = "Verified."; msg.className = "small-hint employee-auth-msg employee-auth-ok"; }
      setEntryLocked(false);
      setTimeout(() => closeModal(true), 180);
    } catch (err) {
      authState.empCode = ""; authState.token = "";
      setEntryLocked(true);
      if (msg) { msg.textContent = err.message || String(err); msg.className = "small-hint employee-auth-msg employee-auth-error"; }
      $("employeeAuthPasswordInput")?.focus();
    } finally {
      loginBusy = false;
      const btn = $("employeeAuthVerifyBtn");
      if (btn) { btn.disabled = false; btn.textContent = "Verify & Continue"; }
    }
  }

  function onEmployeeChanged() {
    const emp = selectedEmployee();
    if (!emp.empCode) { authState.empCode = ""; authState.token = ""; setEntryLocked(false); updateAuthHint(); return; }
    if (authState.empCode !== emp.empCode) authState.token = "";
    authState.empCode = emp.empCode;
    authState.empName = emp.empName;
    setEntryLocked(true);
    openModal();
  }

  function requireVerified(event) {
    const emp = selectedEmployee();
    if (!emp.empCode || isVerifiedFor(emp.empCode)) return true;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    showEntryMessageSafe("Employee password verification required before continuing.", "error");
    openModal();
    return false;
  }

  function wrapBuildPayload() {
    if (window.__spwtEmployeeAuthBuildPayloadWrapped || typeof window.buildPayload !== "function") return;
    const original = window.buildPayload;
    window.buildPayload = function (...args) {
      const payload = original.apply(this, args);
      payload.employeeAuthToken = isVerifiedFor(payload.teamMemberId || payload.empCode) ? authState.token : "";
      return payload;
    };
    window.__spwtEmployeeAuthBuildPayloadWrapped = true;
  }

  function wire() {
    ensureModal();
    wrapBuildPayload();
    const sel = $("employeeSelect");
    if (sel && !sel.__spwtEmployeeAuthWired) {
      sel.__spwtEmployeeAuthWired = true;
      sel.addEventListener("change", onEmployeeChanged, true);
    }
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.("#submitBtn,#addWorkBtnBottom")) requireVerified(event);
    }, true);
    setTimeout(wrapBuildPayload, 800);
    setTimeout(wrapBuildPayload, 1800);
    updateAuthHint();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();
