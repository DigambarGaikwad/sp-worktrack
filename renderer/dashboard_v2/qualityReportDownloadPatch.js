// renderer/dashboard_v2/qualityReportDownloadPatch.js
// Deprecated: Download Report button removed. This file is intentionally no-op.

(function () {
  function removeDownloadButton() {
    document.getElementById("downloadQualityReportBtn")?.remove();
  }

  function init() {
    removeDownloadButton();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(init, 100));
  document.addEventListener("click", () => setTimeout(init, 50), true);
})();
