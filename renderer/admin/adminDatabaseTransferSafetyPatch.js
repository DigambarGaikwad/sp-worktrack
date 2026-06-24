// renderer/admin/adminDatabaseTransferSafetyPatch.js
// Safety polish for Database Transfer tab: hide unused optional count rows, guard runtime buttons, and use direct ZIP downloads.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const OPTIONAL_COLLECTIONS = new Set([
    "machine_categories",
    "work_subworks",
    "admin_access_users",
    "backup_logs"
  ]);

  const TASKS = {
    pocketbase: "SP WorkTrack PocketBase",
    node: "SP WorkTrack Node Server"
  };

  function $(id) { return document.getElementById(id); }

  function text(el) {
    return String(el?.textContent || "").trim();
  }

  function token() {
    return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || "";
  }

  function setRuntimeStatus(message, type = "") {
    const el = $("dbRuntimeStatusLine");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
  }

  function setTransferStatus(message, type = "") {
    const el = $("dbTransferStatusLine");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
  }

  function findCardByTitle(title) {
    return Array.from(document.querySelectorAll("#tabDatabaseTransfer .card")).find(card => {
      const heading = card.querySelector(".section-title");
      return text(heading) === title;
    }) || null;
  }

  function addHint(card, id, message) {
    if (!card || document.getElementById(id)) return;
    const hint = document.createElement("div");
    hint.id = id;
    hint.className = "small-hint";
    hint.style.marginTop = "8px";
    hint.style.fontWeight = "800";
    hint.style.color = "#0b3f73";
    hint.textContent = message;
    card.appendChild(hint);
  }

  function cleanOptionalCountRows() {
    const card = findCardByTitle("Record Count Preview");
    if (!card) return;

    let hidden = 0;
    card.querySelectorAll("tbody tr").forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;

      const collection = text(cells[0]);
      if (!OPTIONAL_COLLECTIONS.has(collection)) return;

      const records = text(cells[1]);
      const status = text(cells[2]);
      const missingOptional = /optional|unavailable|missing|not created|legacy|not used/i.test(records + " " + status);
      if (!missingOptional) return;

      row.style.display = "none";
      row.dataset.spwtOptionalHidden = "1";
      hidden += 1;
    });

    if (hidden > 0) {
      addHint(card, "dbTransferOptionalHiddenHint", "Optional collections not used in this DB structure are hidden. Full pb_data transfer still includes all actual database files.");
    }
  }

  function getTaskState(taskName) {
    const card = findCardByTitle("Windows Task Scheduler Status");
    if (!card) return { checked: false, exists: false, status: "Unknown" };

    const row = Array.from(card.querySelectorAll("tbody tr")).find(r => text(r.querySelector("td")) === taskName);
    if (!row) return { checked: true, exists: false, status: "Not Created" };

    const cells = row.querySelectorAll("td");
    const status = text(cells[1]);
    return {
      checked: true,
      exists: !/not created|not found|missing|error/i.test(status),
      status
    };
  }

  function setButtonGuard(btn, enabled, message) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.title = enabled ? "" : message;
    btn.style.opacity = enabled ? "" : "0.55";
    btn.style.cursor = enabled ? "" : "not-allowed";
  }

  function guardRuntimeButtons() {
    const tab = $("tabDatabaseTransfer");
    if (!tab || tab.classList.contains("hidden")) return;

    const pbState = getTaskState(TASKS.pocketbase);
    const nodeState = getTaskState(TASKS.node);
    const checked = pbState.checked || nodeState.checked;
    const message = checked
      ? "Create / Update Auto-start Tasks first, then run this task."
      : "Click Check Runtime Status first.";

    setButtonGuard($("dbRuntimeStartPbBtn"), pbState.exists, message);
    setButtonGuard($("dbRuntimeStartNodeBtn"), nodeState.exists, message);

    const card = findCardByTitle("Windows Task Scheduler Status");
    if (card && (!pbState.exists || !nodeState.exists)) {
      addHint(card, "dbRuntimeStartGuardHint", "Start task buttons are enabled only after the Windows Task Scheduler tasks are created.");
    }
  }

  async function latestPackageName() {
    const fromPath = text($("dbTransferLatestPath"));
    const file = fromPath.split(/[\\/]/).pop();
    if (file && file.startsWith("SPWT_TRANSFER") && file.endsWith(".zip")) return file;

    const headers = {};
    const t = token();
    if (t) headers["x-spwt-admin-token"] = t;
    const res = await fetch(`${API_BASE_URL}/api/transfer/packages`, { headers });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Package list failed ${res.status}`);
    const latest = Array.isArray(payload.data) ? payload.data[0] : null;
    if (!latest?.fileName) throw new Error("No transfer package available. Create package first.");
    return latest.fileName;
  }

  async function downloadLatestDirect(button) {
    try {
      if (button) button.disabled = true;
      setTransferStatus("Preparing direct ZIP download...");
      const fileName = await latestPackageName();
      const params = new URLSearchParams();
      const t = token();
      if (t) params.set("adminToken", t);
      const url = `${API_BASE_URL}/api/transfer/package/download/${encodeURIComponent(fileName)}${params.toString() ? `?${params}` : ""}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTransferStatus("Download requested. Browser should keep only the final ZIP file after completion.", "success");
    } catch (err) {
      console.error(err);
      setTransferStatus("Download failed: " + (err.message || err), "error");
      alert("Download failed:\n\n" + (err.message || err));
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function stopNodeBestEffort() {
    const ok = confirm("Stop Node server now?\n\nThis will disconnect this browser/app because Node serves SP WorkTrack. Restart it from terminal, Task Scheduler, or the runtime script.");
    if (!ok) return;

    const btn = $("dbRuntimeStopNodeBtn");
    if (btn) btn.disabled = true;
    setRuntimeStatus("Node stop command sent. If this page disconnects, that is expected.", "success");

    const headers = {};
    const t = token();
    if (t) headers["x-spwt-admin-token"] = t;

    try {
      await fetch(`${API_BASE_URL}/api/transfer/runtime/node/stop`, {
        method: "POST",
        headers,
        keepalive: true
      });
    } catch (err) {
      // Expected in many browsers because the request itself stops the server that is answering it.
      console.warn("Node stop request disconnected as expected:", err);
    }

    setTimeout(() => {
      setRuntimeStatus("Node server is stopping/stopped. Restart from server terminal: npm run server", "success");
    }, 600);
  }

  function explainStopPocketBase() {
    const line = $("dbRuntimeStatusLine");
    if (!line) return;
    line.title = "After PocketBase stops, data/API features that need DB will fail until PocketBase is started again.";
  }

  function runPolish() {
    cleanOptionalCountRows();
    guardRuntimeButtons();
    explainStopPocketBase();
  }

  document.addEventListener("click", (event) => {
    const downloadBtn = event.target?.closest?.("#dbTransferDownloadBtn");
    if (downloadBtn) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      downloadLatestDirect(downloadBtn);
      return;
    }

    const stopNode = event.target?.closest?.("#dbRuntimeStopNodeBtn");
    if (stopNode) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      stopNodeBestEffort();
      return;
    }

    const guarded = event.target?.closest?.("#dbRuntimeStartPbBtn,#dbRuntimeStartNodeBtn");
    if (guarded && guarded.disabled) {
      event.preventDefault();
      event.stopPropagation();
      alert(guarded.title || "Create auto-start tasks first.");
      return;
    }

    setTimeout(runPolish, 300);
    setTimeout(runPolish, 1200);
  }, true);

  const observer = new MutationObserver(() => setTimeout(runPolish, 50));
  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    runPolish();
    setInterval(runPolish, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();