// server/services/dashboardServiceV2.js
// Wrapper over dashboardService.js.
// Keeps existing machine detail and loss summary logic, but improves machine summary category visibility.
// Rule:
// - Active dashboard/filter should use active machine categories only.
// - Deleted/inactive categories may still appear for Completed/Deleted/historical machines with entries.

const baseDashboardService = require("./dashboardService");
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
  if (raw === "completed" || raw === "complete") return "Completed";
  if (raw === "inactive" || raw === "deleted" || raw === "delete" || raw === "disabled") return "Inactive";
  if (m.active === false) return "Inactive";
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
    const hasHistory = lineMachineNos.has(machineNo);

    if (typeCode && typeMeta && !typeMeta.active && !isHistoricalStatus(status) && !hasHistory) return;

    const typeName = typeMeta?.name || typeCode;

    machineMap.set(machineNo, {
      machineNo,
      machineCategory: typeName,
      machineTypeCode: typeCode,
      status,
      rawStatus: clean(m.status),
      active: m.active !== false,
      typeActive: typeMeta ? typeMeta.active : true,
      hasHistory
    });
  });

  const bookingStdBySubworkKey = new Map();

  bookingPoints.forEach((bp) => {
    if (bp.active === false) return;

    const key = [
      clean(bp.machine_type_code),
      clean(bp.department_code),
      clean(bp.subwork_code)
    ].join("|");

    bookingStdBySubworkKey.set(
      key,
      toNumber(bookingStdBySubworkKey.get(key), 0) + toNumber(bp.standard_time, 0)
    );
  });

  const plannedStdByType = new Map();

  subworks.forEach((sw) => {
    if (sw.active === false) return;

    const typeCode = clean(sw.machine_type_code);
    if (!typeCode) return;

    const key = [
      clean(sw.machine_type_code),
      clean(sw.department_code),
      clean(sw.subwork_code)
    ].join("|");

    const subworkStd = toNumber(sw.standard_time, 0);
    const bookingStd = toNumber(bookingStdBySubworkKey.get(key), 0);
    const plannedStd = subworkStd > 0 ? subworkStd : bookingStd;

    plannedStdByType.set(
      typeCode,
      toNumber(plannedStdByType.get(typeCode), 0) + plannedStd
    );
  });

  const summaryMap = new Map();

  function ensure(machineNo, category = "", typeCode = "") {
    const key = clean(machineNo);
    if (!key) return null;

    if (!summaryMap.has(key)) {
      const master = machineMap.get(key) || {};
      const finalTypeCode = clean(typeCode || master.machineTypeCode || lineMachineTypeByMachine.get(key) || "");
      const typeMeta = typeMetaMap.get(finalTypeCode);
      const finalStatus = clean(master.status || (lineMachineNos.has(key) ? "Historical" : "Active"));
      const hasHistory = lineMachineNos.has(key) || Boolean(master.hasHistory);

      if (typeMeta && !typeMeta.active && !isHistoricalStatus(finalStatus) && !hasHistory) return null;

      const finalCategory = clean(
        (typeMeta?.name) ||
        category ||
        master.machineCategory ||
        lineMachineCategoryByMachine.get(key) ||
        finalTypeCode
      );

      const plannedStandardMinutes = toNumber(plannedStdByType.get(finalTypeCode), 0);

      summaryMap.set(key, {
        machineNo: key,
        machineCategory: finalCategory,
        machineTypeCode: finalTypeCode,
        machineCategoryActive: typeMeta ? typeMeta.active : true,
        status: finalStatus,
        rawStatus: clean(master.rawStatus || finalStatus),

        plannedStandardMinutes,
        completedStandardMinutes: 0,
        actualMinutes: 0,
        overrunMinutes: 0,
        remainingMinutes: plannedStandardMinutes,

        reworkMinutes: 0,
        otherMinutes: 0,
        normalMinutes: 0,

        bookingPointCount: 0,
        bookingDoneCount: 0,
        bookingPartialCount: 0,

        qualityLogCount: 0,
        qualityDoneCount: 0,

        lastWorkDate: "",
        entryCount: 0
      });
    }

    return summaryMap.get(key);
  }

  machineMap.forEach((m) => {
    ensure(m.machineNo, m.machineCategory, m.machineTypeCode);
  });

  lines.forEach((line) => {
    const machineNo = clean(line.machine_no);
    const item = ensure(machineNo, line.machine_category, line.machine_type_code);
    if (!item) return;

    const standard = toNumber(line.standard_minutes, 0);
    const actual = toNumber(line.actual_minutes, 0);
    const overrun = toNumber(line.overrun_minutes, Math.max(0, actual - standard));
    const nature = clean(line.work_nature || "Normal").toLowerCase();

    item.actualMinutes += actual;
    item.overrunMinutes += overrun;
    item.entryCount += 1;

    if (nature === "rework") {
      item.reworkMinutes += actual;
    } else if (nature === "other") {
      item.otherMinutes += actual;
    } else {
      item.normalMinutes += actual;
      item.completedStandardMinutes += standard;
    }

    const workDate = clean(line.work_date);
    if (workDate && workDate > item.lastWorkDate) item.lastWorkDate = workDate;
  });

  bookingStatus.forEach((bp) => {
    const item = ensure(bp.machine_no, bp.machine_category, bp.machine_type_code);
    if (!item) return;

    item.bookingPointCount += 1;

    const status = clean(bp.status).toUpperCase();
    if (status === "DONE") item.bookingDoneCount += 1;
    if (status === "PARTIAL") item.bookingPartialCount += 1;
  });

  qualityLogs.forEach((q) => {
    const item = ensure(q.machine_no, q.machine_category, q.machine_type_code);
    if (!item) return;

    item.qualityLogCount += 1;

    const value = clean(q.value || q.status);
    if (value) item.qualityDoneCount += 1;

    const workDate = clean(q.work_date);
    if (workDate && workDate > item.lastWorkDate) item.lastWorkDate = workDate;
  });

  let items = Array.from(summaryMap.values()).map((x) => {
    x.remainingMinutes = Math.max(0, x.plannedStandardMinutes - x.completedStandardMinutes);

    const completionPct = x.plannedStandardMinutes > 0
      ? Math.min(100, (x.completedStandardMinutes / x.plannedStandardMinutes) * 100)
      : 0;

    const efficiencyPct = x.actualMinutes > 0
      ? (x.completedStandardMinutes / x.actualMinutes) * 100
      : 0;

    return {
      ...x,
      standardMinutes: x.plannedStandardMinutes,
      standardHours: Number((x.plannedStandardMinutes / 60).toFixed(2)),
      completedStandardHours: Number((x.completedStandardMinutes / 60).toFixed(2)),
      actualHours: Number((x.actualMinutes / 60).toFixed(2)),
      remainingHours: Number((x.remainingMinutes / 60).toFixed(2)),
      overrunHours: Number((x.overrunMinutes / 60).toFixed(2)),
      completionPct: Number(completionPct.toFixed(1)),
      efficiencyPct: Number(efficiencyPct.toFixed(1))
    };
  });

  if (machineFilter) {
    items = items.filter(x => x.machineNo.toLowerCase().includes(machineFilter.toLowerCase()));
  }

  if (categoryFilter) {
    items = items.filter(x =>
      x.machineCategory.toLowerCase().includes(categoryFilter.toLowerCase()) ||
      x.machineTypeCode.toLowerCase().includes(categoryFilter.toLowerCase())
    );
  }

  if (statusFilter && statusFilter.toLowerCase() !== "all") {
    items = items.filter(x => x.status.toLowerCase() === statusFilter.toLowerCase());
  }

  items.sort((a, b) => {
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    return a.machineNo.localeCompare(b.machineNo);
  });

  const activeMachineCategories = Array.from(typeMetaMap.values())
    .filter((x) => x.active)
    .map((x) => ({ code: x.code, name: x.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    machines: items,
    filters: {
      machineCategories: activeMachineCategories
    },
    meta: {
      source: "pocketbase",
      service: "dashboardServiceV2",
      statusRule: "completed_status_wins;inactive_deleted_or_active_false_maps_to_inactive",
      machineCategoryRule: "filters show active categories only; historical completed/inactive machines may retain inactive categories",
      generatedAt: new Date().toISOString(),
      counts: {
        machines: items.length,
        machineTypes: activeMachineCategories.length,
        allMachineTypes: machineTypes.length,
        subworks: subworks.length,
        bookingPoints: bookingPoints.length,
        productionLines: lines.length,
        bookingStatus: bookingStatus.length,
        qualityLogs: qualityLogs.length
      }
    }
  };
}

module.exports = {
  ...baseDashboardService,
  getMachineSummary
};
