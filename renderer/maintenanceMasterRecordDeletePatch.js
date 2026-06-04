// renderer/maintenanceMasterRecordDeletePatch.js
// Adds Maintenance option to permanently delete one selected master/setup record,
// or all records under a selected master type when no specific record is selected.

(function () {
  const REQUEST_TIMEOUT_MS = 45000;
  const DELETE_ACTION = "master_record_delete";
  let groups = [];
  let pendingDelete = null;

  function apiBaseUrl() { return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030"; }
  function clean(value) { return String(value ?? "").trim(); }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

  async function requestJson(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body || {})
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}. Restart backend and try again.`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timed out. Check backend/PocketBase and try again.");
      if (/failed to fetch/i.test(String(err?.message || err))) throw new Error("Cannot reach backend server. Restart npm run server and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function showStatus(message, type = "info") {
    const host = document.getElementById("masterRecordDeleteResult");
    if (!host) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#0b3f73";
    host.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function selectedGroup() {
    const collection = clean(document.getElementById("masterDeleteTypeSelect")?.value);
    return groups.find(x => x.collection === collection) || null;
  }

  function selectedItem() {
    const group = selectedGroup();
    const id = clean(document.getElementById("masterDeleteRecordSelect")?.value);
    return group?.items?.find(x => x.id === id) || null;
  }

  function fillTypeSelect() {
    const select = document.getElementById("masterDeleteTypeSelect");
    if (!select) return;
    select.innerHTML = `<option value="">Select master type</option>` + groups.map(g => `<option value="${esc(g.collection)}">${esc(g.title)} (${g.count || 0})</option>`).join("");
  }

  function fillRecordSelect() {
    const select = document.getElementById("masterDeleteRecordSelect");
    const hint = document.getElementById("masterDeleteRecordHint");
    const group = selectedGroup();
    if (!select) return;
    if (!group) {
      select.innerHTML = `<option value="">Select master type first</option>`;
      if (hint) hint.textContent = "";
      return;
    }
    select.innerHTML = `<option value="">All records in ${esc(group.title)}</option>` + (group.items || []).map(item => `<option value="${esc(item.id)}">${esc(item.label)}${item.details ? ` — ${esc(item.details)}` : ""}</option>`).join("");
    if (hint) hint.textContent = `${group.count || 0} record(s) found. Keep Specific Record blank to delete ALL records in ${group.title}.`;
  }

  function showSelectionDetails() {
    const group = selectedGroup();
    const item = selectedItem();
    const host = document.getElementById("masterDeleteSelectedDetails");
    if (!host) return;

    if (!group) {
      host.innerHTML = "";
      return;
    }

    host.innerHTML = item
      ? `<b>Selected record:</b> ${esc(item.label)}${item.details ? `<br><span class="small-hint">${esc(item.details)}</span>` : ""}`
      : `<b class="danger-note">No specific record selected:</b> This will delete ALL ${esc(group.title)} records (${esc(group.count || 0)}).`;
  }

  function ensureBox() {
    const grid = document.querySelector("#tabMaintenance .maintenance-grid");
    if (!grid || document.getElementById("masterRecordDeleteBox")) return;

    const box = document.createElement("div");
    box.className = "maintenance-box";
    box.id = "masterRecordDeleteBox";
    box.innerHTML = `
      <div class="maintenance-title">6. Delete Master Records</div>
      <div class="small-hint">Delete one selected record, or delete all records under selected master type when Specific Record is blank.</div>
      <div class="small-hint danger-note">Backup first. Existing historical production logs are not removed.</div>
      <button class="btn grey" id="reloadMasterDeleteOptionsBtn" type="button">Load Master Records</button>
      <div class="grid-2" style="margin-top:10px;">
        <div class="field"><label>Master Type</label><select id="masterDeleteTypeSelect" class="admin-select"><option value="">Load records first</option></select></div>
        <div class="field"><label>Specific Record (optional)</label><select id="masterDeleteRecordSelect" class="admin-select"><option value="">Select master type first</option></select></div>
      </div>
      <div class="small-hint" id="masterDeleteRecordHint"></div>
      <div class="small-hint" id="masterDeleteSelectedDetails"></div>
      <label class="confirm-label">Type DELETE here to confirm</label>
      <input id="masterDeleteConfirmText" class="admin-input confirm-input" placeholder="DELETE" autocomplete="off" />
      <button class="btn red" id="confirmMasterRecordDeleteBtn" type="button">Delete Master Record(s)</button>
      <div id="masterRecordDeleteResult"></div>
    `;
    grid.appendChild(box);
  }

  async function loadOptions(btn) {
    try {
      if (btn) btn.disabled = true;
      showStatus("Loading master records...");
      const data = await requestJson("/api/maintenance/master-records/options", {});
      groups = Array.isArray(data.groups) ? data.groups : [];
      fillTypeSelect();
      fillRecordSelect();
      showSelectionDetails();
      showStatus("Master records loaded.", "success");
    } catch (err) {
      showStatus(err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteWithOtp(btn, otpPayload = {}) {
    if (!pendingDelete) return;
    try {
      const requestToken = clean(otpPayload.otpRequestToken || otpPayload.requestToken);
      const otp = clean(otpPayload.otp);
      if (!requestToken || !otp) throw new Error("Maintenance OTP details missing. Request OTP again.");

      btn.disabled = true;
      showStatus(pendingDelete.deleteAll ? "Deleting all selected master type records..." : "Deleting selected master record...");
      const data = await requestJson("/api/maintenance/master-records/delete", {
        ...pendingDelete,
        action: DELETE_ACTION,
        otpRequestToken: requestToken,
        requestToken,
        otp
      });
      window.SPWT_CLOSE_MAINTENANCE_OTP?.();

      const msg = data.mode === "all"
        ? `Deleted ${data.deleted || 0} record(s) from ${data.title || data.collection}.`
        : `Deleted from ${data.title || data.collection}: ${data.item?.label || "selected record"}.`;
      showStatus(msg, "success");

      pendingDelete = null;
      const input = document.getElementById("masterDeleteConfirmText");
      if (input) input.value = "";
      await loadOptions(null);
    } catch (err) {
      showStatus(err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function requestDelete(btn) {
    try {
      const group = selectedGroup();
      const item = selectedItem();
      const confirmText = clean(document.getElementById("masterDeleteConfirmText")?.value);
      if (!group) throw new Error("Select master type first.");
      if (confirmText !== "DELETE") throw new Error("Type DELETE in the confirmation box first.");
      if (typeof window.SPWT_REQUEST_MAINTENANCE_OTP !== "function") throw new Error("Maintenance OTP UI is not loaded. Restart app and try again.");

      const deleteAll = !item;
      pendingDelete = {
        collection: group.collection,
        id: item?.id || "",
        confirmText,
        deleteAll,
        deleteMode: deleteAll ? "all" : "single"
      };

      btn.disabled = true;
      showStatus(deleteAll ? `Sending OTP to delete ALL ${group.title} records...` : "Sending Maintenance OTP...");
      await window.SPWT_REQUEST_MAINTENANCE_OTP(DELETE_ACTION);
      showStatus("OTP sent. Enter OTP and click Verify & Continue.");
    } catch (err) {
      showStatus(err?.message || String(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireOtpListener() {
    if (document.__masterRecordDeleteOtpListenerWired) return;
    document.__masterRecordDeleteOtpListenerWired = true;
    document.addEventListener("spwt-maintenance-otp-ready", (event) => {
      const detail = event?.detail || {};
      if (detail.action !== DELETE_ACTION) return;
      const btn = document.getElementById("confirmMasterRecordDeleteBtn") || { disabled: false };
      deleteWithOtp(btn, detail);
    });
  }

  function wire() {
    ensureBox();
    wireOtpListener();
    const loadBtn = document.getElementById("reloadMasterDeleteOptionsBtn");
    const typeSelect = document.getElementById("masterDeleteTypeSelect");
    const recordSelect = document.getElementById("masterDeleteRecordSelect");
    const deleteBtn = document.getElementById("confirmMasterRecordDeleteBtn");

    if (loadBtn && !loadBtn.__wired) {
      loadBtn.__wired = true;
      loadBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); loadOptions(loadBtn); }, true);
    }
    if (typeSelect && !typeSelect.__wired) {
      typeSelect.__wired = true;
      typeSelect.addEventListener("change", () => { fillRecordSelect(); showSelectionDetails(); });
    }
    if (recordSelect && !recordSelect.__wired) {
      recordSelect.__wired = true;
      recordSelect.addEventListener("change", showSelectionDetails);
    }
    if (deleteBtn && !deleteBtn.__wired) {
      deleteBtn.__wired = true;
      deleteBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); requestDelete(deleteBtn); }, true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(wire, 700));
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.('[data-tab="tabMaintenance"]')) setTimeout(wire, 300);
    setTimeout(wire, 100);
  }, true);
  setInterval(() => {
    const tab = document.getElementById("tabMaintenance");
    if (tab && !tab.classList.contains("hidden")) wire();
  }, 1500);
})();
