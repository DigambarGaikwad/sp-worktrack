// renderer/qualityReportRecipientsSaveBridgePatch.js
// Makes common Admin Save Changes also save the Report Emails tab when it is active.

(function () {
  function isReportEmailTabActive() {
    const tab = document.getElementById("tabQualityReportEmails");
    return Boolean(tab && !tab.classList.contains("hidden"));
  }

  function clickReportEmailSave() {
    const btn = document.getElementById("saveQualityReportRecipientsBtn");
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  document.addEventListener("click", (e) => {
    const target = e.target?.closest?.("button");
    if (!target || !isReportEmailTabActive()) return;

    const text = String(target.textContent || "").trim().toLowerCase();
    const id = String(target.id || "").toLowerCase();

    if (id === "savequalityreportrecipientsbtn") return;

    const isCommonSave =
      id === "saveadminbtn" ||
      id === "adminsavebtn" ||
      id === "saveMasterDataBtn".toLowerCase() ||
      text === "save changes" ||
      text === "save";

    if (!isCommonSave) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    if (!clickReportEmailSave()) {
      const status = document.getElementById("qualityReportRecipientsStatus");
      if (status) {
        status.textContent = "Report email save button not ready. Please use Save Recipients.";
        status.style.color = "#b91c1c";
      }
    }
  }, true);
})();
