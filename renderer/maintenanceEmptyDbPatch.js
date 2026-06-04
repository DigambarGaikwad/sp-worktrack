(function () {
  const API_BASE_URL = window.SPWT_CONFIG?.API_BASE_URL || "http://localhost:3030";
  let added = false;

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[ch]));
  }

  async function postJson(path, body = {}) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.message || `API failed ${res.status}`);
    }

    return payload.data;
  }

  function renderCounts(data) {
    const box = document.getElementById("emptyDbResult");
    if (!box) return;

    const counts = data?.counts || {};
    const deleted = data?.deleted || [];

    const rows = deleted.length
      ? deleted.map(x => `<tr><td>${esc(x.collection)}</td><td style="text-align:right;font-weight:900;">${esc(x.deleted)}</td></tr>`).join("")
      : Object.entries(counts).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:900;">${esc(v)}</td></tr>`).join("");

    box.innerHTML = `
      <div class="small-hint" style="margin-top:8px;font-weight:900;color:#b91c1c;">
        Total records: ${esc(data?.deletedTotal ?? data?.total ?? 0)}
      </div>
      <table>
        <thead><tr><th>Collection</th><th style="text-align:right;">Count</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function setStatus(message, type = "") {
    const el = document.getElementById("emptyDbStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#64748b";
    el.style.fontWeight = "900";
  }

  function ensureBox() {
    if (added || document.getElementById("emptyDbBox")) return;

    const grid = document.querySelector("#tabMaintenance .maintenance-grid");
    if (!grid) return;

    added = true;

    const box = document.createElement("div");
    box.className = "maintenance-box";
    box.id = "emptyDbBox";
    box.innerHTML = `
      <div class="maintenance-title" style="color:#b91c1c;">5. Empty Full Database</div>
      <div class="small-hint danger-note">
        Deletes all SP WorkTrack app data except Admin PIN/settings. Use only for fresh start or trial data cleanup.
      </div>

      <button class="btn grey" id="previewEmptyDbBtn" type="button">Preview Empty DB Count</button>

      <label class="confirm-label">Type EMPTY_DB here to confirm</label>
      <input id="emptyDbConfirmText" class="admin-input confirm-input" placeholder="EMPTY_DB" autocomplete="off" />

      <button class="btn red" id="confirmEmptyDbBtn" type="button">Empty Full Database</button>

      <div id="emptyDbStatus" class="small-hint" style="margin-top:8px;"></div>
      <div id="emptyDbResult"></div>
    `;

    grid.appendChild(box);

    document.getElementById("previewEmptyDbBtn")?.addEventListener("click", async () => {
      try {
        setStatus("Checking database records...");
        const data = await postJson("/api/maintenance/empty-db/preview", {});
        renderCounts(data);
        setStatus("Preview complete.", "success");
      } catch (err) {
        setStatus(err?.message || String(err), "error");
      }
    });

    document.getElementById("confirmEmptyDbBtn")?.addEventListener("click", async () => {
      try {
        const confirmText = document.getElementById("emptyDbConfirmText")?.value || "";

        if (confirmText !== "EMPTY_DB") {
          setStatus("Type EMPTY_DB first.", "error");
          return;
        }

        if (!confirm("This will empty all app data except Admin settings. Continue?")) return;

        setStatus("Emptying database...");
        const data = await postJson("/api/maintenance/empty-db/confirm", { confirmText });
        renderCounts(data);

        document.getElementById("emptyDbConfirmText").value = "";
        setStatus("Database emptied successfully.", "success");
      } catch (err) {
        setStatus(err?.message || String(err), "error");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureBox, 600));
  document.addEventListener("click", (e) => {
    if (e.target?.closest?.('[data-tab="tabMaintenance"]')) setTimeout(ensureBox, 300);
  }, true);

  setInterval(ensureBox, 1500);
})();
