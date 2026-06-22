// renderer/admin/adminGoogleBackupHelpPatch.js
// Adds step-by-step Google Sheet backup setup help near Save Google Backup Settings.
(function () {
  const STYLE_ID = "spwt-google-backup-help-style";
  const BACKDROP_ID = "spwtGoogleBackupHelpBackdrop";

  const RECEIVER_CODE = String.raw`// google_apps_script/SheetBackupReceiver.gs
// SP WorkTrack DB Edition - Google Sheet backup receiver.
// Paste this file into Google Apps Script and deploy as a Web App.
//
// Deployment:
// 1) Open the target Google Sheet.
// 2) Extensions -> Apps Script.
// 3) Paste this code into Code.gs.
// 4) In Apps Script, set Project Settings -> Script properties:
//    BACKUP_SECRET = same value as GOOGLE_SHEET_BACKUP_SECRET in Node .env.
// 5) Deploy -> New deployment -> Web app.
// 6) Execute as: Me. Access: Anyone with the link.
// 7) Copy Web App URL into GOOGLE_SHEET_WEBAPP_URL in Node .env.

function getBackupSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty("BACKUP_SECRET") || "").trim();
}

function doGet() {
  return json_({
    ok: true,
    app: "SP WorkTrack Google Sheet Backup Receiver",
    message: "Receiver is running. Use POST for sync actions.",
    hasBackupSecret: !!getBackupSecret_(),
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const body = JSON.parse(raw || "{}");
    const backupSecret = getBackupSecret_();

    if (!backupSecret) {
      return json_({ ok: false, error: "Server configuration missing: BACKUP_SECRET script property is not set." });
    }

    if (!body.secret || body.secret !== backupSecret) {
      return json_({ ok: false, error: "Unauthorized: bad or missing secret." });
    }

    const action = String(body.action || "").trim();

    if (action === "backupTest") {
      return json_({
        ok: true,
        message: "Google Sheet backup receiver connected.",
        receivedAt: new Date().toISOString(),
        source: body.source || ""
      });
    }

    if (action === "appendRows") {
      return appendRows_(body);
    }

    if (action === "upsertRows") {
      return upsertRows_(body);
    }

    if (action === "ensureSheets") {
      ensureBackupSheets_();
      return json_({ ok: true, message: "Backup sheets checked/created." });
    }

    return json_({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function normalizeRows_(rows, width) {
  return rows.map(function(row) {
    row = Array.isArray(row) ? row.slice() : [row];
    while (row.length < width) row.push("");
    return row;
  });
}

function appendRows_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = String(body.sheetName || "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.headers) ? body.headers : [];
  const uniqueKeyColumns = Array.isArray(body.uniqueKeyColumns) ? body.uniqueKeyColumns : [];

  if (!sheetName) return json_({ ok: false, error: "Missing sheetName." });
  if (!rows.length) return json_({ ok: true, sheetName: sheetName, appended: 0, skippedDuplicates: 0, message: "No rows to append." });

  const sh = getOrCreateSheet_(ss, sheetName, headers);
  ensureHeaders_(sh, headers);

  const width = rows.reduce(function(max, row) {
    return Math.max(max, Array.isArray(row) ? row.length : 0);
  }, headers.length || 1);

  const normalizedRows = normalizeRows_(rows, width);
  const duplicateSet = buildExistingKeySet_(sh, uniqueKeyColumns);
  const headerMap = getHeaderMap_(sh);
  const rowsToAppend = [];
  let skippedDuplicates = 0;

  normalizedRows.forEach(function(row) {
    const key = buildRowUniqueKey_(row, headerMap, uniqueKeyColumns);
    if (key && duplicateSet[key]) {
      skippedDuplicates += 1;
      return;
    }
    if (key) duplicateSet[key] = true;
    rowsToAppend.push(row);
  });

  if (rowsToAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, width).setValues(rowsToAppend);
  }

  return json_({ ok: true, sheetName: sheetName, appended: rowsToAppend.length, skippedDuplicates: skippedDuplicates, lastRow: sh.getLastRow() });
}

function upsertRows_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = String(body.sheetName || "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.headers) ? body.headers : [];
  const uniqueKeyColumns = Array.isArray(body.uniqueKeyColumns) ? body.uniqueKeyColumns : [];

  if (!sheetName) return json_({ ok: false, error: "Missing sheetName." });
  if (!uniqueKeyColumns.length) return json_({ ok: false, error: "Missing uniqueKeyColumns for upsertRows." });
  if (!rows.length) return json_({ ok: true, sheetName: sheetName, inserted: 0, updated: 0, message: "No rows to upsert." });

  const sh = getOrCreateSheet_(ss, sheetName, headers);
  ensureHeaders_(sh, headers);

  const width = rows.reduce(function(max, row) {
    return Math.max(max, Array.isArray(row) ? row.length : 0);
  }, Math.max(headers.length || 1, sh.getLastColumn() || 1));

  const headerMap = getHeaderMap_(sh);
  const existingRowMap = buildExistingRowMap_(sh, uniqueKeyColumns);
  const normalizedRows = normalizeRows_(rows, width);

  const rowsToAppend = [];
  let updated = 0;

  normalizedRows.forEach(function(row) {
    const key = buildRowUniqueKey_(row, headerMap, uniqueKeyColumns);
    if (key && existingRowMap[key]) {
      sh.getRange(existingRowMap[key], 1, 1, width).setValues([row]);
      updated += 1;
      return;
    }
    rowsToAppend.push(row);
  });

  if (rowsToAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, width).setValues(rowsToAppend);
  }

  return json_({ ok: true, sheetName: sheetName, inserted: rowsToAppend.length, updated: updated, lastRow: sh.getLastRow() });
}

function buildExistingKeySet_(sh, uniqueKeyColumns) {
  const out = {};
  const rowMap = buildExistingRowMap_(sh, uniqueKeyColumns);
  Object.keys(rowMap).forEach(function(key) { out[key] = true; });
  return out;
}

function buildExistingRowMap_(sh, uniqueKeyColumns) {
  const out = {};
  if (!uniqueKeyColumns || !uniqueKeyColumns.length) return out;
  if (sh.getLastRow() < 2) return out;

  const headerMap = getHeaderMap_(sh);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

  values.forEach(function(row, index) {
    const key = buildRowUniqueKey_(row, headerMap, uniqueKeyColumns);
    if (key) out[key] = index + 2;
  });

  return out;
}

function buildRowUniqueKey_(row, headerMap, uniqueKeyColumns) {
  if (!uniqueKeyColumns || !uniqueKeyColumns.length) return "";

  const parts = [];
  for (let i = 0; i < uniqueKeyColumns.length; i++) {
    const name = String(uniqueKeyColumns[i] || "").trim();
    const colIndex = headerMap[name.toLowerCase()];
    if (colIndex == null) return "";
    const value = String(row[colIndex] || "").trim();
    if (!value) return "";
    parts.push(value.toLowerCase());
  }

  return parts.join("|");
}

function getHeaderMap_(sh) {
  const map = {};
  if (!sh || sh.getLastColumn() < 1) return map;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  headers.forEach(function(h, index) {
    const key = String(h || "").trim().toLowerCase();
    if (key) map[key] = index;
  });
  return map;
}

function ensureBackupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const year = new Date().getFullYear();

  getOrCreateSheet_(ss, "LOG_" + year, logHeaders_());
  getOrCreateSheet_(ss, "ATT_" + year, attendanceHeaders_());
  getOrCreateSheet_(ss, "QUALITY_LOG", qualityLogHeaders_());
  getOrCreateSheet_(ss, "BOOKING_LOG", bookingLogHeaders_());
  getOrCreateSheet_(ss, "BOOKING_STATUS", bookingStatusHeaders_());
  getOrCreateSheet_(ss, "SYNC_STATUS", syncStatusHeaders_());
}

function getOrCreateSheet_(ss, sheetName, headers) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  ensureHeaders_(sh, headers || []);
  return sh;
}

function ensureHeaders_(sh, headers) {
  if (!headers || !headers.length) return;

  if (sh.getLastRow() === 0 || !String(sh.getRange(1, 1).getValue() || "").trim()) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return;
  }

  const current = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function(v) { return String(v || "").trim(); });

  headers.forEach(function(h) {
    if (current.indexOf(h) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      current.push(h);
    }
  });
}

function logHeaders_() {
  return [
    "Timestamp", "Work Date", "Shift", "Shift Start", "Shift End", "Break Minutes", "Work Type",
    "Emp ID", "Emp Name", "Shift Available", "Utilized", "Remaining", "Productivity %",
    "Machine", "Machine Category", "Department", "Sub Work", "Type", "Description", "Root Area",
    "Standard Time", "Actual Time", "Efficiency Reason", "Major Loss Reason", "Major Loss Remark",
    "Flexible Shift Minutes", "Work Checkpoints", "Quality Checkpoints", "Source Entry No", "Source Line No", "Synced At"
  ];
}

function attendanceHeaders_() {
  return [
    "Timestamp", "Work Date", "Emp ID", "Emp Name", "Shift", "Work Type", "Status",
    "Shift Available (min)", "Utilized (min)", "Total Hours", "OT Minutes", "OT Hours",
    "Productivity %", "Major Loss Reason", "Major Loss Remark", "Flexible Shift Minutes", "Source Entry No", "Synced At"
  ];
}

function qualityLogHeaders_() {
  return [
    "Timestamp", "Work Date", "Machine", "Machine Category", "Department", "Sub Work", "Quality Point",
    "Input Type", "Reading/Status", "Result", "Done By ID", "Done By Name", "Shift", "Status", "Source Entry No", "Synced At"
  ];
}

function bookingLogHeaders_() {
  return [
    "Timestamp", "Work Date", "Machine", "Machine Category", "Department", "Sub Work", "Booking Point",
    "Booking Std Time", "Actual Time", "Emp ID", "Emp Name", "Shift", "Work Type", "Status", "Source Entry No", "Synced At"
  ];
}

function bookingStatusHeaders_() {
  return [
    "Machine", "Machine Category", "Department", "Sub Work", "Booking Point", "Booking Std Time", "Consumed Time",
    "Remaining Time", "Completion %", "Status", "Done Date", "Done By ID", "Done By Name", "Shift", "Source Entry No", "Synced At"
  ];
}

function syncStatusHeaders_() {
  return ["Timestamp", "Action", "Sheet Name", "Rows", "Status", "Message"];
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .spwt-google-help-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 24px 12px;
        background: rgba(15, 23, 42, 0.55);
        overflow: auto;
      }
      .spwt-google-help-backdrop.hidden { display: none !important; }
      .spwt-google-help-modal {
        width: min(1100px, 100%);
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
        overflow: hidden;
      }
      .spwt-google-help-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        background: #0b3f73;
        color: #ffffff;
      }
      .spwt-google-help-head .section-title { color: #ffffff; margin: 0; }
      .spwt-google-help-body { padding: 16px; }
      .spwt-google-help-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .spwt-google-help-step {
        padding: 12px;
        margin-bottom: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #f8fafc;
        line-height: 1.55;
      }
      .spwt-google-help-step b { color: #0b3f73; }
      .spwt-google-help-step code {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 8px;
        background: #e8f1ff;
        color: #0b3f73;
        font-weight: 800;
      }
      .spwt-google-help-code-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin: 14px 0 8px;
      }
      .spwt-google-help-code-box {
        max-height: 360px;
        overflow: auto;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        background: #0f172a;
      }
      .spwt-google-help-code-box pre {
        margin: 0;
        padding: 14px;
        white-space: pre;
      }
      .spwt-google-help-code-box code {
        display: block;
        padding: 0;
        background: transparent;
        color: #e2e8f0;
        font: 12px/1.5 Consolas, Monaco, 'Courier New', monospace;
        font-weight: 400;
      }
      @media (max-width: 900px) {
        .spwt-google-help-grid { grid-template-columns: 1fr; }
        .spwt-google-help-backdrop { padding: 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  function sectionTitle(cardEl) {
    return (cardEl.querySelector(".section-title")?.textContent || "").trim().toLowerCase();
  }

  function findGoogleBackupCard() {
    const body = document.getElementById("systemConfigBody");
    if (!body) return null;
    return Array.from(body.querySelectorAll(".admin-controls-card"))
      .find((cardEl) => sectionTitle(cardEl).includes("google sheet")) || null;
  }

  function helpHtml() {
    return `
      <div class="spwt-google-help-head">
        <div>
          <div class="section-title">Google Sheet Backup Setup Help</div>
          <div style="font-size:12px;opacity:.9;">Use this when creating or changing the Google Sheet backup receiver.</div>
        </div>
        <button class="btn grey" type="button" data-close-google-backup-help="true">Close</button>
      </div>
      <div class="spwt-google-help-body">
        <div class="spwt-google-help-step"><b>What this setting is used for</b><br>
          SP WorkTrack sends backup/sync data to a Google Apps Script Web App. The Web App writes data into your selected Google Sheet. The normal Google Sheet sharing link is only for opening the sheet; SP WorkTrack needs the <b>Web App URL</b> ending with <code>/exec</code>.
        </div>
        <div class="spwt-google-help-step"><b>What data is backed up now</b><br>
          <code>LOG_2026</code> comes from production entry lines. <code>ATT_2026</code> comes from production entries, with fallback from line data. <code>QUALITY_LOG</code> and <code>BOOKING_LOG</code> also extract checkpoint data from line JSON when separate log collections are empty. <code>BOOKING_STATUS</code> shows booking-point status where available.
        </div>
        <div class="spwt-google-help-grid">
          <div class="spwt-google-help-step"><b>Step 1 - Create backup Google Sheet</b><br>
            Create a new Google Sheet from the backup Google account, for example <b>Sp Worktrack Back-up</b>.
          </div>
          <div class="spwt-google-help-step"><b>Step 2 - Open Apps Script</b><br>
            In the backup sheet, click <b>Extensions</b> -> <b>Apps Script</b>. Open <b>Code.gs</b>, remove sample code, and paste the receiver code shown below in this help popup.
          </div>
          <div class="spwt-google-help-step"><b>Step 3 - Add Backup Secret in Script Properties</b><br>
            In Apps Script, go to <b>Project Settings</b> -> <b>Script properties</b>. Add property name <code>BACKUP_SECRET</code> and set its value to the same secret used in SP WorkTrack <b>Google Sheet Backup Secret</b>. Do not put this secret directly inside code.
            <br><br><b>Very sensitive:</b> do not paste the backup secret in any online AI tool, chat app, email, screenshot, or share it with anyone.
          </div>
          <div class="spwt-google-help-step"><b>Step 4 - Deploy Web App</b><br>
            Click <b>Deploy</b> -> <b>New deployment</b> -> select <b>Web app</b>.<br>
            Description: <code>SP WorkTrack Backup Receiver</code><br>
            Execute as: <code>Me</code><br>
            Who has access: <code>Anyone</code><br>
            Authorize using the backup Google account, then copy the Web App URL ending with <code>/exec</code>.
          </div>
          <div class="spwt-google-help-step"><b>Step 5 - Fill SP WorkTrack settings</b><br>
            Google Sheet Backup Enabled: <code>true</code><br>
            Google Sheet Web App URL: paste Web App URL<br>
            Google Sheet Backup Secret: paste same secret as Apps Script<br>
            Timeout: use <code>120000</code> for larger syncs<br>
            Click <b>Save Google Backup Settings</b> and restart Node if timeout/config was changed.
          </div>
          <div class="spwt-google-help-step"><b>Step 6 - Test backup safely</b><br>
            First use <b>Test Connection</b>. Then use <b>Sync Selected Date</b> for one known date. After that use <b>Sync Date Range</b> month-wise. Avoid full till-date sync first on large data.
          </div>
          <div class="spwt-google-help-step"><b>When code changes later</b><br>
            After editing Apps Script code, use <b>Deploy</b> -> <b>Manage deployments</b> -> edit current deployment -> choose <b>New version</b> -> <b>Deploy</b>. Saving code alone does not update the live Web App version.
          </div>
          <div class="spwt-google-help-step"><b>Expected sheet tabs</b><br>
            <code>LOG_2026</code>, <code>ATT_2026</code>, <code>QUALITY_LOG</code>, <code>BOOKING_LOG</code>, <code>BOOKING_STATUS</code>, and <code>SYNC_STATUS</code>.
          </div>
        </div>
        <div class="spwt-google-help-step" style="background:#fff7ed;border-color:#fed7aa;"><b>Important note</b><br>
          Keep <code>.env</code> and backup secrets out of GitHub. The files <code>.env.bak_*</code>, <code>runtime_logs/</code>, <code>runtime_scripts/</code>, and <code>transfer_packages/</code> are local/generated files and should not be committed.
        </div>
        <div class="spwt-google-help-code-head">
          <div class="section-title" style="margin:0;">Apps Script Code.gs receiver code</div>
          <button class="btn grey" type="button" data-copy-apps-script-code="true">Copy Code</button>
        </div>
        <div class="spwt-google-help-code-box">
          <pre><code>${escapeHtml(RECEIVER_CODE)}</code></pre>
        </div>
      </div>
    `;
  }

  function copyReceiverCode(button) {
    const originalText = button.textContent;
    const done = () => {
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = originalText; }, 1600);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(RECEIVER_CODE).then(done).catch(() => fallbackCopy(button, done));
      return;
    }

    fallbackCopy(button, done);
  }

  function fallbackCopy(button, done) {
    const textArea = document.createElement("textarea");
    textArea.value = RECEIVER_CODE;
    textArea.setAttribute("readonly", "readonly");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand("copy");
      done();
    } catch (err) {
      button.textContent = "Copy failed";
      setTimeout(() => { button.textContent = "Copy Code"; }, 1800);
    } finally {
      document.body.removeChild(textArea);
    }
  }

  function showHelp() {
    ensureStyle();
    let backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "spwt-google-help-backdrop hidden";
      backdrop.innerHTML = `<div class="spwt-google-help-modal">${helpHtml()}</div>`;
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", (event) => {
        const copyButton = event.target?.closest?.("[data-copy-apps-script-code]");
        if (copyButton) {
          copyReceiverCode(copyButton);
          return;
        }

        if (event.target === backdrop || event.target?.closest?.("[data-close-google-backup-help]")) hideHelp();
      });
    }
    backdrop.classList.remove("hidden");
  }

  function hideHelp() {
    document.getElementById(BACKDROP_ID)?.classList.add("hidden");
  }

  function addHelpButton() {
    const cardEl = findGoogleBackupCard();
    if (!cardEl || cardEl.querySelector("[data-system-google-backup-help]")) return;

    let actions = cardEl.querySelector(".system-section-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "system-section-actions";
      cardEl.appendChild(actions);
    }

    const btn = document.createElement("button");
    btn.className = "btn grey";
    btn.type = "button";
    btn.dataset.systemGoogleBackupHelp = "true";
    btn.textContent = "Help";
    btn.addEventListener("click", showHelp);
    actions.appendChild(btn);
  }

  function enhance() {
    ensureStyle();
    addHelpButton();
  }

  document.addEventListener("click", () => setTimeout(enhance, 160), true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideHelp();
  });
  document.addEventListener("DOMContentLoaded", () => setTimeout(enhance, 1200));
  setInterval(enhance, 1500);
})();
