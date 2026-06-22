// renderer/admin/adminPocketBaseUrlActionsPatch.js
// Adds copy/open/help actions for PocketBase URL in Admin -> System Settings.

(function () {
  const ADMIN_PATH = "/_/";

  function $(id) { return document.getElementById(id); }

  function cleanBaseUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.replace(/\/+$/, "");
  }

  function getPocketBaseBaseUrl() {
    return cleanBaseUrl($("cfgPocketbaseUrl")?.value || "http://127.0.0.1:8090");
  }

  function getPocketBaseAdminUrl() {
    const base = getPocketBaseBaseUrl();
    return base ? `${base}${ADMIN_PATH}` : "";
  }

  async function copyText(label, text) {
    if (!text) return alert(`No ${label} found. Load System Settings first.`);
    try {
      await navigator.clipboard.writeText(text);
      showStatus(`${label} copied.`);
    } catch {
      window.prompt(`Copy ${label}:`, text);
    }
  }

  function showStatus(message) {
    const el = $("systemConfigStatus");
    if (el) {
      el.textContent = message;
      el.style.fontWeight = "900";
      el.style.color = "#15803d";
    }
  }

  function openUrl(url) {
    if (!url) return alert("PocketBase URL is blank. Load or enter PocketBase URL first.");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function showHelp() {
    const base = getPocketBaseBaseUrl() || "http://127.0.0.1:8090";
    const adminUrl = `${base}${ADMIN_PATH}`;
    alert([
      "PocketBase URL Help",
      "",
      "1. Database/API URL:",
      base,
      "",
      "2. PocketBase Admin URL:",
      adminUrl,
      "",
      "How to open:",
      "- Copy the Admin URL.",
      "- Paste it in the browser address bar, not Google search.",
      "- Press Enter.",
      "",
      "If it does not open:",
      "- PocketBase must be running on this server PC.",
      "- 127.0.0.1 works only on the same PC where PocketBase is running.",
      "- For another PC/mobile, use the server LAN/Tailscale URL only if PocketBase is intentionally exposed. Normal SP WorkTrack users should open the Node app URL, not PocketBase."
    ].join("\n"));
  }

  function ensurePocketBaseUrlActions() {
    const input = $("cfgPocketbaseUrl");
    if (!input || input.__spwtPbActionsReady) return;

    const field = input.closest(".field");
    if (!field) return;

    input.__spwtPbActionsReady = true;

    const actions = document.createElement("div");
    actions.className = "row admin-controls-actions";
    actions.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:8px;";
    actions.innerHTML = `
      <button class="btn grey" id="copyPocketBaseUrlBtn" type="button">Copy API URL</button>
      <button class="btn grey" id="copyPocketBaseAdminUrlBtn" type="button">Copy Admin URL</button>
      <button class="btn grey" id="openPocketBaseAdminBtn" type="button">Open Admin</button>
      <button class="btn grey" id="pocketBaseUrlHelpBtn" type="button">Help</button>
      <div class="small-hint" style="width:100%;">Admin URL opens PocketBase dashboard: <b>http://127.0.0.1:8090/_/</b>. Paste in browser address bar, not search.</div>
    `;
    field.appendChild(actions);

    $("copyPocketBaseUrlBtn").onclick = () => copyText("PocketBase API URL", getPocketBaseBaseUrl());
    $("copyPocketBaseAdminUrlBtn").onclick = () => copyText("PocketBase Admin URL", getPocketBaseAdminUrl());
    $("openPocketBaseAdminBtn").onclick = () => openUrl(getPocketBaseAdminUrl());
    $("pocketBaseUrlHelpBtn").onclick = showHelp;
  }

  document.addEventListener("DOMContentLoaded", () => setInterval(ensurePocketBaseUrlActions, 800));
})();
