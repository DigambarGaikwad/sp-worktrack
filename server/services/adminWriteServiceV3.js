// server/services/adminWriteServiceV3.js
// Thin wrapper over V2 to make machine status explicit before saving.

const v2 = require("./adminWriteServiceV2");
const plannedAbsenceService = require("./plannedAbsenceService");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeMachineStatus(machine = {}) {
  const raw = clean(machine.status || machine.machineStatus || machine.machine_status).toLowerCase();

  // Delete/inactive states are explicit historical/inactive states.
  if (raw === "deleted" || raw === "delete") {
    return { ...machine, status: "Deleted", active: false };
  }

  if (raw === "inactive" || raw === "disabled") {
    return { ...machine, status: "Inactive", active: false };
  }

  // Admin machine dropdown only sends active=false for Completed.
  // This must override any stale status="Active" value from the loaded record.
  if (machine.active === false) {
    return { ...machine, status: "Completed", active: false };
  }

  if (raw === "completed" || raw === "complete") {
    return { ...machine, status: "Completed", active: false };
  }

  return { ...machine, status: "Active", active: true };
}

function normalizePayload(rawData = {}) {
  const root = rawData.data || rawData.adminOverrides || rawData;
  if (!Array.isArray(root.machines)) return rawData;

  const normalizedMachines = root.machines.map(normalizeMachineStatus);

  if (rawData.data) return { ...rawData, data: { ...rawData.data, machines: normalizedMachines } };
  if (rawData.adminOverrides) return { ...rawData, adminOverrides: { ...rawData.adminOverrides, machines: normalizedMachines } };
  return { ...rawData, machines: normalizedMachines };
}

async function saveAdminMasterData(rawData = {}, options = {}) {
  return v2.saveAdminMasterData(normalizePayload(rawData), options);
}

module.exports = {
  ...v2,
  ...plannedAbsenceService,
  saveAdminMasterData
};


