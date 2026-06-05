// server/services/adminWriteServiceV3.js
// Thin wrapper over V2 to make machine status explicit before saving.

const v2 = require("./adminWriteServiceV2");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeMachineStatus(machine = {}) {
  const raw = clean(machine.status || machine.machineStatus || machine.machine_status).toLowerCase();

  if (raw === "completed" || raw === "complete") {
    return { ...machine, status: "Completed", active: true };
  }

  if (raw === "inactive" || raw === "disabled") {
    return { ...machine, status: "Inactive", active: false };
  }

  if (raw === "deleted" || raw === "delete") {
    return { ...machine, status: "Deleted", active: false };
  }

  if (raw === "active") {
    return { ...machine, status: "Active", active: true };
  }

  return machine;
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
  saveAdminMasterData
};
