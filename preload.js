// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Existing (if you use them in entry screen)
  getMachines: () => ipcRenderer.invoke("get-machines"),
  getEmployees: () => ipcRenderer.invoke("get-employees"),
  getShifts: () => ipcRenderer.invoke("get-shifts"),
  getStandardTime: () => ipcRenderer.invoke("get-standardTime"),
  getSubWorks: () => ipcRenderer.invoke("get-subWorks"),

  // Admin overrides
  getAdminOverrides: () => ipcRenderer.invoke("get-admin-overrides"),
  saveAdminOverrides: (overrides) => ipcRenderer.invoke("save-admin-overrides", overrides),
  
   //Admin data to google sheet
  syncAdminOverridesToSheets: (payload) => ipcRenderer.invoke("sync-admin-overrides-to-sheets", payload),

  // Submit
  submitToSheets: (payload) => ipcRenderer.invoke("submit-to-sheets", payload),


  // ✅ Dashboard feed (Sheets → App)
  getDashboardFeed: (payload) => ipcRenderer.invoke("get-dashboard-feed", payload),

  // ✅ Debug helper
  __preloadVersion: () => "PRELOAD_V2_DASH_OK"
});