// server/services/dashboardServiceV2.js
// Wrapper over dashboardService.js.
// Keeps machine summary V2 category/status visibility and exports detail/loss contracts.

const baseDashboardService = require("./dashboardService");
const { getMachineDetail } = require("./dashboardDetailLossService");
const { getLossSummary } = require("./lossSummaryService");
const { getMachineCompletionReport } = require("./machineCompletionReportService");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function statusOfMachine(m) {
  const raw = clean(m.status).toLowerCase();

  if (raw === "inactive" || raw === "deleted" || raw === "delete" || raw === "disabled") return "Inactive";
  if (raw === "completed" || raw === "complete") return "Completed";

  // Admin screen has only Active/Completed dropdown. Completed is stored as active=false.
  // Deleted machines are already stored with status=Deleted, so active=false here means Completed.
  if (m.active === false) return "Completed";

  return "Active";
}

function isHistoricalStatus(status) {
  const s = clean(status).toLowerCase();
  return s === "completed" || s === "deleted" || s === "inactive" || s === "historical";
}

async function listAll(collectionName, options = {}) {
  const perPage = options.perPage || 500;
  let page = 1;
  const all = [];

  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: {
        page,
        perPage,
        filter: options.filter || "",
        sort: options.sort || ""
      }
    });

    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);

    if (!items.length || page >= Number(result.totalPages || 1)) break;
    page += 1;
  }

  return all;
}

async function getMachineSummary(params = {}) {
  const statusFilter = clean(params.status || "");
  const machineFilter = clean(params.machine || params.machineNo || "");
  const categoryFilter = clean(params.category || params.machineCategory || "");

  const [
    machines,
    machineTypes,
    subworks,
    bookingPoints,
    lines,
    bookingStatus,
    qualityLogs
  ] = await Promise.all([
    listAll("machines", { perPage: 500 }),
    listAll("machine_types", { perPage: 500 }),
    listAll("subworks", { perPage: 1000 }),
    listAll("booking_points", { perPage: 1000 }),
    listAll("production_entry_lines", { perPage: 1000, sort: "-work_date" }),
    listAll("booking_status", { perPage: 1000 }),
    listAll("quality_logs", { perPage: 1000, sort: "-work_date" })
  ]);

  const typeMetaMap = new Map();
  const activeTypeCodes = new Set();

  machineTypes.forEach((t) => {
    const code = clean(t.type_code || t.id || t.typeCode);
    const name = clean(t.type_name || t.name || t.typeName) || code;
    if (!code) return;

    const active = t.active !== false;
    typeMetaMap.set(code, { code, name, active });
    if (active) activeTypeCodes.add(code);
  });

  const lineMachineNos = new Set();
  const lineMachineTypeByMachine = new Map();
  const lineMachineCategoryByMachine = new Map();

  lines.forEach((line) => {
    const machineNo = clean(line.machine_no);
    if (!machineNo) return;
    lineMachineNos.add(machineNo);

    const typeCode = clean(line.machine_type_code);
    const category = clean(line.machine_category);
    if (typeCode && !lineMachineTypeByMachine.has(machineNo)) lineMachineTypeByMachine.set(machineNo, typeCode);
    if (category && !lineMachineCategoryByMachine.has(machineNo)) lineMachineCategoryByMachine.set(machineNo, category);
  });

  const machineMap = new Map();

  machines.forEach((m) => {
    const machineNo = clean(m.machine_no || m.name || m.machineNo);
    if (!machineNo) return;

    const typeCode = clean(m.machine_type_code || m.type || "");
    const typeMeta = typeMetaMap.get(typeCode);
    const status = statusOfMachine(m);

    machineMap.set(machineNo, {
      machineNo,
      machineTypeCode: typeCode,
      machineCategory: typeMeta?.name || typeCode || clean(m.machine_category),
      status,
      active: status === "Active",
      source: "machines"
    });
  });

  lineMachineNos.forEach((machineNo) => {
    if (machineMap.has(machineNo)) return;

    const typeCode = clean(lineMachineTypeByMachine.get(machineNo));
    const category = clean(lineMachineCategoryByMachine.get(machineNo) || typeMetaMap.get(typeCode)?.name || typeCode);

    machineMap.set(machineNo, {
      machineNo,
      machineTypeCode: typeCode,
      machineCategory: category,
      status: "Historical",
      active: false,
      source: "production_lines"
    });
  });

  const machinesOut = Array.from(machineMap.values())
    .filter((m) => {
      if (statusFilter && statusFilter !== "All" && m.status !== statusFilter) return false;
      if (machineFilter && machineFilter !== "All" && m.machineNo !== machineFilter) return false;
      if (categoryFilter && categoryFilter !== "All" && m.machineCategory !== categoryFilter && m.machineTypeCode !== categoryFilter) return false;
      if (m.source === "production_lines" && statusFilter === "Active") return false;
      return true;
    })
    .map((m) => {
      const machineLines = lines.filter((line) => clean(line.machine_no) === m.machineNo);
      const machineSubworks = subworks.filter((sw) => clean(sw.machine_type_code) === clean(m.machineTypeCode));
      const plannedMinutes = machineSubworks.reduce((sum, sw) => sum + toNumber(sw.standard_time, 0), 0);
      const normalLines = machineLines.filter((line) => clean(line.work_nature || "Normal").toLowerCase() === "normal");
      const completedStandard = normalLines.reduce((sum, line) => sum + toNumber(line.standard_minutes, 0), 0);
      const actualMinutes = machineLines.reduce((sum, line) => sum + toNumber(line.actual_minutes, 0), 0);
      const overrunMinutes = machineLines.reduce((sum, line) => sum + toNumber(line.overrun_minutes, 0), 0);
      const reworkMinutes = machineLines.filter((line) => clean(line.work_nature).toLowerCase() === "rework").reduce((sum, line) => sum + toNumber(line.actual_minutes, 0), 0);
      const otherMinutes = machineLines.filter((line) => clean(line.work_nature).toLowerCase() === "other").reduce((sum, line) => sum + toNumber(line.actual_minutes, 0), 0);
      const standardMinutes = plannedMinutes > 0 ? plannedMinutes : completedStandard;
      const remainingMinutes = Math.max(0, standardMinutes - completedStandard);
      const completionPct = standardMinutes > 0 ? Math.min(100, (completedStandard / standardMinutes) * 100) : 0;
      const machineBookingStatus = bookingStatus.filter((bp) => clean(bp.machine_no) === m.machineNo);
      const qualityIssues = qualityLogs.filter((q) => clean(q.machine_no) === m.machineNo && clean(q.status || q.value).toUpperCase().includes("NOT OK"));

      return {
        ...m,
        standardMinutes,
        completedStandardMinutes: completedStandard,
        actualMinutes,
        remainingMinutes,
        overrunMinutes,
        reworkMinutes,
        otherMinutes,
        completionPct: Number(completionPct.toFixed(1)),
        bookingDoneCount: machineBookingStatus.filter((bp) => clean(bp.status).toUpperCase() === "DONE").length,
        bookingTotalCount: bookingPoints.filter((bp) => clean(bp.machine_type_code) === clean(m.machineTypeCode)).length,
        qualityNotOkCount: qualityIssues.length
      };
    })
    .sort((a, b) => {
      const aHist = isHistoricalStatus(a.status) ? 1 : 0;
      const bHist = isHistoricalStatus(b.status) ? 1 : 0;
      return aHist - bHist || a.machineNo.localeCompare(b.machineNo);
    });

  return {
    machines: machinesOut,
    filters: {
      statuses: ["All", "Active", "Completed", "Inactive", "Historical"],
      categories: Array.from(new Set(machinesOut.map((m) => clean(m.machineCategory)).filter(Boolean))).sort(),
      machineNos: Array.from(new Set(machinesOut.map((m) => clean(m.machineNo)).filter(Boolean))).sort()
    },
    meta: {
      source: "dashboardServiceV2",
      baseService: !!baseDashboardService,
      counts: {
        machines: machines.length,
        lineMachines: lineMachineNos.size,
        returned: machinesOut.length
      }
    }
  };
}

module.exports = {
  ...baseDashboardService,
  getMachineSummary,
  getMachineDetail,
  getLossSummary,
  getMachineCompletionReport
};
