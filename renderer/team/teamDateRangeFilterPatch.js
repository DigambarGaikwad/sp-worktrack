// renderer/team/teamDateRangeFilterPatch.js
// Adds From/To date controls to People Dashboard and forwards them to /api/dashboard/people.
(function () {
  const PEOPLE_API_MARKER = "/api/dashboard/people";
  const STYLE_ID = "peopleDateRangeFilterStyle";

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function addDays(date, days) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }
  function isPeopleApiUrl(input) { return typeof input === "string" && input.includes(PEOPLE_API_MARKER); }

  function defaultRange() {
    const today = new Date();
    return { from: isoDate(addDays(today, -6)), to: isoDate(today) };
  }

  function ensureStyles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .people-date-range-input { display:none; min-width:160px; }
      .people-date-range-input.show { display:block; }
      @media (max-width: 1100px) { .people-date-range-input { min-width:140px; } }
    `;
    document.head.appendChild(style);
  }

  function ensureControls() {
    const period = $("periodFilter");
    const month = $("monthFilter");
    if (!period || !month) return;

    if (!Array.from(period.options).some((o) => o.value === "dateRange")) {
      period.insertAdjacentHTML("beforeend", `<option value="dateRange">Date Range</option>`);
    }

    const def = defaultRange();
    if (!$("peopleFromDate")) {
      const input = document.createElement("input");
      input.id = "peopleFromDate";
      input.type = "date";
      input.className = "people-select people-date-range-input";
      input.value = def.from;
      input.title = "From date";
      month.insertAdjacentElement("afterend", input);
    }
    if (!$("peopleToDate")) {
      const input = document.createElement("input");
      input.id = "peopleToDate";
      input.type = "date";
      input.className = "people-select people-date-range-input";
      input.value = def.to;
      input.title = "To date";
      $("peopleFromDate")?.insertAdjacentElement("afterend", input);
    }
  }

  function applyVisibility() {
    const isRange = ($("periodFilter")?.value || "") === "dateRange";
    [$("peopleFromDate"), $("peopleToDate")].forEach((el) => {
      if (!el) return;
      el.classList.toggle("show", isRange);
      el.disabled = !isRange;
    });
  }

  function reloadDashboard() { $("refreshPeopleBtn")?.click(); }

  function setDateRangeModeAndReload() {
    const period = $("periodFilter");
    if (period && period.value !== "dateRange") period.value = "dateRange";
    applyVisibility();
    reloadDashboard();
  }

  function normalizeRangeInputs() {
    const from = $("peopleFromDate");
    const to = $("peopleToDate");
    const def = defaultRange();
    if (from && !from.value) from.value = def.from;
    if (to && !to.value) to.value = def.to;
    if (from && to && from.value && to.value && from.value > to.value) {
      const oldFrom = from.value;
      from.value = to.value;
      to.value = oldFrom;
    }
  }

  function addRangeToUrl(input) {
    if (!isPeopleApiUrl(input)) return input;
    const url = new URL(input, window.location.origin);
    const period = $("periodFilter")?.value || url.searchParams.get("period") || "yesterday";
    if (period !== "dateRange") return input;

    normalizeRangeInputs();
    url.searchParams.set("period", "dateRange");
    url.searchParams.set("fromDate", clean($("peopleFromDate")?.value));
    url.searchParams.set("toDate", clean($("peopleToDate")?.value));
    url.searchParams.delete("month");
    return url.href;
  }

  function patchFetch() {
    if (window.__spwtPeopleDateRangeFetchPatched) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return originalFetch(addRangeToUrl(input), init);
    };
    window.__spwtPeopleDateRangeFetchPatched = true;
  }

  function wire() {
    ensureStyles();
    ensureControls();
    patchFetch();
    applyVisibility();

    $("periodFilter")?.addEventListener("change", applyVisibility);
    [$("peopleFromDate"), $("peopleToDate")].forEach((el) => {
      if (!el || el.__spwtDateRangeWired) return;
      el.__spwtDateRangeWired = true;
      el.addEventListener("change", setDateRangeModeAndReload);
    });
  }

  document.addEventListener("DOMContentLoaded", wire);
})();
