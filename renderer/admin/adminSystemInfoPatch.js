// renderer/admin/adminSystemInfoPatch.js
// Adds Admin -> System Info with detected LAN/Tailscale URLs and non-sensitive server details.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";
  const REQUEST_TIMEOUT_MS = 12000;

  let lastInfo = null;
  let loading = false;

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
  function hasPermission(permission) {
    const user = window.SPWT_ADMIN_ACCESS?.getUser?.() || null;
    if (!user) return true;
    return window.SPWT_ADMIN_ACCESS?.hasPermission?.(permission) === true;
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { ...(options.headers || {}) };
      const t = token();
      if (t) headers["x-spwt-admin-token"] = t;
      const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Request failed ${res.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function ensureTab() {
    const panel = $("adminPanel");
    const tabs = panel?.querySelector(".tabs");
    if (!panel || !tabs) return false;

    if (!tabs.querySelector('[data-tab="tabSystemInfo"]')) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.dataset.tab = "tabSystemInfo";
      btn.textContent = "System Info";
      const transferTab = tabs.querySelector('[data-tab="tabDatabaseTransfer"]');
      if (transferTab) transferTab.insertAdjacentElement("afterend", btn);
      else tabs.appendChild(btn);
    }

    if (!$("tabSystemInfo")) {
      const page = document.createElement("div");
      page.className = "tab-page hidden";
      page.id = "tabSystemInfo";
      page.innerHTML = `
        <div class="section-title">System Info</div>
        <div class="small-hint">Detected app addresses and non-sensitive server details. Configuration editing is kept separately in System Settings.</div>

        <div class="card admin-controls-card" style="margin-top:12px;">
          <div class="row admin-controls-actions" style="gap:10px;flex-wrap:wrap;">
            <button class="btn green" id="refreshSystemInfoBtn" type="button">Refresh Network Info</button>
            <button class="btn grey" id="copyCurrentUrlBtn" type="button">Copy Current URL</button>
            <button class="btn grey" id="copyLanUrlBtn" type="button">Copy Best LAN URL</button>
            <button class="btn grey" id="copyTailscaleUrlBtn" type="button">Copy Tailscale URL</button>
            <button class="btn grey" id="openCurrentUrlBtn" type="button">Open Current App</button>
            <span class="small-hint" id="systemInfoStatus"></span>
          </div>
        </div>

        <div id="systemInfoBody" style="margin-top:14px;"></div>
      `;
      const footer = panel.querySelector("hr") || panel.lastElementChild;
      if (footer) panel.insertBefore(page, footer);
      else panel.appendChild(page);
    }

    wireButtons();
    applyPermission();
    return true;
  }

  function status(message, type = "") {
    const el = $("systemInfoStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.fontWeight = "900";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
  }

  function firstUrl(list) {
    return Array.isArray(list) && list[0]?.url ? list[0].url : "";
  }

  async function copyText(text, label) {
    if (!text) return alert(`${label || "URL"} is not available yet. Click Refresh Network Info first.`);
    try {
      await navigator.clipboard.writeText(text);
      status(`${label || "URL"} copied.`, "success");
    } catch (err) {
      window.prompt(`Copy ${label || "URL"}:`, text);
    }
  }

  function row(label, value, note = "") {
    return `<tr><td style="font-weight:900;width:220px;">${esc(label)}</td><td><code>${esc(value || "-")}</code>${note ? `<div class="small-hint">${esc(note)}</div>` : ""}</td></tr>`;
  }

  function urlCard(title, value, note, copyId, openId) {
    return `
      <div class="mini-metric" style="min-height:112px;">
        <div class="mini-label">${esc(title)}</div>
        <div style="margin-top:8px;word-break:break-all;"><code>${esc(value || "Not detected")}</code></div>
        <div class="small-hint" style="margin-top:6px;">${esc(note || "")}</div>
        <div class="row" style="margin-top:10px;gap:8px;">
          <button class="btn grey" type="button" data-system-copy="${esc(copyId)}">Copy</button>
          <button class="btn grey" type="button" data-system-open="${esc(openId)}">Open</button>
        </div>
      </div>`;
  }

  function urlRows(list, typeLabel) {
    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) return `<tr><td colspan="5">No ${esc(typeLabel)} URL detected.</td></tr>`;
    return rows.map((x, idx) => `
      <tr>
        <td>${idx === 0 ? "Best" : idx + 1}</td>
        <td>${esc(x.name || typeLabel)}</td>
        <td><code>${esc(x.ip)}</code></td>
        <td><code>${esc(x.url)}</code><div class="small-hint">Health: ${esc(x.healthUrl || "")}</div></td>
        <td><button class="btn grey" type="button" data-copy-url="${esc(x.homeUrl || x.url)}">Copy App URL</button></td>
      </tr>`).join("");
  }

  function renderInfo(info) {
    const host = $("systemInfoBody");
    if (!host) return;
    const currentUrl = info.current?.browserUrl || window.location.href;
    const currentHome = info.current?.homeFromRequest || `${window.location.origin}/index.html`;
    const lanUrl = info.urls?.lan?.[0]?.homeUrl || firstUrl(info.urls?.lan);
    const tailscaleUrl = info.urls?.tailscale?.[0]?.homeUrl || firstUrl(info.urls?.tailscale);

    host.innerHTML = `
      <div class="emp-metrics" style="margin-bottom:14px;">
        ${urlCard("Current Browser URL", currentUrl, "The exact URL used to open this Admin screen.", "current", "current")}
        ${urlCard("App Home URL", currentHome, "Share this current-network home link if users are on the same path/network.", "home", "home")}
        ${urlCard("Best LAN URL", lanUrl, "Use this first for Android/other PCs on same WiFi/LAN.", "lan", "lan")}
        ${urlCard("Tailscale URL", tailscaleUrl, "For approved Tailscale/VPN devices.", "tailscale", "tailscale")}
      </div>

      <div class="grid-2">
        <div class="card admin-controls-card">
          <div class="section-title">Server Details</div>
          <table class="admin-table" style="margin-top:8px;">
            <tbody>
              ${row("Server Name", info.server?.hostname)}
              ${row("Node Port", info.server?.port)}
              ${row("Bind Host", info.server?.bindHost || "all interfaces")}
              ${row("Node Version", info.server?.nodeVersion)}
              ${row("Process ID", info.server?.pid)}
              ${row("Root Folder", info.server?.rootDir)}
              ${row("Generated", info.generatedAt)}
            </tbody>
          </table>
        </div>

        <div class="card admin-controls-card">
          <div class="section-title">Detected Network Interfaces</div>
          <table class="admin-table" style="margin-top:8px;">
            <thead><tr><th>Type</th><th>Interface</th><th>IP</th></tr></thead>
            <tbody>
              ${(info.network?.interfaces || []).map(i => `<tr><td>${esc(i.type)}</td><td>${esc(i.name)}</td><td><code>${esc(i.ip)}</code></td></tr>`).join("") || `<tr><td colspan="3">No IPv4 network interface detected.</td></tr>`}
            </tbody>
          </table>
          <div class="small-hint" style="margin-top:8px;">Tailscale CLI: ${esc(info.network?.tailscaleCli || "unknown")}</div>
        </div>
      </div>

      <div class="card admin-controls-card" style="margin-top:14px;">
        <div class="section-title">All LAN URLs</div>
        <div class="small-hint">If Best LAN URL does not open on Android, try the other LAN URLs. Health URL should return API status.</div>
        <table class="admin-table" style="margin-top:8px;">
          <thead><tr><th>Priority</th><th>Interface</th><th>IP</th><th>URL</th><th>Action</th></tr></thead>
          <tbody>${urlRows(info.urls?.lan, "LAN")}</tbody>
        </table>
      </div>

      <div class="card admin-controls-card" style="margin-top:14px;background:#eff6ff;border-color:#bfdbfe;">
        <div class="section-title">Usage Notes</div>
        <div class="small-hint" style="line-height:1.7;">
          ${(info.notes || []).map(n => `- ${esc(n)}`).join("<br>")}
        </div>
      </div>
    `;

    host.querySelectorAll("[data-system-copy]").forEach(btn => btn.onclick = () => copyByKey(btn.dataset.systemCopy));
    host.querySelectorAll("[data-system-open]").forEach(btn => btn.onclick = () => openByKey(btn.dataset.systemOpen));
    host.querySelectorAll("[data-copy-url]").forEach(btn => btn.onclick = () => copyText(btn.dataset.copyUrl, "App URL"));
  }

  function getUrlByKey(key) {
    if (!lastInfo) return "";
    if (key === "current") return lastInfo.current?.browserUrl || window.location.href;
    if (key === "home") return lastInfo.current?.homeFromRequest || `${window.location.origin}/index.html`;
    if (key === "lan") return lastInfo.urls?.lan?.[0]?.homeUrl || firstUrl(lastInfo.urls?.lan);
    if (key === "tailscale") return lastInfo.urls?.tailscale?.[0]?.homeUrl || firstUrl(lastInfo.urls?.tailscale);
    return "";
  }

  function copyByKey(key) {
    const labels = { current: "Current URL", home: "App Home URL", lan: "Best LAN URL", tailscale: "Tailscale URL" };
    copyText(getUrlByKey(key), labels[key] || "URL");
  }

  function openByKey(key) {
    const url = getUrlByKey(key);
    if (!url) return alert("URL is not available yet. Click Refresh Network Info first.");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function loadInfo() {
    if (loading) return;
    if (!hasPermission("systemInfo")) return status("No permission: System Info", "error");
    loading = true;
    try {
      status("Detecting network info...");
      const currentUrl = encodeURIComponent(window.location.href);
      const payload = await requestJson(`/api/system/info?currentUrl=${currentUrl}`, { method: "GET" });
      lastInfo = payload.data || {};
      renderInfo(lastInfo);
      status("System info refreshed.", "success");
    } catch (err) {
      console.error("System info load failed:", err);
      status("Failed: " + (err.message || err), "error");
      alert("System Info load failed:\n\n" + (err.message || err));
    } finally {
      loading = false;
    }
  }

  function wireButtons() {
    const refresh = $("refreshSystemInfoBtn");
    if (refresh && !refresh.__spwtWired) { refresh.__spwtWired = true; refresh.onclick = loadInfo; }
    const current = $("copyCurrentUrlBtn");
    if (current && !current.__spwtWired) { current.__spwtWired = true; current.onclick = () => copyByKey("current"); }
    const lan = $("copyLanUrlBtn");
    if (lan && !lan.__spwtWired) { lan.__spwtWired = true; lan.onclick = () => copyByKey("lan"); }
    const ts = $("copyTailscaleUrlBtn");
    if (ts && !ts.__spwtWired) { ts.__spwtWired = true; ts.onclick = () => copyByKey("tailscale"); }
    const open = $("openCurrentUrlBtn");
    if (open && !open.__spwtWired) { open.__spwtWired = true; open.onclick = () => openByKey("home"); }
  }

  function applyPermission() {
    const user = window.SPWT_ADMIN_ACCESS?.getUser?.() || null;
    if (!user) return;
    const allowed = hasPermission("systemInfo");
    const tab = document.querySelector('[data-tab="tabSystemInfo"]');
    const page = $("tabSystemInfo");
    if (tab) tab.style.display = allowed ? "" : "none";
    if (page && !allowed) page.classList.add("hidden");
  }

  function showTab() {
    if (!hasPermission("systemInfo")) return alert("No permission: System Info");
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="tabSystemInfo"]')?.classList.add("active");
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    $("tabSystemInfo")?.classList.remove("hidden");
    wireButtons();
    loadInfo();
  }

  function wireTab() {
    if (document.__spwtSystemInfoTabWired) return;
    document.__spwtSystemInfoTabWired = true;
    document.addEventListener("click", (event) => {
      if (!event.target?.closest?.('[data-tab="tabSystemInfo"]')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showTab();
    }, true);
  }

  function tick() {
    ensureTab();
    wireTab();
    applyPermission();
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(tick, 900));
  document.addEventListener("click", () => setTimeout(tick, 120), true);
  setInterval(tick, 1500);
})();
