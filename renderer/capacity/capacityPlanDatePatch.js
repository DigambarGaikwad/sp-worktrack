// renderer/capacity/capacityPlanDatePatch.js
// Adds the plan date in each employee card header for screen, print and email output.
(function () {
  const clean = (v) => String(v ?? "").trim();

  function dateFromCard(card) {
    const text = clean(card.querySelector(".date-title")?.textContent || card.getAttribute("data-date") || "");
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (iso) return iso.split("-").reverse().join("/");
    const dmy = text.match(/\b\d{2}[\/-]\d{2}[\/-]\d{4}\b/)?.[0];
    return dmy ? dmy.replaceAll("-", "/") : text;
  }

  function applyPlanDates(root = document) {
    root.querySelectorAll?.(".date-plan-card").forEach((card) => {
      const date = dateFromCard(card);
      if (!date) return;
      card.querySelectorAll(".employee-card").forEach((empCard) => {
        const head = empCard.querySelector(".employee-head");
        if (!head) return;
        if (!head.querySelector(".employee-day-date")) {
          const pill = document.createElement("div");
          pill.className = "employee-day-date";
          pill.textContent = date;
          head.appendChild(pill);
        } else {
          head.querySelector(".employee-day-date").textContent = date;
        }
        const name = head.querySelector(".employee-name");
        if (name && !name.querySelector(".plan-date-pill")) {
          const inline = document.createElement("span");
          inline.className = "plan-date-pill";
          inline.textContent = date;
          name.appendChild(inline);
        } else if (name?.querySelector(".plan-date-pill")) {
          name.querySelector(".plan-date-pill").textContent = date;
        }
      });
    });
  }

  function ensureStyles() {
    if (document.getElementById("capacityPlanDatePatchStyle")) return;
    const style = document.createElement("style");
    style.id = "capacityPlanDatePatchStyle";
    style.textContent = `
      .employee-head { align-items:center; }
      .employee-day-date { color:#0b3f73; font-weight:1000; white-space:nowrap; background:#eaf2ff; border:1px solid #cfe0f5; border-radius:999px; padding:6px 10px; }
      .plan-date-pill { display:inline-block; margin-left:8px; padding:4px 8px; border-radius:999px; background:#eaf2ff; color:#0b3f73; font-size:12px; font-weight:1000; vertical-align:middle; }
    `;
    document.head.appendChild(style);
  }

  function wire() {
    ensureStyles();
    applyPlanDates();
    const host = document.getElementById("employeePlanHost") || document.body;
    new MutationObserver(() => applyPlanDates()).observe(host, { childList: true, subtree: true });
  }

  window.SPWT_CAPACITY_APPLY_PLAN_DATES = applyPlanDates;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();