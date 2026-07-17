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

// Mobile Admin tab menu. Keeps desktop tabs unchanged and uses existing tab click logic.
(function () {
  const STYLE_ID = "adminMobileTabsMenuStyle";
  const MENU_ID = "adminMobileTabsMenu";
  const LIST_ID = "adminMobileTabsList";

  document.addEventListener("DOMContentLoaded", () => {
    initMobileTabsMenu();
    [400, 900, 1800, 3500].forEach((ms) => setTimeout(initMobileTabsMenu, ms));
  });

  document.addEventListener("click", (event) => {
    const menu = document.getElementById(MENU_ID);
    const list = document.getElementById(LIST_ID);
    if (!menu || !list || menu.contains(event.target)) return;
    closeMenu();
  }, true);

  function initMobileTabsMenu() {
    ensureViewportMeta();
    addStyles();
    ensureMenu();
    renderMenuItems();
    wireObservers();
    updateCurrentTabLabel();
  }

  function ensureViewportMeta() {
    if (document.querySelector('meta[name="viewport"]')) return;
    const meta = document.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1.0";
    document.head.appendChild(meta);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .admin-mobile-tabs-menu{display:none;}
      @media(max-width:700px){
        .admin-page{width:100%!important;max-width:100%!important;padding:8px!important;box-sizing:border-box!important;overflow-x:hidden!important;}
        .admin-page-card{width:100%!important;max-width:100%!important;margin:0!important;box-sizing:border-box!important;overflow:hidden!important;}
        .admin-page-head h1{font-size:30px!important;line-height:1.05!important;margin:0 0 8px!important;}
        #adminPanel>.tabs{display:none!important;}
        .admin-mobile-tabs-menu{display:block;margin:0 0 12px;position:relative;z-index:90;}
        .admin-mobile-tabs-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:1px solid #dbe3ee;border-radius:16px;background:#fff;padding:8px;box-shadow:0 8px 18px rgba(15,23,42,.08);}
        .admin-mobile-tabs-btn{border:0;border-radius:12px;background:#0f172a;color:#fff;min-height:42px;padding:0 14px;font-weight:1000;font-size:14px;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;box-shadow:0 8px 18px rgba(15,23,42,.14);}
        .admin-mobile-tabs-current{min-width:0;flex:1;text-align:right;color:#475569;font-size:12px;font-weight:900;line-height:1.2;}
        .admin-mobile-tabs-current b{display:block;color:#0f172a;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .admin-mobile-tabs-list{display:none;margin-top:8px;border:1px solid #dbe3ee;border-radius:16px;background:#fff;padding:8px;box-shadow:0 18px 35px rgba(15,23,42,.18);max-height:62vh;overflow:auto;}
        .admin-mobile-tabs-menu.open .admin-mobile-tabs-list{display:grid;grid-template-columns:1fr;gap:7px;}
        .admin-mobile-tab-item{width:100%;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;color:#0f172a;text-align:left;min-height:42px;padding:9px 12px;font-weight:950;font-size:13px;}
        .admin-mobile-tab-item.active{background:#0f172a;color:#fff;border-color:#0f172a;}
        .admin-mobile-tab-item:active{transform:scale(.99);}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureMenu() {
    const panel = document.getElementById("adminPanel");
    const tabs = panel?.querySelector(":scope > .tabs");
    if (!panel || !tabs) return;

    let menu = document.getElementById(MENU_ID);
    if (!menu) {
      menu = document.createElement("div");
      menu.id = MENU_ID;
      menu.className = "admin-mobile-tabs-menu";
      menu.innerHTML = `
        <div class="admin-mobile-tabs-bar">
          <button id="adminMobileTabsToggle" class="admin-mobile-tabs-btn" type="button" aria-expanded="false">☰ Admin Menu</button>
          <div class="admin-mobile-tabs-current">Current Tab <b id="adminMobileTabsCurrent">Machines</b></div>
        </div>
        <div id="adminMobileTabsList" class="admin-mobile-tabs-list"></div>
      `;
      tabs.insertAdjacentElement("beforebegin", menu);
    }

    const toggle = document.getElementById("adminMobileTabsToggle");
    if (toggle && !toggle.__spwtAdminMobileMenuWired) {
      toggle.__spwtAdminMobileMenuWired = true;
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = menu.classList.toggle("open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (isOpen) renderMenuItems();
      });
    }
  }

  function visibleTabs() {
    const tabs = Array.from(document.querySelectorAll("#adminPanel > .tabs .tab[data-tab]"));
    return tabs.filter((tab) => {
      if (tab.disabled) return false;
      if (tab.style.display === "none") return false;
      if (tab.hidden || tab.classList.contains("hidden")) return false;
      return true;
    });
  }

  function renderMenuItems() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    const activeId = document.querySelector("#adminPanel > .tabs .tab.active[data-tab]")?.dataset?.tab || "";
    const items = visibleTabs();
    list.innerHTML = items.map((tab) => {
      const tabId = tab.dataset.tab || "";
      const label = (tab.textContent || tabId).trim();
      const active = tabId === activeId ? " active" : "";
      return `<button type="button" class="admin-mobile-tab-item${active}" data-mobile-tab="${escapeAttr(tabId)}">${escapeHtml(label)}</button>`;
    }).join("");

    list.querySelectorAll("[data-mobile-tab]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const tabId = btn.getAttribute("data-mobile-tab") || "";
        const realTab = document.querySelector(`#adminPanel > .tabs .tab[data-tab="${cssEscape(tabId)}"]`);
        closeMenu();
        if (realTab && realTab.style.display !== "none") realTab.click();
        setTimeout(() => { updateCurrentTabLabel(); renderMenuItems(); }, 120);
      });
    });
  }

  function updateCurrentTabLabel() {
    const out = document.getElementById("adminMobileTabsCurrent");
    if (!out) return;
    const active = document.querySelector("#adminPanel > .tabs .tab.active[data-tab]") || visibleTabs()[0];
    out.textContent = (active?.textContent || "Admin").trim();
  }

  function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    const toggle = document.getElementById("adminMobileTabsToggle");
    if (menu) menu.classList.remove("open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function wireObservers() {
    const panel = document.getElementById("adminPanel");
    const tabs = panel?.querySelector(":scope > .tabs");
    if (!tabs || tabs.__spwtMobileTabsObserved) return;
    tabs.__spwtMobileTabsObserved = true;
    const observer = new MutationObserver(() => {
      renderMenuItems();
      updateCurrentTabLabel();
    });
    observer.observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });

    document.addEventListener("click", (event) => {
      if (event.target?.closest?.("#adminPanel > .tabs .tab[data-tab]")) {
        setTimeout(() => { renderMenuItems(); updateCurrentTabLabel(); }, 120);
      }
    }, true);

    setInterval(() => {
      renderMenuItems();
      updateCurrentTabLabel();
    }, 1800);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/(["\\#.;:[\]()= ])/g, "\\$1");
  }
})();
