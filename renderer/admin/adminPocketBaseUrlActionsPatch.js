// renderer/admin/adminPocketBaseUrlActionsPatch.js
// Adds a lightweight PocketBase URL help note in Admin -> System Settings.

(function () {
  const ADMIN_PATH = "/_/";

  function $(id) { return document.getElementById(id); }

  function cleanBaseUrl(value) {
    const text = String(value || "").trim();
    return text ? text.replace(/\/+$/, "") : "";
  }

  function getPocketBaseBaseUrl() {
    return cleanBaseUrl($("cfgPocketbaseUrl")?.value || "http://127.0.0.1:8090");
  }

  function getPocketBaseAdminUrl() {
    const base = getPocketBaseBaseUrl();
    return base ? `${base}${ADMIN_PATH}` : "";
  }

  function showHelp() {
    const base = getPocketBaseBaseUrl() || "http://127.0.0.1:8090";
    const adminUrl = `${base}${ADMIN_PATH}`;
    alert([
      "PocketBase / Database Runtime Help",
      "",
      "1. Keep PocketBase URL as:",
      base,
      "",
      "2. To open PocketBase Admin:",
      adminUrl,
      "",
      "How to use it:",
      "- Copy the PocketBase URL from the field.",
      "- Add /_/ at the end.",
      "- Paste the final URL in the browser address bar, not Google search.",
      "",
      "Example:",
      "http://127.0.0.1:8090/_/",
      "",
      "Important:",
      "- 127.0.0.1 works only on the same PC where PocketBase is running.",
      "- Normal users should open SP WorkTrack app URL, not PocketBase Admin.",
      "- PocketBase superuser email/password is only for backend database access. Keep it private."
    ].join("\n"));
  }

  function ensurePocketBaseUrlHelp() {
    const input = $("cfgPocketbaseUrl");
    if (!input || input.__spwtPbHelpReady) return;

    const field = input.closest(".field");
    if (!field) return;

    input.__spwtPbHelpReady = true;

    const actions = document.createElement("div");
    actions.className = "row admin-controls-actions";
    actions.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:8px;";
    actions.innerHTML = `
      <button class="btn grey" id="pocketBaseUrlHelpBtn" type="button">Help</button>
      <div class="small-hint" style="width:100%;">
        To open PocketBase Admin, copy the URL above and add <b>/_/</b> at the end.
        Example: <b>http://127.0.0.1:8090/_/</b>. Paste it in browser address bar, not Google search.
      </div>
    `;
    field.appendChild(actions);

    $("pocketBaseUrlHelpBtn").onclick = showHelp;
  }

  document.addEventListener("DOMContentLoaded", () => setInterval(ensurePocketBaseUrlHelp, 800));
})();
