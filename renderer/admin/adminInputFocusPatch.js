// renderer/admin/adminInputFocusPatch.js
// Keeps Admin form inputs responsive after dynamic renders/add actions.
// Fixes slow/click-twice focus behaviour in Electron/browser admin screens.
(function () {
  const INPUT_SELECTOR = "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])";
  const ADMIN_INPUT_SELECTOR = `#adminPanel ${INPUT_SELECTOR}`;
  const RENDER_FNS = [
    "renderAdminMachines",
    "renderAdminEmployees",
    "renderAdminShifts",
    "renderAdminLossReasons",
    "renderAdminRootAreas",
    "renderAdminWorkSub"
  ];

  let lastUserFocusAt = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    wireDirectInputFocus();
    wireAddButtonFocus();
    wrapRenderersWithFocusRestore();
    [250, 750, 1500, 3000].forEach((ms) => setTimeout(wrapRenderersWithFocusRestore, ms));
  }

  function isAdminInput(el) {
    return !!el?.matches?.(ADMIN_INPUT_SELECTOR);
  }

  function wireDirectInputFocus() {
    document.addEventListener("pointerdown", (event) => {
      const target = event.target?.closest?.(ADMIN_INPUT_SELECTOR);
      if (!target) return;
      lastUserFocusAt = Date.now();
      queueFocus(target, false);
    }, true);

    document.addEventListener("focusin", (event) => {
      if (isAdminInput(event.target)) lastUserFocusAt = Date.now();
    }, true);
  }

  function wireAddButtonFocus() {
    document.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("button");
      if (!btn) return;

      const selector = getPostActionFocusSelector(btn);
      if (!selector) return;

      // Rendering can take a little longer inside packaged Electron; retry focus safely.
      [80, 180, 350, 700].forEach((ms) => {
        setTimeout(() => focusLast(selector), ms);
      });
    }, true);
  }

  function getPostActionFocusSelector(btn) {
    const id = btn.id || "";
    if (id === "addMachineBtn") return "#machinesList input.admin-input";
    if (id === "addEmployeeBtn") return "#employeesList input.admin-input";
    if (id === "addShiftBtn") return "#shiftsList input.admin-input";
    if (id === "addTypeBtn") return "#typeList input.admin-input";
    if (id === "addMainWorkBtn") return "#mainWorkList input.admin-input, #mainWorkList input";
    if (id === "addSubWorkBtn") return "#subWorkList [data-tsw-idx][data-field='name'], #subWorkList input.admin-input";
    if (id === "addLossReasonBtn") return "#lossReasonsList [data-loss-idx]";
    if (id === "addRootAreaBtn") return "#rootAreasList [data-root-idx]";
    if (btn.matches?.("[data-add-booking]")) return "#subWorkList [data-bp-name]";
    if (btn.matches?.("[data-add-quality]")) return "#subWorkList [data-qp-name]";
    return "";
  }

  function focusLast(selector) {
    const items = Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    const target = items[items.length - 1];
    if (target) queueFocus(target, true);
  }

  function queueFocus(el, shouldSelect) {
    if (!el || el.disabled) return;
    requestAnimationFrame(() => {
      try {
        el.focus({ preventScroll: true });
        if (shouldSelect && typeof el.select === "function" && el.tagName !== "SELECT") el.select();
      } catch (_) {
        try { el.focus(); } catch (_) { /* ignore */ }
      }
    });
  }

  function wrapRenderersWithFocusRestore() {
    RENDER_FNS.forEach((name) => {
      const fn = getAppFn(name);
      if (!fn || fn.__spwtFocusWrapped) return;

      const wrapped = function (...args) {
        const snap = captureFocus();
        const result = fn.apply(this, args);
        // Restore only for normal renders while editing, not long after user left field.
        if (snap && Date.now() - lastUserFocusAt < 1500) {
          setTimeout(() => restoreFocus(snap), 0);
          setTimeout(() => restoreFocus(snap), 80);
        }
        return result;
      };
      wrapped.__spwtFocusWrapped = true;
      setAppVar(name, wrapped);
    });
  }

  function captureFocus() {
    const el = document.activeElement;
    if (!isAdminInput(el)) return null;

    const selector = uniqueSelector(el);
    if (!selector) return null;

    const snap = {
      selector,
      value: "value" in el ? el.value : "",
      start: null,
      end: null
    };

    try {
      if (typeof el.selectionStart === "number") {
        snap.start = el.selectionStart;
        snap.end = el.selectionEnd;
      }
    } catch (_) { /* ignore */ }

    return snap;
  }

  function restoreFocus(snap) {
    if (!snap?.selector) return;
    const el = document.querySelector(snap.selector);
    if (!el || el.disabled || el.offsetParent === null) return;

    queueFocus(el, false);
    requestAnimationFrame(() => {
      try {
        if (snap.start != null && typeof el.setSelectionRange === "function") {
          const len = String(el.value || "").length;
          el.setSelectionRange(Math.min(snap.start, len), Math.min(snap.end ?? snap.start, len));
        }
      } catch (_) { /* ignore */ }
    });
  }

  function uniqueSelector(el) {
    if (el.id) return `#${cssEscape(el.id)}`;

    const attrs = [
      "data-m-idx", "data-e-idx", "data-sh-idx", "data-loss-idx", "data-root-idx",
      "data-ty-idx", "data-tmw-idx", "data-tsw-idx", "data-bp-name", "data-bp-time",
      "data-qp-name", "data-qp-type", "data-qp-mandatory", "data-field"
    ];

    const parts = attrs
      .filter((attr) => el.hasAttribute?.(attr))
      .map((attr) => `[${attr}="${cssEscape(el.getAttribute(attr) || "")}"]`);

    if (!parts.length) return "";
    const scope = el.closest(".tab-page")?.id ? `#${cssEscape(el.closest(".tab-page").id)} ` : "";
    return `${scope}${el.tagName.toLowerCase()}${parts.join("")}`;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/(["\\#.;:[\]()= ])/g, "\\$1");
  }

  function getAppFn(name) {
    try {
      // app.js functions are top-level bindings, not always window properties.
      // eslint-disable-next-line no-eval
      const fn = eval(name);
      return typeof fn === "function" ? fn : null;
    } catch (_) {
      return null;
    }
  }

  function setAppVar(name, value) {
    try {
      window.__spwtFocusPatchValue = value;
      // eslint-disable-next-line no-new-func
      Function(`${name} = window.__spwtFocusPatchValue`)();
    } catch (err) {
      console.warn(`Could not patch ${name} for focus stability`, err);
    } finally {
      delete window.__spwtFocusPatchValue;
    }
  }
})();
