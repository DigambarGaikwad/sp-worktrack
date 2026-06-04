// renderer/maintenanceBackupDeletePatch.js
// Adds Delete Selected Backup File action to Restore DB Backup box.

(function () {
  const REQUEST_TIMEOUT_MS = 60000;

  function apiBaseUrl() {
    return window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  }

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

  async function post(path, body = {}) {
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
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `API error ${res.status}`);
      return payload.data;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Request timed out. Check backend/PocketBase and try again.");
      if (/failed to fetch/i.test(String(err?.message || err))) throw new Error("Cannot reach backend server. Restart npm run server and try again.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function show(message, type = "info") {
    const el = document.getElementById("restoreBackupResult");
    if (!el) return;
    const color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#0b3f73";
    el.innerHTML = `<div style="margin-top:10px;font-weight:900;color:${color};">${esc(message)}</div>`;
  }

  function ensureDeleteUi() {
    const restoreBtn = document.getElementById("restoreBackupBtn");
    if (!restoreBtn || document.getElementById("deleteBackupFileBtn")) return;

    const wrap = document.createElement("div");
    wrap.className = "backup-delete-box";
    wrap.style.marginTop = "12px";
    wrap.style.borderTop = "1px solid #e5e7eb";
    wrap.style.paddingTop = "10px";
    wrap.innerHTML = `
      <div class="small-hint danger-note">Delete selected backup file from local backups folder. Database data will not be affected.</div>
      <label class="confirm-label">Type DELETE_BACKUP here to confirm</label>
      <input id="deleteBackupConfirmText" class="admin-input confirm-input" placeholder="DELETE_BACKUP" autocomplete="off" />
      <button class="btn red" id="deleteBackupFileBtn" type="button">Delete Selected Backup File</button>
    `;

    restoreBtn.insertAdjacentElement("afterend", wrap);
    document.getElementById("deleteBackupFileBtn")?.addEventListener("click", deleteSelectedBackup, true);
  }

  async function refreshBackupList(files = []) {
    const select = document.getElementById("restoreBackupFileSelect");
    if (!select) return;

    select.innerHTML = `<option value="">Select backup file</option>` + files.map(f => {
      const label = `${f.fileName} | ${f.createdAt || f.modifiedAt || ""} | ${Math.round((Number(f.sizeBytes) || 0) / 1024)} KB`;
      return `<option value="${esc(f.fileName)}">${esc(label)}</option>`;
    }).join("");

    if (files[0]) select.value = files[0].fileName;
  }

  async function deleteSelectedBackup(e) {
    e.preventDefault();
    e.stopImmediatePropagation();

    try {
      const fileName = clean(document.getElementById("restoreBackupFileSelect")?.value);
      const confirmText = clean(document.getElementById("deleteBackupConfirmText")?.value);

      if (!fileName) throw new Error("Select backup file first.");
      if (confirmText !== "DELETE_BACKUP") throw new Error("Type DELETE_BACKUP first.");
      if (!confirm(`Delete this backup file?\n\n${fileName}`)) return;

      show("Deleting backup file...");
      const data = await post("/api/maintenance/backups/delete", { fileName, confirmText });

      const input = document.getElementById("deleteBackupConfirmText");
      if (input) input.value = "";
      await refreshBackupList(Array.isArray(data.remaining) ? data.remaining : []);
      show(`Deleted backup file: ${data.deletedFile}`, "success");
    } catch (err) {
      show(err?.message || String(err), "error");
    }
  }

  function wire() {
    ensureDeleteUi();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(wire, 1000));
  document.addEventListener("click", () => setTimeout(wire, 200), true);
  setInterval(wire, 1500);
})();
