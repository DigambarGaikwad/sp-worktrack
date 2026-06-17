// renderer/team/teamLossHoursReportPatch.js
(function () {
  function markLossCard() {
    document.querySelectorAll(".kpi-card").forEach((card) => {
      const label = String(card.querySelector(".kpi-label")?.textContent || "").trim().toLowerCase();
      if (label !== "loss hours" || card.__spwtLossReportWired) return;
      card.__spwtLossReportWired = true;
      card.classList.add("loss-hours-kpi-clickable", "attendance-kpi-clickable");
      card.title = "Click to view detailed loss hours report";
      card.addEventListener("click", function () {
        alert("Loss hours report is being prepared.");
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markLossCard);
  else markLossCard();
  setInterval(markLossCard, 1200);
})();
