// renderer/dashboard_v2/reworkOtherEmployeeNamePatch.js
// Adds employee name/code column to Machine Dashboard Rework / Other Description table.
(function () {
  const MACHINE_DETAIL_API = "/api/dashboard/machine-detail";
  let latestRows = [];

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function employeeText(row = {}) {
    const name = clean(row.empName || row.employeeName || row.emp_name || row.doneByName);
    const code = clean(row.empCode || row.employeeCode || row.emp_code || row.doneByCode);
    if (name && code) return `${name} (${code})`;
    return name || code || "-";
  }

  function ensureHeader() {
    const table = $("reworkOtherTableBody")?.closest("table");
    const headRow = table?.querySelector("thead tr");
    if (!headRow || headRow.querySelector(".rework-other-employee-head")) return;

    const typeHead = Array.from(headRow.children).find((th) => clean(th.textContent).toLowerCase() === "type");
    const th = document.createElement("th");
    th.className = "rework-other-employee-head";
    th.textContent = "Name";
    if (typeHead?.nextSibling) headRow.insertBefore(th, typeHead.nextSibling);
    else headRow.appendChild(th);
  }

  function patchRows() {
    ensureHeader();
    const body = $("reworkOtherTableBody");
    if (!body || body.__spwtReworkNamePatching) return;

    body.__spwtReworkNamePatching = true;
    try {
      const rows = Array.from(body.querySelectorAll("tr"));
      rows.forEach((tr, index) => {
        if (tr.querySelector(".rework-other-employee-cell")) return;

        const cells = Array.from(tr.children);
        if (!cells.length) return;

        if (cells.length === 1) {
          const colspan = Number(cells[0].getAttribute("colspan") || 0);
          if (colspan && colspan < 8) cells[0].setAttribute("colspan", "8");
          return;
        }

        const td = document.createElement("td");
        td.className = "rework-other-employee-cell";
        td.textContent = employeeText(latestRows[index] || {});
        tr.insertBefore(td, cells[2] || null);
      });
    } finally {
      body.__spwtReworkNamePatching = false;
    }
  }

  function patchFetch() {
    if (window.__spwtReworkOtherNameFetchPatched) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const response = await originalFetch(input, init);
      const url = typeof input === "string" ? input : clean(input?.url);
      if (url.includes(MACHINE_DETAIL_API)) {
        response.clone().json().then((payload) => {
          latestRows = Array.isArray(payload?.data?.reworkOtherDetails) ? payload.data.reworkOtherDetails : [];
          requestAnimationFrame(patchRows);
        }).catch(() => { latestRows = []; });
      }
      return response;
    };
    window.__spwtReworkOtherNameFetchPatched = true;
  }

  function observeRows() {
    const body = $("reworkOtherTableBody");
    if (!body || body.__spwtReworkOtherNameObserved) return;
    body.__spwtReworkOtherNameObserved = true;
    new MutationObserver(() => requestAnimationFrame(patchRows)).observe(body, { childList: true });
  }

  function wire() {
    patchFetch();
    ensureHeader();
    observeRows();
    patchRows();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();
