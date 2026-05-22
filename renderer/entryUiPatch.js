// renderer/entryUiPatch.js
// Small safe UI patch loaded after app.js.
// Replaces inline-styled entry message popup with CSS-class based styling.

(function () {
  function normalizeType(type) {
    return ["success", "warn", "error"].includes(type) ? type : "error";
  }

  function showEntryMessageWithClasses(message, type = "error") {
    let box = document.getElementById("entryMessageBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "entryMessageBox";
      document.body.appendChild(box);
    }

    const normalizedType = normalizeType(type);
    box.textContent = message;
    box.className = `entry-message-box show ${normalizedType}`;

    clearTimeout(window.__spwtEntryMsgTimer);
    window.__spwtEntryMsgTimer = setTimeout(() => {
      box.classList.remove("show");
    }, 7000);
  }

  try {
    window.showEntryMessage = showEntryMessageWithClasses;
    // In normal browser scripts, this also updates the global function binding when available.
    // eslint-disable-next-line no-global-assign
    showEntryMessage = showEntryMessageWithClasses;
  } catch (err) {
    window.showEntryMessage = showEntryMessageWithClasses;
  }
})();
