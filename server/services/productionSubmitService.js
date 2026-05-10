// server/services/productionSubmitService.js
// SP WorkTrack DB Edition - Production submit service
// Saves production entry data into PocketBase transaction collections.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) {
  return String(value ?? "").trim();
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function getYearFromWorkDate(workDate) {
  const text = clean(workDate);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return Number(text.slice(0, 4));
  }

  const match = text.match(/(\d{4})/);
  if (match) return Number(match[1]);

  return new Date().getFullYear();
}

function createEntryNo(payload) {
  const empCode = clean(payload.empCode || payload.empId || payload.employeeId || "EMP");
  const workDate = clean(payload.workDate || new Date().toISOString().slice(0, 10)).replace(/[^0-9]/g, "");
  const stamp = Date.now();

  return `SPWT-${workDate}-${empCode}-${stamp}`;
}

function recordKey(...parts) {
  return parts.map((p) => clean(p).toLowerCase()).join("|");
}

async function pocketBaseList(collectionName, query = {}) {
  const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
    method: "GET",
    query: {
      page: query.page || 1,
      perPage: query.perPage || 50,
      filter: query.filter || ""
    }
  });

  return Array.isArray(result.items) ? result.items : [];
}

async function createRecord(collectionName, body) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, {
    method: "POST",
    body
  });
}

async function updateRecord(collectionName, id, body) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, {
    method: "PATCH",
    body
  });
}

function pbEscape(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function findOneByFilter(collectionName, filter) {
  const items = await pocketBaseList(collectionName, {
    page: 1,
    perPage: 1,
    filter
  });

  return items[0] || null;
}

function normalizeWorkLines(payload) {
  const rawLines =
    payload.lines ||
    payload.workLines ||
    payload.workCards ||
    payload.works ||
    payload.entries ||
    [];

  if (!Array.isArray(rawLines)) return [];

  return rawLines;
}

function getPayloadEmpCode(payload) {
  return clean(payload.empCode || payload.empId || payload.employeeId);
}

function getPayloadEmpName(payload) {
  return clean(payload.empName || payload.employeeName);
}

function getShiftCode(payload) {
  return clean(payload.shiftCode || payload.shiftId || payload.shift);
}

function getShiftName(payload) {
  return clean(payload.shiftName || payload.shift);
}

function getLineMachineNo(line) {
  return clean(line.machine || line.machineNo || line.machine_no);
}

function getLineMachineTypeCode(line) {
  return clean(line.machineTypeCode || line.machine_type_code || line.machineType);
}

function getLineMachineCategory(line) {
  return clean(line.machineCategory || line.machine_category);
}

function getLineDepartmentName(line) {
  return clean(line.department || line.departmentName || line.department_name);
}

function getLineDepartmentCode(line) {
  return clean(line.departmentCode || line.department_code || slug(getLineDepartmentName(line)));
}

function getLineSubworkName(line) {
  return clean(line.subWork || line.subwork || line.subworkName || line.subwork_name);
}

function getLineSubworkCode(line) {
  return clean(line.subworkCode || line.subwork_code || slug(getLineSubworkName(line)));
}

function getLineWorkNature(line) {
  return clean(line.type || line.workNature || line.work_nature || "Normal");
}

function getBookingPoints(line) {
  const raw = line.workCheckpoints || line.bookingPoints || line.booking_points || [];
  return Array.isArray(raw) ? raw : [];
}

function getQualityPoints(line) {
  const raw = line.qualityCheckpoints || line.qualityPoints || line.quality_points || [];
  return Array.isArray(raw) ? raw : [];
}

function buildHeader(payload, entryNo, lines) {
  const workDate = clean(payload.workDate);
  const workYear = getYearFromWorkDate(workDate);

  const totalStandard = lines.reduce((sum, x) => {
    return sum + toNumber(x.standardTime ?? x.standardMinutes ?? x.standard_minutes, 0);
  }, 0);

  const totalActual = lines.reduce((sum, x) => {
    return sum + toNumber(x.actualTime ?? x.actualMinutes ?? x.actual_minutes, 0);
  }, 0);

  const shiftAvailable = toNumber(
    payload.shiftAvailable ??
    payload.shiftAvailableMinutes ??
    payload.shift_available,
    0
  );

  const remaining = Math.max(0, shiftAvailable - totalActual);
  const productivity = shiftAvailable > 0 ? (totalStandard / shiftAvailable) * 100 : 0;

  return {
    entry_no: entryNo,
    work_date: workDate,
    work_year: workYear,

    shift_code: getShiftCode(payload),
    shift_name: getShiftName(payload),
    shift_start: clean(payload.shiftStart || payload.shift_start),
    shift_end: clean(payload.shiftEnd || payload.shift_end),
    break_minutes: toNumber(payload.breakMinutes || payload.break_minutes, 0),
    flexible_shift_minutes: toNumber(payload.flexibleShiftMinutes || payload.flexible_shift_minutes, 0),

    work_type: clean(payload.workType || payload.work_type || "Normal"),

    emp_code: getPayloadEmpCode(payload),
    emp_name: getPayloadEmpName(payload),

    gross_shift_available: toNumber(payload.grossShiftAvailable || payload.gross_shift_available, shiftAvailable),
    major_loss_reason: clean(payload.majorLossReason || payload.major_loss_reason || payload.lossReason),
    major_loss_minutes: toNumber(payload.majorLossMinutes || payload.major_loss_minutes || payload.lossMinutes, 0),
    shift_available: shiftAvailable,

    total_standard_minutes: totalStandard,
    total_actual_minutes: totalActual,
    remaining_minutes: remaining,
    productivity_percent: Number(productivity.toFixed(2)),

    source: clean(payload.source || "electron-db"),
    status: "SUBMITTED",
    remarks: clean(payload.remarks || "")
  };
}

function buildLine(payload, entryNo, line, index) {
  const workDate = clean(payload.workDate);
  const workYear = getYearFromWorkDate(workDate);

  const standardMinutes = toNumber(line.standardTime ?? line.standardMinutes ?? line.standard_minutes, 0);
  const actualMinutes = toNumber(line.actualTime ?? line.actualMinutes ?? line.actual_minutes, 0);

  return {
    entry_no: entryNo,
    line_no: index + 1,

    work_date: workDate,
    work_year: workYear,

    emp_code: getPayloadEmpCode(payload),
    emp_name: getPayloadEmpName(payload),

    machine_no: getLineMachineNo(line),
    machine_type_code: getLineMachineTypeCode(line),
    machine_category: getLineMachineCategory(line),

    department_code: getLineDepartmentCode(line),
    department_name: getLineDepartmentName(line),

    subwork_code: getLineSubworkCode(line),
    subwork_name: getLineSubworkName(line),

    work_nature: getLineWorkNature(line),
    description: clean(line.description),
    root_area: clean(line.rootArea || line.root_area),

    standard_minutes: standardMinutes,
    actual_minutes: actualMinutes,
    overrun_minutes: Math.max(0, actualMinutes - standardMinutes),
    efficiency_reason: clean(line.efficiencyReason || line.efficiency_reason),

    booking_points_json: getBookingPoints(line),
    quality_points_json: getQualityPoints(line)
  };
}

async function upsertBookingStatus(payload, entryNo, line, bookingPoint, lineNo) {
  const workDate = clean(payload.workDate);
  const workYear = getYearFromWorkDate(workDate);

  const machineNo = getLineMachineNo(line);
  const machineTypeCode = getLineMachineTypeCode(line);
  const machineCategory = getLineMachineCategory(line);
  const departmentName = getLineDepartmentName(line);
  const departmentCode = getLineDepartmentCode(line);
  const subworkName = getLineSubworkName(line);
  const subworkCode = getLineSubworkCode(line);

  const pointName = clean(bookingPoint.name || bookingPoint.point || bookingPoint.pointName);
  const pointCode = clean(bookingPoint.pointCode || bookingPoint.point_code || slug(pointName));

  if (!pointName) return null;

  const originalMinutes = toNumber(
    bookingPoint.originalTime ??
    bookingPoint.originalMinutes ??
    bookingPoint.standardTime ??
    bookingPoint.standardMinutes,
    0
  );

  const bookedMinutes = toNumber(
    bookingPoint.bookedTime ??
    bookingPoint.bookedMinutes ??
    bookingPoint.standardTime ??
    bookingPoint.standardMinutes,
    0
  );

  const filter = [
    `machine_no="${pbEscape(machineNo)}"`,
    `department_name="${pbEscape(departmentName)}"`,
    `subwork_name="${pbEscape(subworkName)}"`,
    `point_name="${pbEscape(pointName)}"`
  ].join(" && ");

  const existing = await findOneByFilter("booking_status", filter);

  const consumedBefore = toNumber(existing?.consumed_minutes, 0);
  const standardMinutes = toNumber(existing?.standard_minutes, originalMinutes);
  const consumedAfter = consumedBefore + bookedMinutes;
  const remainingAfter = Math.max(0, standardMinutes - consumedAfter);
  const completionPercent = standardMinutes > 0
    ? Math.min(100, (consumedAfter / standardMinutes) * 100)
    : 0;

  const statusAfter = remainingAfter <= 0 ? "DONE" : consumedAfter > 0 ? "PARTIAL" : "PENDING";

  const statusBody = {
    machine_no: machineNo,
    machine_type_code: machineTypeCode,
    machine_category: machineCategory,

    department_code: departmentCode,
    department_name: departmentName,

    subwork_code: subworkCode,
    subwork_name: subworkName,

    point_code: pointCode,
    point_name: pointName,

    standard_minutes: standardMinutes,
    consumed_minutes: consumedAfter,
    remaining_minutes: remainingAfter,
    completion_percent: Number(completionPercent.toFixed(2)),
    status: statusAfter,

    last_entry_no: entryNo,
    last_work_date: workDate,
    last_emp_code: getPayloadEmpCode(payload),
    last_emp_name: getPayloadEmpName(payload)
  };

  if (existing?.id) {
    await updateRecord("booking_status", existing.id, statusBody);
  } else {
    await createRecord("booking_status", statusBody);
  }

  const logBody = {
    entry_no: entryNo,
    line_no: lineNo,

    work_date: workDate,
    work_year: workYear,

    emp_code: getPayloadEmpCode(payload),
    emp_name: getPayloadEmpName(payload),

    machine_no: machineNo,
    machine_type_code: machineTypeCode,
    machine_category: machineCategory,

    department_code: departmentCode,
    department_name: departmentName,

    subwork_code: subworkCode,
    subwork_name: subworkName,

    point_code: pointCode,
    point_name: pointName,

    original_minutes: standardMinutes,
    booked_minutes: bookedMinutes,
    consumed_before: consumedBefore,
    consumed_after: consumedAfter,
    remaining_after: remainingAfter,
    status_after: statusAfter
  };

  await createRecord("booking_logs", logBody);

  return {
    pointName,
    bookedMinutes,
    consumedAfter,
    remainingAfter,
    statusAfter
  };
}

async function saveQualityLogs(payload, entryNo, line, qualityPoints, lineNo) {
  const workDate = clean(payload.workDate);
  const workYear = getYearFromWorkDate(workDate);

  const created = [];

  for (const qp of qualityPoints) {
    const pointName = clean(qp.name || qp.point || qp.pointName);
    if (!pointName) continue;

    const inputType = clean(qp.inputType || qp.input_type || "status");
    const value = clean(qp.value || qp.reading || qp.status);
    const status = inputType === "reading" ? "" : value;

    const body = {
      entry_no: entryNo,
      line_no: lineNo,

      work_date: workDate,
      work_year: workYear,

      emp_code: getPayloadEmpCode(payload),
      emp_name: getPayloadEmpName(payload),

      machine_no: getLineMachineNo(line),
      machine_type_code: getLineMachineTypeCode(line),
      machine_category: getLineMachineCategory(line),

      department_code: getLineDepartmentCode(line),
      department_name: getLineDepartmentName(line),

      subwork_code: getLineSubworkCode(line),
      subwork_name: getLineSubworkName(line),

      point_code: clean(qp.pointCode || qp.point_code || slug(pointName)),
      point_name: pointName,
      input_type: inputType,
      value,
      status,
      is_recheck: qp.isRecheck === true || qp.recheck === true
    };

    const saved = await createRecord("quality_logs", body);
    created.push(saved);
  }

  return created;
}

async function upsertAttendance(payload, entryNo, header) {
  const attKey = recordKey(header.work_date, header.shift_code, header.emp_code);

  const filter = `att_key="${pbEscape(attKey)}"`;
  const existing = await findOneByFilter("attendance", filter);

  const body = {
    att_key: attKey,
    work_date: header.work_date,
    work_year: header.work_year,

    shift_code: header.shift_code,
    shift_name: header.shift_name,

    emp_code: header.emp_code,
    emp_name: header.emp_name,

    status: "Present",
    shift_available: header.shift_available,
    utilized_minutes: header.total_actual_minutes,
    source_entry_no: entryNo,
    remarks: ""
  };

  if (existing?.id) {
    return updateRecord("attendance", existing.id, body);
  }

  return createRecord("attendance", body);
}

async function submitProduction(payload) {
  const lines = normalizeWorkLines(payload);

  if (!clean(payload.workDate)) {
    throw new Error("Work date is required.");
  }

  if (!getPayloadEmpCode(payload)) {
    throw new Error("Employee code is required.");
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("At least one work line is required.");
  }

  const entryNo = createEntryNo(payload);
  const header = buildHeader(payload, entryNo, lines);

  const createdHeader = await createRecord("production_entries", header);

  const createdLines = [];
  let bookingLogCount = 0;
  let bookingStatusTouched = 0;
  let qualityLogCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    const lineBody = buildLine(payload, entryNo, line, i);
    const createdLine = await createRecord("production_entry_lines", lineBody);
    createdLines.push(createdLine);

    const bookingPoints = getBookingPoints(line);
    for (const bp of bookingPoints) {
      const result = await upsertBookingStatus(payload, entryNo, line, bp, lineNo);
      if (result) {
        bookingLogCount += 1;
        bookingStatusTouched += 1;
      }
    }

    const qualityPoints = getQualityPoints(line);
    const savedQuality = await saveQualityLogs(payload, entryNo, line, qualityPoints, lineNo);
    qualityLogCount += savedQuality.length;
  }

  await upsertAttendance(payload, entryNo, header);

  return {
    ok: true,
    entryNo,
    headerId: createdHeader.id,
    lineCount: createdLines.length,
    bookingLogCount,
    bookingStatusTouched,
    qualityLogCount,
    attendance: "Present"
  };
}

async function getBookingStatus(params = {}) {
  const machine = clean(params.machine || params.machineNo || params.machine_no);
  const department = clean(params.department || params.departmentName || params.department_name);
  const subWork = clean(params.subWork || params.subwork || params.subworkName || params.subwork_name);

  if (!machine || !department || !subWork) {
    return [];
  }

  const filter = [
    `machine_no="${pbEscape(machine)}"`,
    `department_name="${pbEscape(department)}"`,
    `subwork_name="${pbEscape(subWork)}"`
  ].join(" && ");

  const items = await pocketBaseList("booking_status", {
    page: 1,
    perPage: 200,
    filter
  });

  return items.map((x) => ({
    point: clean(x.point_name),
    standardTime: toNumber(x.standard_minutes, 0),
    consumedTime: toNumber(x.consumed_minutes, 0),
    remainingTime: toNumber(x.remaining_minutes, 0),
    completionPct: toNumber(x.completion_percent, 0),
    status: clean(x.status || "PENDING"),
    lastWorkDate: clean(x.last_work_date),
    lastEmpCode: clean(x.last_emp_code),
    lastEmpName: clean(x.last_emp_name)
  })).filter(x => x.point);
}

async function getQualityStatus(params = {}) {
  const machine = clean(params.machine || params.machineNo || params.machine_no);
  const department = clean(params.department || params.departmentName || params.department_name);
  const subWork = clean(params.subWork || params.subwork || params.subworkName || params.subwork_name);

  if (!machine || !department || !subWork) {
    return [];
  }

  const filter = [
    `machine_no="${pbEscape(machine)}"`,
    `department_name="${pbEscape(department)}"`,
    `subwork_name="${pbEscape(subWork)}"`
  ].join(" && ");

  const logs = await pocketBaseList("quality_logs", {
    page: 1,
    perPage: 500,
    filter
  });

  // Keep latest record per quality point.
  // PocketBase returns unsorted here, so we use created/updated/date fallback by string comparison where available.
  const latestByPoint = new Map();

  logs.forEach((x) => {
    const point = clean(x.point_name);
    if (!point) return;

    const key = point.toLowerCase();
    const current = latestByPoint.get(key);

    const xTime = clean(x.updated || x.created || x.work_date);
    const cTime = clean(current?.updated || current?.created || current?.work_date);

    if (!current || xTime >= cTime) {
      latestByPoint.set(key, x);
    }
  });

  return Array.from(latestByPoint.values()).map((x) => ({
    point: clean(x.point_name),
    value: clean(x.value || x.status),
    status: clean(x.status),
    inputType: clean(x.input_type || "status"),
    date: clean(x.work_date),
    doneBy: clean(x.emp_name || x.emp_code),
    isRecheck: x.is_recheck === true
  })).filter(x => x.point);
}

module.exports = {
  submitProduction,
  getBookingStatus,
  getQualityStatus
};