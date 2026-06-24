// renderer/admin/adminTransferDownloadPatch.js
// Uses a direct browser download for transfer ZIPs to avoid leftover blob/tmp files.

(function () {
  const CONFIG = window.SPWT_CONFIG || {};
  if ((CONFIG.DATA_SOURCE || "local") !== "db") return;

  const API_BASE_URL = CONFIG.API_BASE_URL || "http://localhost:3030";

  function $(id) { return document.getElementById(id); }
  function token() { return window.SPWT_ADMIN_ACCESS?.getToken?.() || window.SPWT_ADMIN_TOKEN || localStorage.getItem("spwt_admin_token") || ""; }
  function setStatus(message, type = "") {
    const el = $("dbTransferStatusLine");
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("spwt-status-error", "spwt-status-success");
    if (type === "error") el.classList.add("spwt-status-error");
    if (type === "success") el.classList.add("spwt-status-success");
  }

  async function getLatestPackageName() {
    const fromPath = $("dbTransferLatestPath")?.textContent || "";
    const fromFile = fromPath.split(/[\\/]/).pop();
    if (fromFile && fromFile.startsWith("SPWT_TRANSFER") && fromFile.endsWith(".zip")) return fromFile;

    const headers = {};
    const t = token();
    if (t) headers["x-spwt-admin-token"] = t;
    const res = await fetch(`${API_BASE_URL}/api/transfer/packages`, { headers });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) throw new Error(payload?.message || `Package list failed ${res.status}`);
    const latest = Array.isArray(payload.data) ? payload.data[0] : null;
    if (!latest?.fileName) throw new Error("No transfer package available. Create package first.");
    return latest.fileName;
  }

  async function directDownload(event) {
    const btn = event.target?.closest?.("#dbTransferDownloadBtn");
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      btn.disabled = true;
      setStatus("Preparing direct ZIP download...");
      const fileName = await getLatestPackageName();
      const params = new URLSearchParams();
      const t = token();
      if (t) params.set("adminToken", t);
      const url = `${API_BASE_URL}/api/transfer/package/download/${encodeURIComponent(fileName)}${params.toString() ? `?${params}` : ""}`;

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("Download requested. Only the ZIP file should remain after browser finishes downloading.", "success");
    } catch (err) {
      console.error(err);
      setStatus("Download failed: " + (err.message || err), "error");
      alert("Download failed:\n\n" + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener("click", directDownload, true);
})();
