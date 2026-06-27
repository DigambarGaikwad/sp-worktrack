// renderer/maintenanceApiFallbackPatch.js
// Maintenance-only fetch fallback for installed/runtime port changes.

(function () {
  if (window.__SPWT_MAINTENANCE_API_FALLBACK__) return;
  window.__SPWT_MAINTENANCE_API_FALLBACK__ = true;

  const nativeFetch = window.fetch.bind(window);
  const MAINTENANCE_API = "/api/maintenance/";

  function cleanBase(value) {
    return String(value || "").trim().replace(/\/$/, "");
  }

  function unique(values) {
    const seen = new Set();
    return values.map(cleanBase).filter(value => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function candidateBases() {
    const values = [];
    if (window.SPWT_CONFIG?.API_BASE_URL) values.push(window.SPWT_CONFIG.API_BASE_URL);
    if (/^https?:$/i.test(window.location.protocol)) values.push(window.location.origin);
    values.push(
      "http://127.0.0.1:3032",
      "http://localhost:3032",
      "http://127.0.0.1:3030",
      "http://localhost:3030"
    );
    return unique(values);
  }

  function maintenancePath(input) {
    const raw = typeof input === "string" ? input : input?.url || "";
    if (!raw) return "";

    if (raw.startsWith(MAINTENANCE_API)) return raw;

    try {
      const url = new URL(raw, window.location.href);
      if (!url.pathname.startsWith(MAINTENANCE_API)) return "";
      return `${url.pathname}${url.search}`;
    } catch (_) {
      return "";
    }
  }

  function originalUrl(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url || "";
      return new URL(raw, window.location.href).toString();
    } catch (_) {
      return "";
    }
  }

  function canRetry(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return err?.name === "TypeError" || msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed");
  }

  window.fetch = async function spwtMaintenanceFetch(input, init) {
    const path = maintenancePath(input);
    if (!path) return nativeFetch(input, init);

    const firstUrl = originalUrl(input);
    const tried = [];

    try {
      return await nativeFetch(input, init);
    } catch (err) {
      if (!canRetry(err)) throw err;

      let lastErr = err;
      for (const base of candidateBases()) {
        const retryUrl = `${base}${path}`;
        if (retryUrl === firstUrl || tried.includes(retryUrl)) continue;
        tried.push(retryUrl);
        try {
          return await nativeFetch(retryUrl, init);
        } catch (retryErr) {
          lastErr = retryErr;
        }
      }

      throw new Error(`Maintenance API fetch failed. Tried: ${[firstUrl, ...tried].filter(Boolean).join(" | ")}. Last error: ${lastErr?.message || lastErr}`);
    }
  };
})();
