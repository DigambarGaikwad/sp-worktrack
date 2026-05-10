// server/services/dashboardService.js
// SP WorkTrack DB Edition - Dashboard service
// Reads PocketBase transaction data and prepares dashboard summaries.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

async function listAll(collectionName, options = {}) {
  const perPage = options.perPage || 200;
  let page = 1;
  let all = [];

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
    all = all.concat(items);

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

  const typeNameMap = new Map();
  machineTypes.forEach((t) => {
    const code = clean(t.type_code || t.id || t.typeCode);
    const name = clean(t.type_name || t.name || t.typeName);
    if (code) typeNameMap.set(code, name || code);
  });

  const machineMap = new Map();
  machines.forEach((m) => {
    const machineNo = clean(m.machine_no || m.name || m.machineNo);
    if (!machineNo) return;

    const typeCode = clean(m.machine_type_code || m.type || "");
    const typeName = typeNameMap.get(typeCode) || typeCode;

    machineMap.set(machineNo, {
      machineNo,
      machineCategory: typeName,
      machineTypeCode: typeCode,
      status: clean(m.status || (m.active === false ? "Completed" : "Active")),
      active: m.active !== false
    });
  });

  // Planned standard load per machine category/type.
  // Prefer subwork standard_time. If subwork standard is 0 but booking points exist, use booking point total.
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
      const finalTypeCode = clean(typeCode || master.machineTypeCode || "");
      const finalCategory = clean(category || master.machineCategory || typeNameMap.get(finalTypeCode) || finalTypeCode);
      const plannedStandardMinutes = toNumber(plannedStdByType.get(finalTypeCode), 0);

      summaryMap.set(key, {
        machineNo: key,
        machineCategory: finalCategory,
        machineTypeCode: finalTypeCode,
        status: clean(master.status || "Active"),

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

  return {
    machines: items,
    meta: {
      source: "pocketbase",
      generatedAt: new Date().toISOString(),
      counts: {
        machines: items.length,
        machineTypes: machineTypes.length,
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
  getMachineSummary
};