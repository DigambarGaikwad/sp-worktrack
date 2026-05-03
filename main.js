// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

function dataPath(...parts) {
  return path.join(__dirname, "data", ...parts);
}

function readJsonFile(fileName, fallback) {
  const p = dataPath(fileName);
  try {
    if (!fs.existsSync(p)) {
      if (fallback !== undefined) {
        fs.writeFileSync(p, JSON.stringify(fallback, null, 2), "utf-8");
        return fallback;
      }
      throw new Error(`Missing file: ${p}`);
    }
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("readJsonFile error:", fileName, e);
    throw e;
  }
}

function writeJsonFile(fileName, obj) {
  const p = dataPath(fileName);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
}

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return await res.json();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    icon: path.join(__dirname, "assets", "app.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("index.html");
}

// ===================== IPC HANDLERS =====================
ipcMain.handle("get-admin-overrides", async () => {
  const def = {
    admin: { pin: "1234" },
    machines: [],
    employees: [],
    shifts: [],
    mainWorks: [],
    subWorks: {},
    machineTypes: [
      { id: "Online", name: "Online" },
      { id: "Booster-AirCooled", name: "Booster - Air Cooled" },
      { id: "Booster-WaterCooled", name: "Booster - Water Cooled" },
      { id: "600SCMC", name: "600 SCMC" },
      { id: "400SCMH", name: "400 SCMH" }
    ],
    workCatalogByType: {}
  };

  return readJsonFile("adminOverrides.json", def);
});

ipcMain.handle("save-admin-overrides", async (_event, overrides) => {
  try {
    writeJsonFile("adminOverrides.json", overrides || {});
    return { ok: true };
  } catch (e) {
    console.error("save-admin-overrides error:", e);
    return { ok: false, error: e.message };
  }
});

// Submit → Google Sheets web app
ipcMain.handle("submit-to-sheets", async (_event, payload) => {
  try {
    if (!payload || !payload.webAppUrl) throw new Error("Missing webAppUrl");
    if (!payload.data) throw new Error("Missing data payload");
    const result = await postJSON(payload.webAppUrl, payload.data);
    return result;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// ✅ Dashboard feed (Sheets → App)
ipcMain.handle("get-dashboard-feed", async (_event, payload) => {
  try {
    if (!payload || !payload.webAppUrl) throw new Error("Missing webAppUrl");
    if (!payload.secret) throw new Error("Missing secret");

    const year = payload.year || new Date().getFullYear();

    const result = await postJSON(payload.webAppUrl, {
      secret: payload.secret,
      action: "getDashboardFeed",
      year
    });

    return result;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// ===================== APP LIFE CYCLE =====================
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});