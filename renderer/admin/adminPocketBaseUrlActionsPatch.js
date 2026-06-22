// renderer/admin/adminPocketBaseUrlActionsPatch.js
// Adds a lightweight PocketBase Admin URL note in Admin -> System Settings.

(function () {
  function $(id) { return document.getElementById(id); }

  function ensurePocketBaseUrlNote() {
    const input = $("cfgPocketbaseUrl");
    if (!input || input.__spwtPbNoteReady) return;

    const field = input.closest(".field");
    if (!field) return;

    input.__spwtPbNoteReady = true;

    const note = document.createElement("div");
    note.className = "small-hint";
    note.style.cssText = "margin-top:8px;line-height:1.55;";
    note.innerHTML = `
      To open PocketBase Admin, copy the URL above and add <b>/_/</b> at the end.<br>
      Example: <b>http://127.0.0.1:8090/_/</b>. Paste it in browser address bar, not Google search.
    `;
    field.appendChild(note);
  }

  document.addEventListener("DOMContentLoaded", () => setInterval(ensurePocketBaseUrlNote, 800));
})();