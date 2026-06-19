// renderer/admin/adminDatabaseTransferSafetyPatch.js
// Safety polish for Database Transfer tab: hide unused optional count rows and guard start buttons until tasks exist.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

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

  function runPolish() {
    cleanOptionalCountRows();
    guardRuntimeButtons();
  }

  document.addEventListener("click", (event) => {
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
