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
    .map((x) => ({
      id: x.id,
      empId: clean(x.emp_code),
      name: clean(x.full_name),
      department: clean(x.department),
      designation: clean(x.designation),
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

  const deptNameByCode = new Map(
    departments.map((x) => [clean(x.department_code), clean(x.department_name)])
  );

  const catalog = {};

  machineTypes
    .filter((x) => normalizeBool(x.active, true))
    .forEach((mt) => {
      const typeCode = clean(mt.type_code);
      if (!typeCode) return;

      catalog[typeCode] = {
        mainWorks: [],
        subWorks: {}
      };
    });

  subworks
    .filter((x) => normalizeBool(x.active, true))
    .forEach((sw) => {
      const typeCode = clean(sw.machine_type_code);
      const deptCode = clean(sw.department_code);
      const subworkCode = clean(sw.subwork_code);

      if (!typeCode || !deptCode || !subworkCode) return;

      if (!catalog[typeCode]) {
        catalog[typeCode] = {
          mainWorks: [],
          subWorks: {}
        };
      }

      const deptName = deptNameByCode.get(deptCode) || deptCode;

      if (!catalog[typeCode].mainWorks.includes(deptName)) {
        catalog[typeCode].mainWorks.push(deptName);
      }

      if (!Array.isArray(catalog[typeCode].subWorks[deptName])) {
        catalog[typeCode].subWorks[deptName] = [];
      }

      const key = [typeCode, deptCode, subworkCode].join("|");

      catalog[typeCode].subWorks[deptName].push({
        name: clean(sw.subwork_name),
        standardTime: Number(sw.standard_time || 0) || 0,
        checkpoints: bookingMap.get(key) || [],
        qualityCheckpoints: qualityMap.get(key) || []
      });
    });

  Object.keys(catalog).forEach((typeCode) => {
    catalog[typeCode].mainWorks.sort((a, b) => a.localeCompare(b));

    Object.keys(catalog[typeCode].subWorks).forEach((deptName) => {
      catalog[typeCode].subWorks[deptName].sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  return catalog;
}

function buildLegacySubWorks(workCatalogByType) {
  // Old frontend still has fallback subWorksMap by department.
  // Build one combined department map for compatibility.
  const subWorksMap = {};

  Object.values(workCatalogByType || {}).forEach((catalog) => {
    Object.entries(catalog.subWorks || {}).forEach(([deptName, list]) => {
      if (!Array.isArray(subWorksMap[deptName])) subWorksMap[deptName] = [];

      (list || []).forEach((sw) => {
        const exists = subWorksMap[deptName].some((x) => clean(x.name) === clean(sw.name));
        if (!exists) {
          subWorksMap[deptName].push({
            name: clean(sw.name),
            standardTime: Number(sw.standardTime || 0) || 0,
            checkpoints: Array.isArray(sw.checkpoints) ? sw.checkpoints : [],
            qualityCheckpoints: Array.isArray(sw.qualityCheckpoints) ? sw.qualityCheckpoints : []
          });
        }
      });
    });
  });

  Object.keys(subWorksMap).forEach((deptName) => {
    subWorksMap[deptName].sort((a, b) => a.name.localeCompare(b.name));
  });

  return subWorksMap;
}

async function getAdminMasterData() {
  const [
    employees,
    shifts,
    machineTypes,
    machines,
    departments,
    subworks,
    bookingPoints,
    qualityPoints,
    lossReasons,
    rootAreas
    ] = await Promise.all([
    listAll("employees"),
    listAll("shifts"),
    listAll("machine_types"),
    listAll("machines"),
    listAll("departments"),
    listAll("subworks"),
    listAll("booking_points"),
    listAll("quality_points"),
    listAll("loss_reasons"),
    listAll("root_areas")
  ]);
   


  const frontendMachineTypes = buildMachineTypes(machineTypes);
  const frontendMachines = buildMachines(machines);
  const frontendEmployees = buildEmployees(employees);
  const frontendShifts = buildShifts(shifts);
  const mainWorks = buildDepartments(departments);
  const workCatalogByType = buildWorkCatalogByType(machineTypes, departments, subworks, bookingPoints, qualityPoints);
  const subWorks = buildLegacySubWorks(workCatalogByType);

  return {
    admin: {
      pin: ""
    },
    employees: frontendEmployees,
    shifts: frontendShifts,
    machineTypes: frontendMachineTypes,
    machines: frontendMachines,
    mainWorks,
    subWorks,
    workCatalogByType,
    lossReasons: buildLossReasons(lossReasons),
    rootAreas: buildRootAreas(rootAreas),
    meta: {
      source: "pocketbase",
      generatedAt: new Date().toISOString(),
      counts: {
        employees: frontendEmployees.length,
        shifts: frontendShifts.length,
        machineTypes: frontendMachineTypes.length,
        machines: frontendMachines.length,
        departments: mainWorks.length,
        subworks: subworks.length,
        bookingPoints: bookingPoints.length,
        qualityPoints: qualityPoints.length,
        lossReasons: lossReasons.length,
        rootAreas: rootAreas.length
      }
    }
  };
}

module.exports = {
  getAdminMasterData
};