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

async function getMachineDetail(params = {}) {
  const machineNo = clean(params.machine || params.machineNo || "");

  if (!machineNo) {
    const err = new Error("Machine is required.");
    err.status = 400;
    throw err;
  }

  const [
    summaryData,
    machines,
    machineTypes,
    subworks,
    bookingPoints,
    qualityPoints,
    lines,
    bookingStatus,
    qualityLogs
  ] = await Promise.all([
    getMachineSummary({ machine: machineNo }),
    listAll("machines", { perPage: 500 }),
    listAll("machine_types", { perPage: 500 }),
    listAll("subworks", { perPage: 1000 }),
    listAll("booking_points", { perPage: 1000 }),
    listAll("quality_points", { perPage: 1000 }),
    listAll("production_entry_lines", {
      perPage: 1000,
      filter: `machine_no="${machineNo.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      sort: "-work_date"
    }),
    listAll("booking_status", {
      perPage: 1000,
      filter: `machine_no="${machineNo.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    }),
    listAll("quality_logs", {
      perPage: 1000,
      filter: `machine_no="${machineNo.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      sort: "-work_date"
    })
  ]);

  const machineSummary = summaryData.machines?.[0] || null;

  const machine = machines.find((m) => clean(m.machine_no || m.name || m.machineNo) === machineNo) || {};
  const machineTypeCode = clean(machine.machine_type_code || machine.type || machineSummary?.machineTypeCode || "");

  const typeMap = new Map();
  machineTypes.forEach((t) => {
    const code = clean(t.type_code || t.id || t.typeCode);
    const name = clean(t.type_name || t.name || t.typeName);
    if (code) typeMap.set(code, name || code);
  });

  const machineCategory = typeMap.get(machineTypeCode) || machineSummary?.machineCategory || machineTypeCode;

  const deptNameByCode = new Map();

  subworks.forEach((sw) => {
    const code = clean(sw.department_code).toLowerCase();
    const name = clean(sw.department_name || sw.department_code);
    if (code && name) deptNameByCode.set(code, name);
  });

  lines.forEach((line) => {
    const code = clean(line.department_code).toLowerCase();
    const name = clean(line.department_name || line.department_code);
    if (code && name) deptNameByCode.set(code, name);
  });

  function getDepartmentDisplayName(codeOrName, fallback = "") {
    const raw = clean(codeOrName || fallback);
    const key = raw.toLowerCase();

    const mapped = deptNameByCode.get(key);
    const value = clean(mapped || raw);

    const known = {
      electrical: "Electrical",
      mechanical: "Mechanical",
      tubing: "Tubing",
      welding_fitting_and_painting: "Welding/Fitting/Painting",
      welding_fitting_and_paint: "Welding/Fitting/Painting",
      programming_support: "Programming Support",
      other_rework: "Other/Rework"
    };

    if (known[key]) return known[key];

    // If mapped value is still code-style, convert it to readable title style.
    return value
      .replace(/_/g, " ")
      .replace(/\band\b/gi, "&")
      .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  }

  // Booking point standard by subwork
  const bookingStdBySubworkKey = new Map();
  bookingPoints.forEach((bp) => {
    if (bp.active === false) return;
    if (clean(bp.machine_type_code) !== machineTypeCode) return;

    const key = [
      clean(bp.department_code),
      clean(bp.subwork_code)
    ].join("|");

    bookingStdBySubworkKey.set(
      key,
      toNumber(bookingStdBySubworkKey.get(key), 0) + toNumber(bp.standard_time, 0)
    );
  });

  // Planned work list from master subworks for this machine category
  const plannedWork = subworks
    .filter((sw) => sw.active !== false && clean(sw.machine_type_code) === machineTypeCode)
    .map((sw) => {
      const key = [
        clean(sw.department_code),
        clean(sw.subwork_code)
      ].join("|");

      const subworkStd = toNumber(sw.standard_time, 0);
      const bookingStd = toNumber(bookingStdBySubworkKey.get(key), 0);
      const plannedMinutes = subworkStd > 0 ? subworkStd : bookingStd;

      return {
        departmentCode: clean(sw.department_code),
        departmentName: getDepartmentDisplayName(sw.department_code, sw.department_name),
        subworkCode: clean(sw.subwork_code),
        subworkName: clean(sw.subwork_name),
        plannedMinutes
      };
    })
    .filter((x) => x.subworkName);

  const deptMap = new Map();
  const subworkDoneMap = new Map();

  plannedWork.forEach((pw) => {
    const deptKey = pw.departmentName || pw.departmentCode || "Unknown";

    if (!deptMap.has(deptKey)) {
      deptMap.set(deptKey, {
        department: deptKey,
        plannedMinutes: 0,
        completedStandardMinutes: 0,
        actualMinutes: 0,
        remainingMinutes: 0,
        overrunMinutes: 0,
        completionPct: 0,
        efficiencyPct: 0
      });
    }

    deptMap.get(deptKey).plannedMinutes += pw.plannedMinutes;

    const swKey = [
      String(pw.departmentName || pw.departmentCode).toLowerCase(),
      String(pw.subworkName).toLowerCase()
    ].join("|");

    subworkDoneMap.set(swKey, {
      ...pw,
      completedStandardMinutes: 0,
      actualMinutes: 0,
      overrunMinutes: 0,
      lastWorkDate: "",
      status: "PENDING"
    });
  });

  const completedWorks = [];
  const overrunDetails = [];
  const reworkOtherDetails = [];

  lines.forEach((line) => {
    const departmentName = getDepartmentDisplayName(line.department_code || line.department_name || "Unknown", line.department_name);
    const subworkName = clean(line.subwork_name || line.subwork_code || "");
    const nature = clean(line.work_nature || "Normal");

    const standard = toNumber(line.standard_minutes, 0);
    const actual = toNumber(line.actual_minutes, 0);
    const overrun = toNumber(line.overrun_minutes, Math.max(0, actual - standard));
    const workDate = clean(line.work_date);

    if (!deptMap.has(departmentName)) {
      deptMap.set(departmentName, {
        department: departmentName,
        plannedMinutes: 0,
        completedStandardMinutes: 0,
        actualMinutes: 0,
        remainingMinutes: 0,
        overrunMinutes: 0,
        completionPct: 0,
        efficiencyPct: 0
      });
    }

    const dept = deptMap.get(departmentName);
    dept.actualMinutes += actual;
    dept.overrunMinutes += overrun;

    if (nature.toLowerCase() === "normal") {
      dept.completedStandardMinutes += standard;
    }

    const swKey = [
      departmentName.toLowerCase(),
      subworkName.toLowerCase()
    ].join("|");

    if (!subworkDoneMap.has(swKey)) {
      subworkDoneMap.set(swKey, {
        departmentCode: clean(line.department_code),
        departmentName,
        subworkCode: clean(line.subwork_code),
        subworkName,
        plannedMinutes: standard,
        completedStandardMinutes: 0,
        actualMinutes: 0,
        overrunMinutes: 0,
        lastWorkDate: "",
        status: "PENDING"
      });
    }

    const sw = subworkDoneMap.get(swKey);
    if (nature.toLowerCase() === "normal") {
      sw.completedStandardMinutes += standard;
    }
    sw.actualMinutes += actual;
    sw.overrunMinutes += overrun;
    if (workDate && workDate > sw.lastWorkDate) sw.lastWorkDate = workDate;
    sw.status = sw.plannedMinutes > 0 && sw.completedStandardMinutes >= sw.plannedMinutes ? "DONE" : "PARTIAL";

    const lineItem = {
      entryNo: clean(line.entry_no),
      lineNo: toNumber(line.line_no, 0),
      workDate,
      empCode: clean(line.emp_code),
      empName: clean(line.emp_name),
      department: departmentName,
      subwork: subworkName,
      workNature: nature,
      standardMinutes: standard,
      actualMinutes: actual,
      overrunMinutes: overrun,
      efficiencyReason: clean(line.efficiency_reason),
      description: clean(line.description),
      rootArea: clean(line.root_area)
    };

    completedWorks.push(lineItem);

    if (overrun > 0 || lineItem.efficiencyReason) {
      overrunDetails.push(lineItem);
    }

    if (nature.toLowerCase() === "rework" || nature.toLowerCase() === "other") {
      reworkOtherDetails.push(lineItem);
    }
  });

  const departments = Array.from(deptMap.values()).map((d) => {
    d.remainingMinutes = Math.max(0, d.plannedMinutes - d.completedStandardMinutes);

    d.completionPct = d.plannedMinutes > 0
      ? Number(Math.min(100, (d.completedStandardMinutes / d.plannedMinutes) * 100).toFixed(1))
      : 0;

    d.efficiencyPct = d.actualMinutes > 0
      ? Number(((d.completedStandardMinutes / d.actualMinutes) * 100).toFixed(1))
      : 0;

    return {
      ...d,
      plannedHours: Number((d.plannedMinutes / 60).toFixed(2)),
      completedStandardHours: Number((d.completedStandardMinutes / 60).toFixed(2)),
      actualHours: Number((d.actualMinutes / 60).toFixed(2)),
      remainingHours: Number((d.remainingMinutes / 60).toFixed(2)),
      overrunHours: Number((d.overrunMinutes / 60).toFixed(2))
    };
  }).sort((a, b) => a.department.localeCompare(b.department));

  const allSubworks = Array.from(subworkDoneMap.values()).map((x) => {
    const remainingMinutes = Math.max(0, x.plannedMinutes - x.completedStandardMinutes);
    const completionPct = x.plannedMinutes > 0
      ? Number(Math.min(100, (x.completedStandardMinutes / x.plannedMinutes) * 100).toFixed(1))
      : 0;

    return {
      ...x,
      remainingMinutes,
      completionPct,
      plannedHours: Number((x.plannedMinutes / 60).toFixed(2)),
      completedStandardHours: Number((x.completedStandardMinutes / 60).toFixed(2)),
      actualHours: Number((x.actualMinutes / 60).toFixed(2)),
      remainingHours: Number((remainingMinutes / 60).toFixed(2)),
      overrunHours: Number((x.overrunMinutes / 60).toFixed(2)),
      status: remainingMinutes <= 0 && x.plannedMinutes > 0 ? "DONE" : x.completedStandardMinutes > 0 ? "PARTIAL" : "PENDING"
    };
  });

  const remainingWork = allSubworks
    .filter((x) => x.status !== "DONE")
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.subworkName.localeCompare(b.subworkName));

  const completedWork = allSubworks
    .filter((x) => x.status === "DONE")
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.subworkName.localeCompare(b.subworkName));

   // Booking point checklist = planned master booking_points + booking_status overlay.
  const latestBookingStatusByPoint = new Map();

  bookingStatus.forEach((bp) => {
    const dept = getDepartmentDisplayName(bp.department_code || bp.department_name, bp.department_name);
    const subwork = clean(bp.subwork_name || bp.subwork_code);
    const point = clean(bp.point_name || bp.point_code || bp.point);

    if (!point) return;

    const key = [
      dept,
      subwork,
      point
    ].join("|").toLowerCase();

    latestBookingStatusByPoint.set(key, bp);
  });

  const plannedBookingMap = new Map();

  bookingPoints.forEach((bp) => {
    if (bp.active === false) return;
    if (clean(bp.machine_type_code) !== machineTypeCode) return;

    const dept = getDepartmentDisplayName(bp.department_code || bp.department_name, bp.department_name);
    const subwork = clean(bp.subwork_name || bp.subwork_code);
    const point = clean(bp.point_name || bp.point_code || bp.name || bp.point);

    if (!point) return;

    const key = [
      dept,
      subwork,
      point
    ].join("|").toLowerCase();

    plannedBookingMap.set(key, {
      department: dept,
      subwork,
      point,
      standardMinutes: toNumber(bp.standard_time || bp.standard_minutes, 0)
    });
  });

  // Keep old/touched booking records even if master point was later changed.
  latestBookingStatusByPoint.forEach((bp, key) => {
    if (plannedBookingMap.has(key)) return;

    const dept = getDepartmentDisplayName(bp.department_code || bp.department_name, bp.department_name);
    const subwork = clean(bp.subwork_name || bp.subwork_code);
    const point = clean(bp.point_name || bp.point_code || bp.point);

    plannedBookingMap.set(key, {
      department: dept,
      subwork,
      point,
      standardMinutes: toNumber(bp.standard_minutes, 0)
    });
  });

  const bookingPointsStatus = Array.from(plannedBookingMap.entries()).map(([key, planned]) => {
    const bp = latestBookingStatusByPoint.get(key) || null;

    const standardMinutes = toNumber(bp?.standard_minutes, planned.standardMinutes);
    const consumedMinutes = toNumber(bp?.consumed_minutes, 0);
    const remainingMinutes = bp
      ? toNumber(bp.remaining_minutes, Math.max(0, standardMinutes - consumedMinutes))
      : standardMinutes;

    let status = clean(bp?.status || "");
    if (!status) {
      status = remainingMinutes <= 0 && standardMinutes > 0
        ? "DONE"
        : consumedMinutes > 0
          ? "PARTIAL"
          : "PENDING";
    }

    return {
      department: planned.department,
      subwork: planned.subwork,
      point: planned.point,
      standardMinutes,
      consumedMinutes,
      remainingMinutes,
      completionPct: standardMinutes > 0
        ? Number(Math.min(100, (consumedMinutes / standardMinutes) * 100).toFixed(1))
        : 0,
      status,
      lastWorkDate: clean(bp?.last_work_date),
      lastEmpCode: clean(bp?.last_emp_code),
      lastEmpName: clean(bp?.last_emp_name)
    };
  }).sort((a, b) =>
    a.department.localeCompare(b.department) ||
    a.subwork.localeCompare(b.subwork) ||
    a.point.localeCompare(b.point)
  );
  // Quality checklist = planned master quality_points + latest quality_logs overlay.
  const latestQualityByPoint = new Map();

  qualityLogs.forEach((q) => {
    const dept = getDepartmentDisplayName(q.department_code || q.department_name, q.department_name);
    const subwork = clean(q.subwork_name || q.subwork_code);
    const point = clean(q.point_name || q.point_code);

    const key = [
      dept,
      subwork,
      point
    ].join("|").toLowerCase();

    const existing = latestQualityByPoint.get(key);
    const currentTime = clean(q.updated || q.created || q.work_date);
    const existingTime = clean(existing?.updated || existing?.created || existing?.work_date);

    if (!existing || currentTime >= existingTime) {
      latestQualityByPoint.set(key, q);
    }
  });

  const plannedQualityMap = new Map();

  qualityPoints.forEach((qp) => {
    if (qp.active === false) return;
    if (clean(qp.machine_type_code) !== machineTypeCode) return;

    const dept = getDepartmentDisplayName(qp.department_code || qp.department_name, qp.department_name);
    const subwork = clean(qp.subwork_name || qp.subwork_code);
    const point = clean(qp.point_name || qp.point_code);

    if (!point) return;

    const key = [
      dept,
      subwork,
      point
    ].join("|").toLowerCase();

    plannedQualityMap.set(key, {
      department: dept,
      subwork,
      point,
      inputType: clean(qp.input_type || "status"),
      mandatory: qp.mandatory === true
    });
  });

  // Include any logged point even if it was not found in master, so old records are not hidden.
  latestQualityByPoint.forEach((q, key) => {
    if (plannedQualityMap.has(key)) return;

    const dept = getDepartmentDisplayName(q.department_code || q.department_name, q.department_name);
    const subwork = clean(q.subwork_name || q.subwork_code);
    const point = clean(q.point_name || q.point_code);

    plannedQualityMap.set(key, {
      department: dept,
      subwork,
      point,
      inputType: clean(q.input_type || "status"),
      mandatory: false
    });
  });

  const qualityStatus = Array.from(plannedQualityMap.entries()).map(([key, planned]) => {
    const q = latestQualityByPoint.get(key) || null;

    const value = clean(q?.value || q?.status);
    const rawStatus = clean(q?.status);
    const upperValue = value.toUpperCase();
    const upperStatus = rawStatus.toUpperCase();

    let status = "PENDING";

    if (q && value) {
      status = "DONE";
    }

    if (upperValue.includes("NOT OK") || upperStatus.includes("NOT OK")) {
      status = "NOT OK";
    }

    return {
      department: planned.department,
      subwork: planned.subwork,
      point: planned.point,
      inputType: planned.inputType,
      mandatory: planned.mandatory,
      value: value || "",
      status,
      workDate: clean(q?.work_date),
      empCode: clean(q?.emp_code),
      empName: clean(q?.emp_name),
      isRecheck: q?.is_recheck === true
    };
  }).sort((a, b) =>
    a.department.localeCompare(b.department) ||
    a.subwork.localeCompare(b.subwork) ||
    a.point.localeCompare(b.point)
  );

  return {
    machine: {
      machineNo,
      machineCategory,
      machineTypeCode,
      status: clean(machine.status || machineSummary?.status || "Active")
    },
    summary: machineSummary,
    departments,
    remainingWork,
    completedWork,
    completedEntries: completedWorks,
    bookingPoints: bookingPointsStatus,
    qualityStatus,
    overrunDetails,
    reworkOtherDetails,
    meta: {
      source: "pocketbase",
      generatedAt: new Date().toISOString(),
      counts: {
        departments: departments.length,
        remainingWork: remainingWork.length,
        completedWork: completedWork.length,
        completedEntries: completedWorks.length,
        bookingPoints: bookingPointsStatus.length,
        qualityPoints: qualityPoints.length,
        qualityStatus: qualityStatus.length,
        overrunDetails: overrunDetails.length,
        reworkOtherDetails: reworkOtherDetails.length
      }
    }
  };
}
function toDateOnly(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLossDateRange(params = {}) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const customFrom = clean(params.from || params.startDate || "");
  const customTo = clean(params.to || params.endDate || "");

  if (customFrom && customTo) {
    return {
      from: customFrom,
      to: customTo,
      label: `${customFrom} to ${customTo}`
    };
  }

  const range = clean(params.range || "currentMonth").toLowerCase();

  if (range === "lastmonth") {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return {
      from: toDateOnly(start),
      to: toDateOnly(end),
      label: "Last Month"
    };
  }

  if (range === "last6months") {
    const start = new Date(year, month - 5, 1);
    const end = today;
    return {
      from: toDateOnly(start),
      to: toDateOnly(end),
      label: "Last 6 Months"
    };
  }

  if (range === "year") {
    const start = new Date(year, 0, 1);
    const end = today;
    return {
      from: toDateOnly(start),
      to: toDateOnly(end),
      label: "Current Year"
    };
  }

  const start = new Date(year, month, 1);
  const end = today;

  return {
    from: toDateOnly(start),
    to: toDateOnly(end),
    label: "Current Month"
  };
}

function addGroupedMinutes(map, key, minutes, extra = {}) {
  const cleanKey = clean(key || "Not Specified") || "Not Specified";

  if (!map.has(cleanKey)) {
    map.set(cleanKey, {
      name: cleanKey,
      minutes: 0,
      count: 0,
      ...extra
    });
  }

  const item = map.get(cleanKey);
  item.minutes += toNumber(minutes, 0);
  item.count += 1;

  return item;
}

function mapGroupToList(map) {
  return Array.from(map.values())
    .map((x) => ({
      ...x,
      hours: Number((toNumber(x.minutes, 0) / 60).toFixed(2))
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

async function getLossSummary(params = {}) {
  const range = getLossDateRange(params);

  const from = range.from;
  const to = range.to;

  const dateFilter = [
    `work_date>="${from}"`,
    `work_date<="${to}"`
  ].join(" && ");

  const [entries, lines] = await Promise.all([
    listAll("production_entries", {
      perPage: 1000,
      filter: dateFilter,
      sort: "-work_date"
    }),
    listAll("production_entry_lines", {
      perPage: 1000,
      filter: dateFilter,
      sort: "-work_date"
    })
  ]);

  const reworkByRootArea = new Map();
  const reworkByMachine = new Map();
  const reworkByDepartment = new Map();

  const otherByDescription = new Map();
  const otherByMachine = new Map();
  const otherByDepartment = new Map();

  const majorLossByReason = new Map();
  const majorLossByEmployee = new Map();
  const majorLossByDate = new Map();

  const detailRows = [];

  let reworkMinutes = 0;
  let otherMinutes = 0;
  let majorLossMinutes = 0;

  lines.forEach((line) => {
    const nature = clean(line.work_nature || "Normal").toLowerCase();
    const actualMinutes = toNumber(line.actual_minutes, 0);

    if (nature !== "rework" && nature !== "other") return;

    const workDate = clean(line.work_date);
    const machineNo = clean(line.machine_no);
    const department = clean(line.department_name || line.department_code);
    const subwork = clean(line.subwork_name || line.subwork_code);
    const rootArea = clean(line.root_area || "Not Specified");
    const description = clean(line.description || line.efficiency_reason || subwork || "Not Specified");
    const empName = clean(line.emp_name || line.emp_code);

    const row = {
      source: "production_entry_lines",
      workDate,
      type: nature === "rework" ? "Rework" : "Other",
      machineNo,
      department,
      subwork,
      rootArea,
      reason: description,
      empName,
      minutes: actualMinutes,
      hours: Number((actualMinutes / 60).toFixed(2)),
      entryNo: clean(line.entry_no)
    };

    detailRows.push(row);

    if (nature === "rework") {
      reworkMinutes += actualMinutes;
      addGroupedMinutes(reworkByRootArea, rootArea, actualMinutes);
      addGroupedMinutes(reworkByMachine, machineNo, actualMinutes);
      addGroupedMinutes(reworkByDepartment, department, actualMinutes);
    }

    if (nature === "other") {
      otherMinutes += actualMinutes;
      addGroupedMinutes(otherByDescription, description, actualMinutes);
      addGroupedMinutes(otherByMachine, machineNo, actualMinutes);
      addGroupedMinutes(otherByDepartment, department, actualMinutes);
    }
  });

  entries.forEach((entry) => {
    const minutes = toNumber(entry.major_loss_minutes, 0);
    const reason = clean(entry.major_loss_reason || "Not Specified");

    if (minutes <= 0 && !reason) return;
    if (minutes <= 0) return;

    const workDate = clean(entry.work_date);
    const empName = clean(entry.emp_name || entry.emp_code);

    majorLossMinutes += minutes;

    addGroupedMinutes(majorLossByReason, reason, minutes);
    addGroupedMinutes(majorLossByEmployee, empName, minutes);
    addGroupedMinutes(majorLossByDate, workDate, minutes);

    detailRows.push({
      source: "production_entries",
      workDate,
      type: "Major Loss",
      machineNo: "-",
      department: "-",
      subwork: "-",
      rootArea: "-",
      reason,
      empName,
      minutes,
      hours: Number((minutes / 60).toFixed(2)),
      entryNo: clean(entry.entry_no)
    });
  });

  detailRows.sort((a, b) => {
    if (a.workDate !== b.workDate) return b.workDate.localeCompare(a.workDate);
    return b.minutes - a.minutes;
  });

  const totalLossMinutes = reworkMinutes + otherMinutes + majorLossMinutes;

  return {
    range,
    summary: {
      reworkMinutes,
      reworkHours: Number((reworkMinutes / 60).toFixed(2)),
      otherMinutes,
      otherHours: Number((otherMinutes / 60).toFixed(2)),
      majorLossMinutes,
      majorLossHours: Number((majorLossMinutes / 60).toFixed(2)),
      totalLossMinutes,
      totalLossHours: Number((totalLossMinutes / 60).toFixed(2)),
      detailCount: detailRows.length
    },
    rework: {
      byRootArea: mapGroupToList(reworkByRootArea),
      byMachine: mapGroupToList(reworkByMachine),
      byDepartment: mapGroupToList(reworkByDepartment)
    },
    other: {
      byDescription: mapGroupToList(otherByDescription),
      byMachine: mapGroupToList(otherByMachine),
      byDepartment: mapGroupToList(otherByDepartment)
    },
    majorLoss: {
      byReason: mapGroupToList(majorLossByReason),
      byEmployee: mapGroupToList(majorLossByEmployee),
      byDate: mapGroupToList(majorLossByDate)
    },
    details: detailRows,
    meta: {
      source: "pocketbase",
      generatedAt: new Date().toISOString(),
      counts: {
        entries: entries.length,
        lines: lines.length,
        details: detailRows.length
      }
    }
  };
}

module.exports = {
  getMachineSummary,
  getMachineDetail,
  getLossSummary
};