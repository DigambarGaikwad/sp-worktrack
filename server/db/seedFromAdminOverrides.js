// server/db/seedFromAdminOverrides.js
// SP WorkTrack DB Edition - Seed PocketBase from data/adminOverrides.json
// Optimized: loads existing records once per collection and uses Map lookup.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ADMIN_FILE = path.join(ROOT_DIR, "data", "adminOverrides.json");

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

function asBool(value, defaultValue = true) {
  if (value === false) return false;
  if (value === true) return true;
  return defaultValue;
}

function recordKey(...parts) {
  return parts.map((p) => clean(p).toLowerCase()).join("|");
}

function readAdminOverrides() {
  if (!fs.existsSync(ADMIN_FILE)) {
    throw new Error(`adminOverrides.json not found at ${ADMIN_FILE}`);
  }

  return JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8"));
}

async function listAll(collectionName) {
  const all = [];
  let page = 1;
  const perPage = 500;

  while (true) {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: { page, perPage }
    });

    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);

    const totalPages = Number(result.totalPages || 1);
    if (page >= totalPages) break;
    page += 1;
  }

  return all;
}

async function createRecord(collectionName, body) {
  return pocketBaseRequest(`/api/collections/${collectionName}/records`, {
    method: "POST",
    body
  });
}

// ---------------- EMPLOYEES ----------------

async function seedEmployees(admin) {
  const employees = Array.isArray(admin.employees) ? admin.employees : [];
  const existing = await listAll("employees");
  const existingMap = new Map(existing.map((x) => [recordKey(x.emp_code), x]));

  for (const emp of employees) {
    const empCode = clean(emp.empId || emp.emp_code || emp.code);
    const fullName = clean(emp.name || emp.full_name);

    if (!empCode || !fullName) continue;

    const key = recordKey(empCode);
    if (existingMap.has(key)) {
      console.log(`Skip existing employees: ${empCode}`);
      continue;
    }

    const created = await createRecord("employees", {
      emp_code: empCode,
      full_name: fullName,
      department: clean(emp.department || ""),
      designation: clean(emp.designation || ""),
      active: asBool(emp.active, true)
    });

    existingMap.set(key, created);
    console.log(`Created employees: ${empCode}`);
  }
}

// ---------------- SHIFTS ----------------

async function seedShifts(admin) {
  const shifts = Array.isArray(admin.shifts) ? admin.shifts : [];
  const existing = await listAll("shifts");
  const existingMap = new Map(existing.map((x) => [recordKey(x.shift_code), x]));

  for (const s of shifts) {
    const shiftCode = clean(s.id || s.shift_code || s.name);
    const shiftName = clean(s.name || s.shift_name);

    if (!shiftCode || !shiftName) continue;

    const key = recordKey(shiftCode);
    if (existingMap.has(key)) {
      console.log(`Skip existing shifts: ${shiftCode}`);
      continue;
    }

    const created = await createRecord("shifts", {
      shift_code: shiftCode,
      shift_name: shiftName,
      start_time: clean(s.start || s.start_time),
      end_time: clean(s.end || s.end_time),
      break_minutes: Number(s.breakMinutes || s.break_minutes || 0) || 0,
      flexible: asBool(s.flexible, false),
      active: asBool(s.active, true)
    });

    existingMap.set(key, created);
    console.log(`Created shifts: ${shiftCode}`);
  }
}

// ---------------- MACHINE TYPES ----------------

async function seedMachineTypes(admin) {
  const machineTypes = Array.isArray(admin.machineTypes) ? admin.machineTypes : [];
  const existing = await listAll("machine_types");
  const existingMap = new Map(existing.map((x) => [recordKey(x.type_code), x]));

  for (const mt of machineTypes) {
    const typeCode = clean(mt.id || mt.type_code || mt.code);
    const typeName = clean(mt.name || mt.type_name);

    if (!typeCode || !typeName) continue;

    const key = recordKey(typeCode);
    if (existingMap.has(key)) {
      console.log(`Skip existing machine_types: ${typeCode}`);
      continue;
    }

    const created = await createRecord("machine_types", {
      type_code: typeCode,
      type_name: typeName,
      active: asBool(mt.active, true)
    });

    existingMap.set(key, created);
    console.log(`Created machine_types: ${typeCode}`);
  }
}

// ---------------- MACHINES ----------------

async function seedMachines(admin) {
  const machines = Array.isArray(admin.machines) ? admin.machines : [];
  const existing = await listAll("machines");
  const existingMap = new Map(existing.map((x) => [recordKey(x.machine_no), x]));

  for (const m of machines) {
    const machineNo = clean(m.name || m.machine_no);
    const machineTypeCode = clean(m.type || m.machine_type_code);

    if (!machineNo || !machineTypeCode) continue;

    const key = recordKey(machineNo);
    if (existingMap.has(key)) {
      console.log(`Skip existing machines: ${machineNo}`);
      continue;
    }

    const created = await createRecord("machines", {
      machine_no: machineNo,
      machine_type_code: machineTypeCode,
      status: asBool(m.active, true) ? "Active" : "Inactive",
      active: asBool(m.active, true)
    });

    existingMap.set(key, created);
    console.log(`Created machines: ${machineNo}`);
  }
}

// ---------------- DEPARTMENTS ----------------

function collectDepartments(admin) {
  const map = new Map();

  const addDept = (deptName) => {
    const name = clean(deptName);
    if (!name) return;

    const code = slug(name);
    if (!code) return;

    map.set(code, {
      department_code: code,
      department_name: name,
      active: true
    });
  };

  (admin.mainWorks || []).forEach(addDept);

  const workCatalog = admin.workCatalogByType || {};
  Object.values(workCatalog).forEach((cat) => {
    (cat.mainWorks || []).forEach(addDept);
    Object.keys(cat.subWorks || {}).forEach(addDept);
  });

  return Array.from(map.values());
}

async function seedDepartments(admin) {
  const departments = collectDepartments(admin);
  const existing = await listAll("departments");
  const existingMap = new Map(existing.map((x) => [recordKey(x.department_code), x]));

  for (const dept of departments) {
    const deptCode = clean(dept.department_code);
    if (!deptCode) continue;

    const key = recordKey(deptCode);
    if (existingMap.has(key)) {
      console.log(`Skip existing departments: ${deptCode}`);
      continue;
    }

    const created = await createRecord("departments", {
      department_code: dept.department_code,
      department_name: dept.department_name,
      active: asBool(dept.active, true)
    });

    existingMap.set(key, created);
    console.log(`Created departments: ${deptCode}`);
  }
}

// ---------------- SUBWORKS / BOOKING POINTS / QUALITY POINTS ----------------

function collectWorkMaster(admin) {
  const subworkMap = new Map();
  const bookingPointMap = new Map();
  const qualityPointMap = new Map();

  const catalog = admin.workCatalogByType || {};

  Object.entries(catalog).forEach(([machineTypeCodeRaw, cat]) => {
    const machineTypeCode = clean(machineTypeCodeRaw);
    const subWorksByDept = cat?.subWorks || {};

    Object.entries(subWorksByDept).forEach(([deptNameRaw, list]) => {
      const departmentCode = slug(deptNameRaw);

      if (!machineTypeCode || !departmentCode || !Array.isArray(list)) return;

      list.forEach((sw) => {
        const subworkName = clean(sw.name || sw.subwork_name);
        if (!subworkName) return;

        const subworkCode = slug(subworkName);
        const swKey = recordKey(machineTypeCode, departmentCode, subworkCode);

        if (!subworkMap.has(swKey)) {
          subworkMap.set(swKey, {
            machine_type_code: machineTypeCode,
            department_code: departmentCode,
            subwork_code: subworkCode,
            subwork_name: subworkName,
            standard_time: Number(sw.standardTime || sw.standard_time || 0) || 0,
            active: true
          });
        }

        const bookingPoints = Array.isArray(sw.checkpoints) ? sw.checkpoints : [];
        bookingPoints.forEach((point, pIndex) => {
          const pointName = clean(point.name || point.point_name);
          if (!pointName) return;

          const pointCode = slug(pointName);
          const bpKey = recordKey(machineTypeCode, departmentCode, subworkCode, pointCode);

          if (!bookingPointMap.has(bpKey)) {
            bookingPointMap.set(bpKey, {
              machine_type_code: machineTypeCode,
              department_code: departmentCode,
              subwork_code: subworkCode,
              point_code: pointCode,
              point_name: pointName,
              standard_time: Number(point.standardTime || point.standard_time || 0) || 0,
              sequence_no: pIndex + 1,
              active: true
            });
          }
        });

        const qualityPoints = Array.isArray(sw.qualityCheckpoints) ? sw.qualityCheckpoints : [];
        qualityPoints.forEach((point, qIndex) => {
          const pointName = clean(point.name || point.point_name);
          if (!pointName) return;

          const pointCode = slug(pointName);
          const qpKey = recordKey(machineTypeCode, departmentCode, subworkCode, pointCode);

          if (!qualityPointMap.has(qpKey)) {
            qualityPointMap.set(qpKey, {
              machine_type_code: machineTypeCode,
              department_code: departmentCode,
              subwork_code: subworkCode,
              point_code: pointCode,
              point_name: pointName,
              input_type: point.inputType === "reading" ? "reading" : "status",
              mandatory: point.mandatory === true,
              sequence_no: qIndex + 1,
              active: true
            });
          }
        });
      });
    });
  });

  return {
    subworks: Array.from(subworkMap.values()),
    bookingPoints: Array.from(bookingPointMap.values()),
    qualityPoints: Array.from(qualityPointMap.values())
  };
}

async function seedSubworks(admin) {
  const { subworks } = collectWorkMaster(admin);
  const existing = await listAll("subworks");
  const existingMap = new Map(
    existing.map((x) => [recordKey(x.machine_type_code, x.department_code, x.subwork_code), x])
  );

  for (const sw of subworks) {
    const key = recordKey(sw.machine_type_code, sw.department_code, sw.subwork_code);

    if (existingMap.has(key)) {
      console.log(`Skip existing subworks: ${sw.machine_type_code}/${sw.department_code}/${sw.subwork_code}`);
      continue;
    }

    const created = await createRecord("subworks", sw);
    existingMap.set(key, created);
    console.log(`Created subworks: ${sw.machine_type_code}/${sw.department_code}/${sw.subwork_code}`);
  }
}

async function seedBookingPoints(admin) {
  const { bookingPoints } = collectWorkMaster(admin);
  const existing = await listAll("booking_points");
  const existingMap = new Map(
    existing.map((x) => [recordKey(x.machine_type_code, x.department_code, x.subwork_code, x.point_code), x])
  );

  for (const bp of bookingPoints) {
    const key = recordKey(bp.machine_type_code, bp.department_code, bp.subwork_code, bp.point_code);

    if (existingMap.has(key)) {
      console.log(`Skip existing booking_points: ${bp.machine_type_code}/${bp.department_code}/${bp.subwork_code}/${bp.point_code}`);
      continue;
    }

    const created = await createRecord("booking_points", bp);
    existingMap.set(key, created);
    console.log(`Created booking_points: ${bp.machine_type_code}/${bp.department_code}/${bp.subwork_code}/${bp.point_code}`);
  }
}

async function seedQualityPoints(admin) {
  const { qualityPoints } = collectWorkMaster(admin);
  const existing = await listAll("quality_points");
  const existingMap = new Map(
    existing.map((x) => [recordKey(x.machine_type_code, x.department_code, x.subwork_code, x.point_code), x])
  );

  for (const qp of qualityPoints) {
    const key = recordKey(qp.machine_type_code, qp.department_code, qp.subwork_code, qp.point_code);

    if (existingMap.has(key)) {
      console.log(`Skip existing quality_points: ${qp.machine_type_code}/${qp.department_code}/${qp.subwork_code}/${qp.point_code}`);
      continue;
    }

    const created = await createRecord("quality_points", qp);
    existingMap.set(key, created);
    console.log(`Created quality_points: ${qp.machine_type_code}/${qp.department_code}/${qp.subwork_code}/${qp.point_code}`);
  }
}

// ---------------- LOSS REASONS ----------------

async function seedLossReasons(admin) {
  const reasons = Array.isArray(admin.lossReasons) ? admin.lossReasons : [];
  const existing = await listAll("loss_reasons");
  const existingMap = new Map(existing.map((x) => [recordKey(x.reason_code), x]));

  for (const reason of reasons) {
    const reasonName = clean(reason);
    const reasonCode = slug(reasonName);

    if (!reasonName || !reasonCode) continue;

    if (existingMap.has(recordKey(reasonCode))) {
      console.log(`Skip existing loss_reasons: ${reasonCode}`);
      continue;
    }

    const created = await createRecord("loss_reasons", {
      reason_code: reasonCode,
      reason_name: reasonName,
      active: true
    });

    existingMap.set(recordKey(reasonCode), created);
    console.log(`Created loss_reasons: ${reasonCode}`);
  }
}

// ---------------- ROOT AREAS ----------------

async function seedRootAreas(admin) {
  const rootAreas = Array.isArray(admin.rootAreas) ? admin.rootAreas : [];
  const existing = await listAll("root_areas");
  const existingMap = new Map(existing.map((x) => [recordKey(x.area_code), x]));

  for (const area of rootAreas) {
    const areaName = clean(area);
    const areaCode = slug(areaName);

    if (!areaName || !areaCode) continue;

    if (existingMap.has(recordKey(areaCode))) {
      console.log(`Skip existing root_areas: ${areaCode}`);
      continue;
    }

    const created = await createRecord("root_areas", {
      area_code: areaCode,
      area_name: areaName,
      active: true
    });

    existingMap.set(recordKey(areaCode), created);
    console.log(`Created root_areas: ${areaCode}`);
  }
}

// ---------------- MAIN ----------------

async function main() {
  console.log("Starting seed from adminOverrides.json...");

  const admin = readAdminOverrides();

  await seedEmployees(admin);
  await seedShifts(admin);
  await seedMachineTypes(admin);
  await seedMachines(admin);
  await seedDepartments(admin);
  await seedSubworks(admin);
  await seedBookingPoints(admin);
  await seedQualityPoints(admin);
  await seedLossReasons(admin);
  await seedRootAreas(admin);

  console.log("Seed completed successfully.");
}

main().catch((err) => {
  console.error("Seed failed:");
  console.error(err);
  process.exit(1);
});