// renderer/team/teamYearMonthFilterPatch.js
// Adds year/month query support to People Dashboard without rewriting team.js.

(function () {
  const PEOPLE_API_MARKER = "/api/dashboard/people";
  const MONTHS = [
    [1, "January"], [2, "February"], [3, "March"], [4, "April"],
    [5, "May"], [6, "June"], [7, "July"], [8, "August"],
    [9, "September"], [10, "October"], [11, "November"], [12, "December"]
  ];

  const originalFetch = window.fetch.bind(window);

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value ?? "").trim(); }
  function currentYear() { return String(new Date().getFullYear()); }
  function currentMonth() { return String(new Date().getMonth() + 1); }

  function isPeopleApiUrl(input) {
    return typeof input === "string" && input.includes(PEOPLE_API_MARKER);
  }

  function withYearMonth(input) {
    if (!isPeopleApiUrl(input)) return input;

    const url = new URL(input, window.location.origin);
    const period = $("periodFilter")?.value || "yesterday";
    const year = clean($("yearFilter")?.value) || currentYear();
    const month = clean($("monthFilter")?.value) || currentMonth();

    url.searchParams.set("period", period);
    url.searchParams.set("year", year);
    if (period !== "selectedYear") url.searchParams.set("month", month);
    else url.searchParams.delete("month");

    return url.href;
  }

  window.fetch = async function (input, init) {
    const finalInput = withYearMonth(input);
    const response = await originalFetch(finalInput, init);

    if (isPeopleApiUrl(finalInput)) {
      response.clone().json().then((payload) => {
        if (payload?.ok && payload?.data) populateDateFilters(payload.data);
      }).catch(() => {});
    }

    return response;
  };

  function populateDateFilters(data) {
    populateYears(data?.filterOptions?.years || []);
    populateMonths(data?.filterOptions?.months || []);
    applyMonthVisibility();
  }

  function populateYears(years) {
    const select = $("yearFilter");
    if (!select) return;

    const current = clean(select.value) || currentYear();
    const list = Array.from(new Set([currentYear(), ...years.map(String).filter(Boolean)]))
      .sort((a, b) => Number(b) - Number(a));

    select.innerHTML = list.map((year) => `<option value="${escapeHtml(year)}">Year: ${escapeHtml(year)}</option>`).join("");
    select.value = list.includes(current) ? current : list[0] || currentYear();
  }

  function populateMonths(months) {
    const select = $("monthFilter");
    if (!select) return;

    const current = clean(select.value) || currentMonth();
    const list = Array.isArray(months) && months.length
      ? months.map((m) => [Number(m.value || m[0]), clean(m.label || m[1])]).filter((x) => x[0] >= 1 && x[0] <= 12)
      : MONTHS;

    select.innerHTML = list.map(([value, label]) => `<option value="${value}">Month: ${escapeHtml(label)}</option>`).join("");
    select.value = list.some(([value]) => String(value) === current) ? current : currentMonth();
  }

  function applyMonthVisibility() {
    const period = $("periodFilter")?.value || "yesterday";
    const month = $("monthFilter");
    if (!month) return;
    month.disabled = period === "selectedYear";
    month.title = period === "selectedYear" ? "Month not required for yearly view" : "Select month";
  }

  function reloadDashboard() {
    const btn = $("refreshPeopleBtn");
    if (btn) btn.click();
  }

  function setSelectedMonthOnMonthChange() {
    const period = $("periodFilter");
    if (period && period.value !== "selectedMonth") period.value = "selectedMonth";
  }

  function wire() {
    populateYears([]);
    populateMonths([]);
    applyMonthVisibility();

    if (!document.__spwtPeopleYearMonthWired) {
      document.__spwtPeopleYearMonthWired = true;

      $("yearFilter")?.addEventListener("change", reloadDashboard);
      $("monthFilter")?.addEventListener("change", function () {
        setSelectedMonthOnMonthChange();
        reloadDashboard();
      });
      $("periodFilter")?.addEventListener("change", function () {
        applyMonthVisibility();
      });
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  document.addEventListener("DOMContentLoaded", wire);
})();
