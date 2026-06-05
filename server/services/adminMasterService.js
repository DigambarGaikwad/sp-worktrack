// server/services/adminMasterService.js
// Builds frontend-compatible adminOverrides-style master data from PocketBase.
// Goal: minimum frontend rewrite by returning data in the same shape used by old app.js applyOverrides().

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeBool(value, defaultValue = true) {
  if (value === false) return false;
  if (value === true) return true;

  const text = String(value ?? "").trim().toLowerCase();

  if (text === "false" || text === "0" || text === "no" || text === "inactive") return false;
  if (text === "true" || text === "1" || text === "yes" || text === "active") return true;

  return defaultValue;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isDeletedMachine(record) {
  return clean(record.status).toLowerCase() === "deleted";
}

function isDeletedEmployee(record) {
  return clean(record.designation) === "__DELETED__";
}

async function listAll(collectionName) {
  const all = [];
  let page = 1;
  const perPage = 500;

  while (true) {
    try {
      const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
        method: "GET",
        query: {
          page,
          perPage
        }
      });

      const items = Array.isArray(result.items) ? result.items : [];
      all.push(...items);

      const totalPages = Number(result.totalPages || 1);
      if (page >= totalPages) break;

      page += 1;
    } catch (err) {
      console.error(`Failed to list PocketBase collection: ${collectionName}`);
      throw err;
    }
  }

  return all;
}

function sortByText(list, fieldName) {
  return [...list].sort((a, b) => clean(a[fieldName]).localeCompare(clean(b[fieldName])));
}

function buildMachineTypes(records) {
  return sortByText(records, "type_code")
    .filter((x) => normalizeBool(x.active, true))
    .map((x) => ({
      id: clean(x.type_code),
      name: clean(x.type_name)
    }))
    .filter((x) => x.id && x.name);
}

function buildMachines(records) {
  return sortByText(records, "machine_no")
    .filter((x) => !isDeletedMachine(x))
    .map((x) => ({
      id: x.id,
      name: clean(x.machine_no),
      type: clean(x.machine_type_code),
      active: normalizeBool(x.active, true),
      status: clean(x.status || (normalizeBool(x.active, true) ? "Active" : "Inactive"))
    }))
    .filter((x) => x.name);
}

function buildEmployees(records) {
  return sortByText(records, "emp_code")
    .filter((x) => !isDeletedEmployee(x))
    .map((x) => ({
      id: x.id,
      empId: clean(x.emp_code),
      name: clean(x.full_name),
      department: clean(x.department),
      designation: clean(x.designation),
      availableMinutesDay: num(x.available_minutes_day, 0),
      active: normalizeBool(x.active, true)
    }))
    .filter((x) => x.empId && x.name);
}

function buildShifts(records) {
  return sortByText(records, "shift_name")
    .map((x) => ({
      id: clean(x.shift_code),
      name: clean(x.shift_name),
      start: clean(x.start_time),
      end: clean(x.end_time),
      breakMinutes: Number(x.break_minutes || 0) || 0,
      flexible: normalizeBool(x.flexible, false),
      active: normalizeBool(x.active, true)
    }))
    .filter((x) => x.id && x.name);
}

function buildDepartments(records) {
  return sortByText(records, "department_name")
    .filter((x) => normalizeBool(x.active, true))
    .map((x) => clean(x.department_name))
    .filter(Boolean);
}

function buildLossReasons(records) {
  return sortByText(records, "reason_name")
    .filter((x) => normalizeBool(x.active, true))
    .map((x) => clean(x.reason_name))
    .filter(Boolean);
}

function buildRootAreas(records) {
  return sortByText(records, "area_name")
    .filter((x) => normalizeBool(x.active, true))
    .map((x) => clean(x.area_name))
    .filter(Boolean);
}

function buildBookingPointMap(records) {
  const map = new Map();

  records
    .filter((x) => normalizeBool(x.active, true))
    .forEach((x) => {
      const key = [
        clean(x.machine_type_code),
        clean(x.department_code),
        clean(x.subwork_code)
      ].join("|");

      if (!map.has(key)) map.set(key, []);

      map.get(key).push({
        name: clean(x.point_name),
        standardTime: Number(x.standard_time || 0) || 0,
        sequenceNo: Number(x.sequence_no || 0) || 0
      });
    });

  map.forEach((items, key) => {
    items.sort((a, b) => a.sequenceNo - b.sequenceNo || a.name.localeCompare(b.name));
    map.set(
      key,
      items
        .map((x) => ({
          name: x.name,
          standardTime: x.standardTime
        }))
        .filter((x) => x.name)
    );
  });

  return map;
}

function buildQualityPointMap(records) {
  const map = new Map();

  records
    .filter((x) => normalizeBool(x.active, true))
    .forEach((x) => {
      const key = [
        clean(x.machine_type_code),
        clean(x.department_code),
        clean(x.subwork_code)
      ].join("|");

      if (!map.has(key)) map.set(key, []);

      map.get(key).push({
        name: clean(x.point_name),
        inputType: clean(x.input_type) === "reading" ? "reading" : "status",
        mandatory: normalizeBool(x.mandatory, false),
        sequenceNo: Number(x.sequence_no || 0) || 0
      });
    });

  map.forEach((items, key) => {
    items.sort((a, b) => a.sequenceNo - b.sequenceNo || a.name.localeCompare(b.name));
    map.set(
      key,
      items
        .map((x) => ({
          name: x.name,
          inputType: x.inputType,
          mandatory: x.mandatory
        }))
        .filter((x) => x.name)
    );
  });

  return map;
}

function buildWorkCatalogByType(machineTypes, departments, subworks, bookingPoints, qualityPoints) {
  const bookingMap = buildBookingPointMap(bookingPoints);
  const qualityMap = buildQualityPointMap(qualityPoints);

  const activeDeptNameByCode = new Map(
    departments
      .filter((x) => normalizeBool(x.active, true))
      .map((x) => [clean(x.department_code), clean(x.department_name)])
  );

  const byType = {};

  machineTypes.forEach((type) => {
    byType[type.id] = { mainWorks: [], subWorks: {} };
  });

  subworks
    .filter((x) => normalizeBool(x.active, true))
    .forEach((x) => {
      const typeCode = clean(x.machine_type_code);
      const deptCode = clean(x.department_code);
      const deptName = activeDeptNameByCode.get(deptCode) || deptCode;
      const subworkName = clean(x.subwork_name);

      if (!typeCode || !deptName || !subworkName) return;
      if (!byType[typeCode]) byType[typeCode] = { mainWorks: [], subWorks: {} };
      if (!byType[typeCode].mainWorks.includes(deptName)) byType[typeCode].mainWorks.push(deptName);
      if (!byType[typeCode].subWorks[deptName]) byType[typeCode].subWorks[deptName] = [];

      const key = [typeCode, deptCode, clean(x.subwork_code)].join("|");
      byType[typeCode].subWorks[deptName].push({
        name: subworkName,
        standardTime: Number(x.standard_time || 0) || 0,
        checkpoints: bookingMap.get(key) || [],
        qualityCheckpoints: qualityMap.get(key) || []
      });
    });

  Object.values(byType).forEach((catalog) => {
    catalog.mainWorks = Array.from(new Set(catalog.mainWorks.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    Object.keys(catalog.subWorks).forEach((dept) => {
      catalog.subWorks[dept] = Array.from(new Map(
        catalog.subWorks[dept]
          .filter((x) => clean(x.name))
          .map((x) => [clean(x.name), x])
      ).values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  return byType;
}

async function getAdminMasterData() {
  const [machineTypesRaw, machinesRaw, employeesRaw, shiftsRaw, departmentsRaw, subworksRaw, bookingPointsRaw, qualityPointsRaw, lossReasonsRaw, rootAreasRaw] = await Promise.all([
    listAll("machine_types"),
    listAll("machines"),
    listAll("employees"),
    listAll("shifts"),
    listAll("departments"),
    listAll("subworks"),
    listAll("booking_points"),
    listAll("quality_points"),
    listAll("loss_reasons"),
    listAll("root_areas")
  ]);

  const machineTypes = buildMachineTypes(machineTypesRaw);
  const departments = buildDepartments(departmentsRaw);

  return {
    admin: { pin: "1234" },
    machineTypes,
    machines: buildMachines(machinesRaw),
    employees: buildEmployees(employeesRaw),
    shifts: buildShifts(shiftsRaw),
    mainWorks: departments,
    subWorks: {},
    workCatalogByType: buildWorkCatalogByType(machineTypes, departmentsRaw, subworksRaw, bookingPointsRaw, qualityPointsRaw),
    lossReasons: buildLossReasons(lossReasonsRaw),
    rootAreas: buildRootAreas(rootAreasRaw),
    meta: {
      source: "pocketbase",
      generatedAt: new Date().toISOString()
    }
  };
}

module.exports = { getAdminMasterData };
