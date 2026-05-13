// server/services/adminWriteService.js
// SP WorkTrack DB Edition - Admin write service
// Saves admin screen master data into PocketBase using safe upsert logic.
// It does not delete missing masters automatically.

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

function bool(value, defaultValue = true) {
  if (value === true || value === false) return value;
  const text = clean(value).toLowerCase();
  if (["false", "0", "no", "inactive", "completed"].includes(text)) return false;
  if (["true", "1", "yes", "active"].includes(text)) return true;
  return defaultValue;
}

function num(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function pbEscape(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context/i.test(String(err?.message || ""));
}

function plannedAbsenceCollectionMissingError() {
  const err = new Error("PocketBase collection planned_absences is missing. Create it before saving planned absences.");
  err.status = 400;
  err.details = {
    reasonCode: "PLANNED_ABSENCES_COLLECTION_MISSING",
    collection: "planned_absences",
    requiredFields: [
      "emp_code",
      "emp_name",
      "department",
      "from_date",
      "to_date",
      "reason",
      "remark",
      "status"
    ]
  };
  return err;
}

async function listAll(collectionName, options = {}) {
  const all = [];
  let page = 1;
  const perPage = options.perPage || 500;

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

async function findOne(collectionName, filter) {
  const items = await listAll(collectionName, { perPage: 1, filter });
  return items[0] || null;
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

async function deleteRecord(collectionName, id) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records/${id}`, {
    method: "DELETE"
  });
}

async function upsertByFilter(collectionName, filter, body) {
  const existing = await findOne(collectionName, filter);
  if (existing?.id) return updateRecord(collectionName, existing.id, body);
  return createRecord(collectionName, body);
}

function normalizeNameList(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => {
      if (typeof x === "string") return clean(x);
      if (x && typeof x === "object") return clean(x.name || x.reason || x.label || x.value);
      return "";
    })
    .filter(Boolean);
}

function normalizeMachineTypes(data) {
  return (Array.isArray(data.machineTypes) ? data.machineTypes : [])
    .map((x) => ({
      type_code: clean(x.id || x.type_code || x.code || x.name),
      type_name: clean(x.name || x.type_name || x.id),
      active: bool(x.active, true)
    }))
    .filter((x) => x.type_code && x.type_name);
}

function normalizeMachines(data) {
  return (Array.isArray(data.machines) ? data.machines : [])
    .map((x) => ({
      machine_no: clean(x.name || x.machine_no || x.machineNo),
      machine_type_code: clean(x.type || x.machine_type_code || x.type_code),
      status: clean(x.status || (bool(x.active, true) ? "Active" : "Completed")),
      active: bool(x.active, clean(x.status).toLowerCase() !== "completed")
    }))
    .filter((x) => x.machine_no);
}

function normalizeEmployees(data) {
  return (Array.isArray(data.employees) ? data.employees : [])
    .map((x) => ({
      emp_code: clean(x.empId || x.emp_code || x.code),
      full_name: clean(x.name || x.full_name || x.emp_name),
      department: clean(x.department),
      designation: clean(x.designation),
      active: bool(x.active, true)
    }))
    .filter((x) => x.emp_code && x.full_name);
}

function normalizeShifts(data) {
  return (Array.isArray(data.shifts) ? data.shifts : [])
    .map((x) => ({
      shift_code: clean(x.id || x.shift_code || x.code || x.name),
      shift_name: clean(x.name || x.shift_name || x.id),
      start_time: clean(x.start || x.start_time),
      end_time: clean(x.end || x.end_time),
      break_minutes: num(x.breakMinutes ?? x.break_minutes, 0),
      flexible: bool(x.flexible, false),
      active: bool(x.active, true)
    }))
    .filter((x) => x.shift_code && x.shift_name);
}

function normalizeDepartments(data) {
  const fromMainWorks = normalizeNameList(data.mainWorks);
  const fromEmployees = normalizeEmployees(data).map((e) => e.department).filter(Boolean);
  const fromCatalog = [];

  Object.values(data.workCatalogByType || {}).forEach((catalog) => {
    (catalog.mainWorks || []).forEach((d) => fromCatalog.push(clean(d)));
    Object.keys(catalog.subWorks || {}).forEach((d) => fromCatalog.push(clean(d)));
  });

  return Array.from(new Set([...fromMainWorks, ...fromEmployees, ...fromCatalog].filter(Boolean)))
    .map((name) => ({
      department_code: slug(name),
      department_name: name,
      active: true
    }));
}

function normalizeSubworksAndPoints(data) {
  const subworks = [];
  const bookingPoints = [];
  const qualityPoints = [];
  const catalogByType = data.workCatalogByType || {};

  Object.entries(catalogByType).forEach(([typeCode, catalog]) => {
    Object.entries(catalog.subWorks || {}).forEach(([deptName, list]) => {
      const deptCode = slug(deptName);

      (Array.isArray(list) ? list : []).forEach((sw, swIndex) => {
        const subworkName = clean(sw.name || sw.subwork_name || sw);
        if (!typeCode || !deptName || !subworkName) return;

        const subworkCode = slug(subworkName);
        const standardTime = num(sw.standardTime ?? sw.standard_time, 0);

        subworks.push({
          machine_type_code: clean(typeCode),
          department_code: deptCode,
          subwork_code: subworkCode,
          subwork_name: subworkName,
          standard_time: standardTime,
          sequence_no: swIndex + 1,
          active: bool(sw.active, true)
        });

        (Array.isArray(sw.checkpoints) ? sw.checkpoints : []).forEach((bp, i) => {
          const pointName = clean(bp.name || bp.point_name || bp);
          if (!pointName) return;
          bookingPoints.push({
            machine_type_code: clean(typeCode),
            department_code: deptCode,
            subwork_code: subworkCode,
            point_code: slug(pointName),
            point_name: pointName,
            standard_time: num(bp.standardTime ?? bp.standard_time, 0),
            sequence_no: i + 1,
            active: bool(bp.active, true)
          });
        });

        (Array.isArray(sw.qualityCheckpoints) ? sw.qualityCheckpoints : []).forEach((qp, i) => {
          const pointName = clean(qp.name || qp.point_name || qp);
          if (!pointName) return;
          qualityPoints.push({
            machine_type_code: clean(typeCode),
            department_code: deptCode,
            subwork_code: subworkCode,
            point_code: slug(pointName),
            point_name: pointName,
            input_type: clean(qp.inputType || qp.input_type) === "reading" ? "reading" : "status",
            mandatory: bool(qp.mandatory, false),
            sequence_no: i + 1,
            active: bool(qp.active, true)
          });
        });
      });
    });
  });

  return { subworks, bookingPoints, qualityPoints };
}

async function saveAdminMasterData(rawData = {}) {
  const data = rawData.data || rawData.adminOverrides || rawData;
  const counts = {
    machineTypes: 0,
    machines: 0,
    employees: 0,
    shifts: 0,
    departments: 0,
    subworks: 0,
    bookingPoints: 0,
    qualityPoints: 0,
    lossReasons: 0,
    rootAreas: 0
  };

  for (const mt of normalizeMachineTypes(data)) {
    await upsertByFilter(
      "machine_types",
      `type_code="${pbEscape(mt.type_code)}"`,
      mt
    );
    counts.machineTypes += 1;
  }

  for (const m of normalizeMachines(data)) {
    await upsertByFilter(
      "machines",
      `machine_no="${pbEscape(m.machine_no)}"`,
      m
    );
    counts.machines += 1;
  }

  for (const e of normalizeEmployees(data)) {
    await upsertByFilter(
      "employees",
      `emp_code="${pbEscape(e.emp_code)}"`,
      e
    );
    counts.employees += 1;
  }

  for (const s of normalizeShifts(data)) {
    await upsertByFilter(
      "shifts",
      `shift_code="${pbEscape(s.shift_code)}"`,
      s
    );
    counts.shifts += 1;
  }

  for (const d of normalizeDepartments(data)) {
    await upsertByFilter(
      "departments",
      `department_code="${pbEscape(d.department_code)}"`,
      d
    );
    counts.departments += 1;
  }

  const { subworks, bookingPoints, qualityPoints } = normalizeSubworksAndPoints(data);

  for (const sw of subworks) {
    const filter = [
      `machine_type_code="${pbEscape(sw.machine_type_code)}"`,
      `department_code="${pbEscape(sw.department_code)}"`,
      `subwork_code="${pbEscape(sw.subwork_code)}"`
    ].join(" && ");
    await upsertByFilter("subworks", filter, sw);
    counts.subworks += 1;
  }

  for (const bp of bookingPoints) {
    const filter = [
      `machine_type_code="${pbEscape(bp.machine_type_code)}"`,
      `department_code="${pbEscape(bp.department_code)}"`,
      `subwork_code="${pbEscape(bp.subwork_code)}"`,
      `point_code="${pbEscape(bp.point_code)}"`
    ].join(" && ");
    await upsertByFilter("booking_points", filter, bp);
    counts.bookingPoints += 1;
  }

  for (const qp of qualityPoints) {
    const filter = [
      `machine_type_code="${pbEscape(qp.machine_type_code)}"`,
      `department_code="${pbEscape(qp.department_code)}"`,
      `subwork_code="${pbEscape(qp.subwork_code)}"`,
      `point_code="${pbEscape(qp.point_code)}"`
    ].join(" && ");
    await upsertByFilter("quality_points", filter, qp);
    counts.qualityPoints += 1;
  }

  for (const reason of normalizeNameList(data.lossReasons)) {
    await upsertByFilter(
      "loss_reasons",
      `reason_name="${pbEscape(reason)}"`,
      { reason_name: reason, active: true }
    );
    counts.lossReasons += 1;
  }

  for (const area of normalizeNameList(data.rootAreas)) {
    await upsertByFilter(
      "root_areas",
      `area_name="${pbEscape(area)}"`,
      { area_name: area, active: true }
    );
    counts.rootAreas += 1;
  }

  return {
    ok: true,
    mode: "upsert-only",
    message: "Admin master data saved to PocketBase.",
    counts
  };
}

function normalizePlannedAbsence(body = {}) {
  const status = clean(body.status || "Planned") || "Planned";
  return {
    emp_code: clean(body.emp_code || body.empCode || body.empId),
    emp_name: clean(body.emp_name || body.empName || body.employeeName),
    department: clean(body.department),
    from_date: clean(body.from_date || body.fromDate),
    to_date: clean(body.to_date || body.toDate || body.from_date || body.fromDate),
    reason: clean(body.reason),
    remark: clean(body.remark || body.remarks),
    status
  };
}

async function listPlannedAbsences(params = {}) {
  const status = clean(params.status || "");
  const filter = status ? `status="${pbEscape(status)}"` : "";

  try {
    return await listAll("planned_absences", { perPage: 500, sort: "-from_date", filter });
  } catch (err) {
    if (isMissingCollectionError(err)) return [];
    throw err;
  }
}

async function savePlannedAbsence(body = {}) {
  const data = normalizePlannedAbsence(body);
  if (!data.emp_code && !data.emp_name) throw new Error("Employee is required for planned absence.");
  if (!data.from_date) throw new Error("From date is required for planned absence.");
  if (!data.to_date) data.to_date = data.from_date;

  try {
    if (clean(body.id)) {
      return await updateRecord("planned_absences", clean(body.id), data);
    }

    return await createRecord("planned_absences", data);
  } catch (err) {
    if (isMissingCollectionError(err)) throw plannedAbsenceCollectionMissingError();
    throw err;
  }
}

async function deletePlannedAbsence(id) {
  if (!clean(id)) throw new Error("Planned absence ID is required.");

  try {
    return await deleteRecord("planned_absences", clean(id));
  } catch (err) {
    if (isMissingCollectionError(err)) throw plannedAbsenceCollectionMissingError();
    throw err;
  }
}

module.exports = {
  saveAdminMasterData,
  listPlannedAbsences,
  savePlannedAbsence,
  deletePlannedAbsence
};
