// Admin full page bridge
// This file allows the existing Home Admin logic in renderer/app.js
// to work from renderer/admin/admin.html.

(function () {
  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    if (typeof input === "string") {
      // renderer/app.js uses data/... paths because it originally runs from index.html.
      // Admin page is inside renderer/admin, so redirect only those local JSON paths.
      if (input.startsWith("data/")) {
        return originalFetch("../../" + input, init);
      }
    }

    return originalFetch(input, init);
  };

  // For Admin full page, Cancel/Close should go Home instead of trying to close old modal.
  window.SPWT_ADMIN_FULL_PAGE = true;
})();