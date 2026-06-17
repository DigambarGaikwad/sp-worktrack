// server/services/plannedAbsenceService.js
// Robust planned absence service.
// - hides and removes fully blank records
// - blocks duplicate / overlapping planned dates for the same employee
// - computes planned days/hours excluding Sundays

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTION = "planned_absences";
const REQUIRED_FIELDS = [
  "emp_code",
  "emp_name",
  "department",
  "from_date",
  "to_date",
  "reason",
  "remark",
  "status"
];

function clean(value) {
  return String(value ?? "").trim();
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

function isSchemaError(err) {
  return err?.status === 400 || /something went wrong/i.test(String(err?.message || ""));
}

function isGeneralShift(value) {
  const text = clean(value).toLowerCase();
  return text.includes("general") || text === "g" || text === "gen";
}

function timeToMinutes(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function calculateShiftMinutes(shift) {
  const explicit = num(shift.available_minutes, 0) || num(shift.shift_available, 0);
  if (explicit > 0) return explicit;

  const start = timeToMinutes(shift.start_time || shift.start);
  const end = timeToMinutes(shift.end_time || shift.end);
  const breakMinutes = num(shift.break_minutes ?? shift.breakMinutes, 0);

  if (start == null || end == null) return 0;

  let gross = end - start;
  if (gross < 0) gross += 24 * 60;
  return Math.max(gross - breakMinutes, 0);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function workingDatesBetween(from, to) {
  const fromText = clean(from);
  const toText = clean(to) || fromText;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromText)) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toText)) return [];

  const [fy, fm, fd] = fromText.split("-").map(Number);
  const [ty, tm, td] = toText.split("-").map(Number);
  let cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const dates = [];

  while (cursor <= end) {
    if (cursor.getDay() !== 0) dates.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
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

function textField(name) {
  return {
    name,
    type: "text",
    system: false,
    required: false,
    presentable: false,
    unique: false,
    options: {
      min: null,
      max: null,
      pattern: ""
    }
  };
}

function collectionFields(collection) {
  const fields = Array.isArray(collection.fields) ? collection.fields : [];
  const schema = Array.isArray(collection.schema) ? collection.schema : [];
  return fields.length ? fields : schema;
}

async function ensureCollection() {
  let collection = null;

  try {
    collection = await pocketBaseRequest(`/api/collections/${COLLECTION}`, { method: "GET" });
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err;
  }

  if (!collection) {
    const payload = {
      name: COLLECTION,
      type: "base",
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: REQUIRED_FIELDS.map(textField)
    };

    try {
      return await pocketBaseRequest("/api/collections", {
        method: "POST",
        body: payload
      });
    } catch (err) {
      const legacyPayload = {
        name: COLLECTION,
        type: "base",
        system: false,
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
        schema: REQUIRED_FIELDS.map(textField)
      };
      return pocketBaseRequest("/api/collections", {
        method: "POST",
        body: legacyPayload
      });
    }
  }

  const existingFields = collectionFields(collection).map((field) => clean(field.name));
  const missing = REQUIRED_FIELDS.filter((fieldName) => !existingFields.includes(fieldName));

  if (missing.length) {
    const mergedFields = [...collectionFields(collection), ...missing.map(textField)];
    const patch = collection.fields !== undefined ? { fields: mergedFields } : { schema: mergedFields };
    await pocketBaseRequest(`/api/collections/${collection.id}`, {
      method: "PATCH",
      body: patch
    });
  }

  return collection;
}

async function getGeneralShiftMinutes() {
  try {
    const shifts = await listAll("shifts", { perPage: 500 });
    const general = shifts.find((s) => isGeneralShift(s.shift_name || s.shift_code));
    return general ? calculateShiftMinutes(general) : 0;
  } catch (err) {
    return 0;
  }
}

function normalize(body = {}) {
  const fromDate = clean(body.from_date || body.fromDate);
  const toDate = clean(body.to_date || body.toDate || fromDate);

  return {
    emp_code: clean(body.emp_code || body.empCode || body.empId),
    emp_name: clean(body.emp_name || body.empName || body.employeeName),
    department: clean(body.department),
    from_date: fromDate,
    to_date: toDate,
    reason: clean(body.reason),
    remark: clean(body.remark || body.remarks),
    status: clean(body.status || "Planned") || "Planned"
  };
}

function recordIdFrom(body = {}) {
  return clean(
    body.id ||
    body._id ||
    body.record_id ||
    body.recordId ||
    body.planned_absence_id ||
    body.plannedAbsenceId ||
    body.absenceId
  );
}

function isBlankRecord(item) {
  return !clean(item.emp_code) &&
    !clean(item.emp_name) &&
    !clean(item.from_date) &&
    !clean(item.to_date) &&
    !clean(item.reason) &&
    !clean(item.remark);
}

function sameEmployee(a, b) {
  const aCode = clean(a.emp_code).toLowerCase();
  const bCode = clean(b.emp_code).toLowerCase();
  if (aCode && bCode) return aCode === bCode;
  return clean(a.emp_name).toLowerCase() === clean(b.emp_name).toLowerCase();
}

function enrich(item, generalShiftMinutes) {
  const plannedDates = workingDatesBetween(item.from_date, item.to_date);
  return {
    ...item,
    plannedDates,
    plannedDays: plannedDates.length,
    plannedHours: Number(((plannedDates.length * generalShiftMinutes) / 60).toFixed(1)),
    generalShiftMinutes
  };
}

async function cleanupBlankRecords(items) {
  for (const item of items) {
    if (item?.id && isBlankRecord(item)) {
      try {
        await deleteRecord(COLLECTION, item.id);
      } catch (err) {
        console.warn("Failed to delete blank planned absence record", item.id, err.message);
      }
    }
  }
}

async function listPlannedAbsences(params = {}) {
  try {
    await ensureCollection();
    const status = clean(params.status || "");
    const filter = status ? `status="${pbEscape(status)}"` : "";
    const [items, generalShiftMinutes] = await Promise.all([
      listAll(COLLECTION, { perPage: 500, filter }),
      getGeneralShiftMinutes()
    ]);

    await cleanupBlankRecords(items);

    return items
      .filter((item) => !isBlankRecord(item))
      .map((item) => enrich(item, generalShiftMinutes))
      .sort((a, b) => clean(a.from_date).localeCompare(clean(b.from_date)) || clean(a.emp_name).localeCompare(clean(b.emp_name)));
  } catch (err) {
    if (isMissingCollectionError(err) || isSchemaError(err)) return [];
    throw err;
  }
}

async function assertNoDuplicate(data, currentId = "") {
  const existing = await listPlannedAbsences({});
  const newDates = new Set(workingDatesBetween(data.from_date, data.to_date));

  for (const item of existing) {
    if (currentId && clean(item.id) === clean(currentId)) continue;
    if (!sameEmployee(item, data)) continue;

    const oldDates = workingDatesBetween(item.from_date, item.to_date);
    const overlap = oldDates.filter((d) => newDates.has(d));

    if (overlap.length) {
      const err = new Error(`Duplicate planned absent blocked for ${data.emp_name || data.emp_code}. Already planned on ${overlap.join(", ")}.`);
      err.status = 409;
      err.details = {
        reasonCode: "DUPLICATE_PLANNED_ABSENCE",
        employee: data.emp_name || data.emp_code,
        overlapDates: overlap,
        existingRecordId: item.id
      };
      throw err;
    }
  }
}

async function savePlannedAbsence(body = {}) {
  await ensureCollection();

  const data = normalize(body);
  const recordId = recordIdFrom(body);
  if (!data.emp_code && !data.emp_name) throw new Error("Employee is required for planned absence.");
  if (!data.from_date) throw new Error("From date is required for planned absence.");
  if (!data.to_date) data.to_date = data.from_date;

  await assertNoDuplicate(data, recordId);

  if (recordId) return updateRecord(COLLECTION, recordId, data);
  return createRecord(COLLECTION, data);
}

async function deletePlannedAbsence(id) {
  if (!clean(id)) throw new Error("Planned absence ID is required.");
  try {
    return await deleteRecord(COLLECTION, clean(id));
  } catch (err) {
    if (isMissingCollectionError(err) || isSchemaError(err)) return null;
    throw err;
  }
}

module.exports = {
  listPlannedAbsences,
  savePlannedAbsence,
  deletePlannedAbsence
};
