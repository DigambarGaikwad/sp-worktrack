// renderer/capacity/capacityV5.js
// Small capacity overlay: Completed Qty in monthly target comes from Admin -> Machines -> Status.
(function () {
  const API = window.SPWT_CONFIG?.API_BASE_URL || window.location.origin || "http://localhost:3032";
  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v ?? "").trim();
  const norm = (v) => clean(v).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

  let completedByType = new Map();
  let loaded = false;

  function isCompletedStatus(value) {
    const s = norm(value);
    return s === "completed" || s === "complete" || s === "done" || s === "finished" || s === "closed";
  }

  async function loadMachineStatusSummary() {
    const res = await fetch(`${API}/api/admin/master-data`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.message || "Failed to load machine status.");

    const master = body.data || {};
    const typeById = new Map((master.machineTypes || []).map((t) => [norm(t.id), clean(t.name)]));
    const map = new Map();

    (master.machines || []).forEach((m) => {
      if (!isCompletedStatus(m.status)) return;
      const typeId = clean(m.type || m.machine_type_code || m.machineType || m.machine_type_name);
      const typeName = clean(typeById.get(norm(typeId)) || m.typeName || m.machine_type_name || typeId);
      const keys = [typeId, typeName].map(norm).filter(Boolean);
      keys.forEach((k) => map.set(k, (map.get(k) || 0) + 1));
    });

    completedByType = map;
    loaded = true;
    applyCompletedQtyFromMachineStatus();
  }

  function completedCountForType(typeText) {
    return completedByType.get(norm(typeText)) || 0;
  }

  function applyCompletedQtyFromMachineStatus() {
    const host = $("targetTable");
    if (!host || !loaded) return;
    const table = host.querySelector("table");
    if (!table) return;

    const headers = [...table.querySelectorAll("thead th")].map((th) => norm(th.textContent));
    const typeIndex = headers.findIndex((h) => h === "machinetype");
    const completedIndex = headers.findIndex((h) => h === "completedqty");
    if (typeIndex < 0 || completedIndex < 0) return;

    table.querySelectorAll("tbody tr").forEach((row) => {
      const cells = row.querySelectorAll("td");
      const typeText = cells[typeIndex]?.textContent || "";
      const completedCell = cells[completedIndex];
      if (!completedCell) return;
      const count = completedCountForType(typeText);
      completedCell.textContent = String(count);
      completedCell.title = "Completed Qty from Admin → Machines → Status = Completed";
    });
  }

  function observeTargetTable() {
    const host = $("targetTable");
    if (!host || host.__spwtCompletedQtyObserver) return;
    const observer = new MutationObserver(() => applyCompletedQtyFromMachineStatus());
    observer.observe(host, { childList: true, subtree: true });
    host.__spwtCompletedQtyObserver = observer;
  }

  function init() {
    observeTargetTable();
    loadMachineStatusSummary().catch((err) => console.warn("Capacity completed qty status summary failed:", err));
    $("refreshBtn")?.addEventListener("click", () => setTimeout(() => loadMachineStatusSummary().catch(() => {}), 700));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
