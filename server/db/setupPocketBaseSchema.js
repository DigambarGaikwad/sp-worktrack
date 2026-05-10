// server/db/setupPocketBaseSchema.js
// SP WorkTrack DB Edition - PocketBase schema setup
// Creates required master-data collections automatically.
// NOTE: Indexes are intentionally not created here yet to avoid PocketBase SQL index format issues.

require("dotenv").config();

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const collectionsToCreate = [
  {
    name: "employees",
    type: "base",
    fields: [
      { name: "emp_code", type: "text", required: true },
      { name: "full_name", type: "text", required: true },
      { name: "department", type: "text", required: false },
      { name: "designation", type: "text", required: false },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "shifts",
    type: "base",
    fields: [
      { name: "shift_code", type: "text", required: true },
      { name: "shift_name", type: "text", required: true },
      { name: "start_time", type: "text", required: false },
      { name: "end_time", type: "text", required: false },
      { name: "break_minutes", type: "number", required: false },
      { name: "flexible", type: "bool", required: false },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "machine_types",
    type: "base",
    fields: [
      { name: "type_code", type: "text", required: true },
      { name: "type_name", type: "text", required: true },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "machines",
    type: "base",
    fields: [
      { name: "machine_no", type: "text", required: true },
      { name: "machine_type_code", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "departments",
    type: "base",
    fields: [
      { name: "department_code", type: "text", required: true },
      { name: "department_name", type: "text", required: true },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "subworks",
    type: "base",
    fields: [
      { name: "machine_type_code", type: "text", required: true },
      { name: "department_code", type: "text", required: true },
      { name: "subwork_code", type: "text", required: true },
      { name: "subwork_name", type: "text", required: true },
      { name: "standard_time", type: "number", required: false },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "booking_points",
    type: "base",
    fields: [
      { name: "machine_type_code", type: "text", required: true },
      { name: "department_code", type: "text", required: true },
      { name: "subwork_code", type: "text", required: true },
      { name: "point_code", type: "text", required: true },
      { name: "point_name", type: "text", required: true },
      { name: "standard_time", type: "number", required: false },
      { name: "sequence_no", type: "number", required: false },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "quality_points",
    type: "base",
    fields: [
      { name: "machine_type_code", type: "text", required: true },
      { name: "department_code", type: "text", required: true },
      { name: "subwork_code", type: "text", required: true },
      { name: "point_code", type: "text", required: true },
      { name: "point_name", type: "text", required: true },
      { name: "input_type", type: "text", required: true },
      { name: "mandatory", type: "bool", required: false },
      { name: "sequence_no", type: "number", required: false },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "loss_reasons",
    type: "base",
    fields: [
      { name: "reason_code", type: "text", required: true },
      { name: "reason_name", type: "text", required: true },
      { name: "active", type: "bool", required: false }
    ]
  },

  {
    name: "root_areas",
    type: "base",
    fields: [
      { name: "area_code", type: "text", required: true },
      { name: "area_name", type: "text", required: true },
      { name: "active", type: "bool", required: false }
    ]
  },

  // ---------------- TRANSACTION TABLES ----------------
  // Production header: one record per employee/date/shift submission.
  {
    name: "production_entries",
    type: "base",
    fields: [
      { name: "entry_no", type: "text", required: true },
      { name: "work_date", type: "text", required: true },
      { name: "work_year", type: "number", required: true },

      { name: "shift_code", type: "text", required: true },
      { name: "shift_name", type: "text", required: true },
      { name: "shift_start", type: "text", required: false },
      { name: "shift_end", type: "text", required: false },
      { name: "break_minutes", type: "number", required: false },
      { name: "flexible_shift_minutes", type: "number", required: false },

      { name: "work_type", type: "text", required: false },
      { name: "emp_code", type: "text", required: true },
      { name: "emp_name", type: "text", required: true },

      { name: "gross_shift_available", type: "number", required: false },
      { name: "major_loss_reason", type: "text", required: false },
      { name: "major_loss_minutes", type: "number", required: false },
      { name: "shift_available", type: "number", required: false },

      { name: "total_standard_minutes", type: "number", required: false },
      { name: "total_actual_minutes", type: "number", required: false },
      { name: "remaining_minutes", type: "number", required: false },
      { name: "productivity_percent", type: "number", required: false },

      { name: "source", type: "text", required: false },
      { name: "status", type: "text", required: false },
      { name: "remarks", type: "text", required: false }
    ]
  },

  // Production line: one record per work card.
  {
    name: "production_entry_lines",
    type: "base",
    fields: [
      { name: "entry_no", type: "text", required: true },
      { name: "line_no", type: "number", required: true },

      { name: "work_date", type: "text", required: true },
      { name: "work_year", type: "number", required: true },

      { name: "emp_code", type: "text", required: true },
      { name: "emp_name", type: "text", required: true },

      { name: "machine_no", type: "text", required: true },
      { name: "machine_type_code", type: "text", required: false },
      { name: "machine_category", type: "text", required: false },

      { name: "department_code", type: "text", required: false },
      { name: "department_name", type: "text", required: true },

      { name: "subwork_code", type: "text", required: false },
      { name: "subwork_name", type: "text", required: true },

      { name: "work_nature", type: "text", required: true },
      { name: "description", type: "text", required: false },
      { name: "root_area", type: "text", required: false },

      { name: "standard_minutes", type: "number", required: false },
      { name: "actual_minutes", type: "number", required: false },
      { name: "overrun_minutes", type: "number", required: false },
      { name: "efficiency_reason", type: "text", required: false },

      { name: "booking_points_json", type: "json", required: false },
      { name: "quality_points_json", type: "json", required: false }
    ]
  },

  // Booking logs: every booking point time transaction.
  {
    name: "booking_logs",
    type: "base",
    fields: [
      { name: "entry_no", type: "text", required: true },
      { name: "line_no", type: "number", required: true },

      { name: "work_date", type: "text", required: true },
      { name: "work_year", type: "number", required: true },

      { name: "emp_code", type: "text", required: true },
      { name: "emp_name", type: "text", required: true },

      { name: "machine_no", type: "text", required: true },
      { name: "machine_type_code", type: "text", required: false },
      { name: "machine_category", type: "text", required: false },

      { name: "department_code", type: "text", required: false },
      { name: "department_name", type: "text", required: true },

      { name: "subwork_code", type: "text", required: false },
      { name: "subwork_name", type: "text", required: true },

      { name: "point_code", type: "text", required: false },
      { name: "point_name", type: "text", required: true },

      { name: "original_minutes", type: "number", required: false },
      { name: "booked_minutes", type: "number", required: false },
      { name: "consumed_before", type: "number", required: false },
      { name: "consumed_after", type: "number", required: false },
      { name: "remaining_after", type: "number", required: false },
      { name: "status_after", type: "text", required: false }
    ]
  },

  // Booking status: current status per machine/subwork/booking point.
  {
    name: "booking_status",
    type: "base",
    fields: [
      { name: "machine_no", type: "text", required: true },
      { name: "machine_type_code", type: "text", required: false },
      { name: "machine_category", type: "text", required: false },

      { name: "department_code", type: "text", required: false },
      { name: "department_name", type: "text", required: true },

      { name: "subwork_code", type: "text", required: false },
      { name: "subwork_name", type: "text", required: true },

      { name: "point_code", type: "text", required: false },
      { name: "point_name", type: "text", required: true },

      { name: "standard_minutes", type: "number", required: false },
      { name: "consumed_minutes", type: "number", required: false },
      { name: "remaining_minutes", type: "number", required: false },
      { name: "completion_percent", type: "number", required: false },
      { name: "status", type: "text", required: false },

      { name: "last_entry_no", type: "text", required: false },
      { name: "last_work_date", type: "text", required: false },
      { name: "last_emp_code", type: "text", required: false },
      { name: "last_emp_name", type: "text", required: false }
    ]
  },

  // Quality logs: every quality check/recheck transaction.
  {
    name: "quality_logs",
    type: "base",
    fields: [
      { name: "entry_no", type: "text", required: true },
      { name: "line_no", type: "number", required: true },

      { name: "work_date", type: "text", required: true },
      { name: "work_year", type: "number", required: true },

      { name: "emp_code", type: "text", required: true },
      { name: "emp_name", type: "text", required: true },

      { name: "machine_no", type: "text", required: true },
      { name: "machine_type_code", type: "text", required: false },
      { name: "machine_category", type: "text", required: false },

      { name: "department_code", type: "text", required: false },
      { name: "department_name", type: "text", required: true },

      { name: "subwork_code", type: "text", required: false },
      { name: "subwork_name", type: "text", required: true },

      { name: "point_code", type: "text", required: false },
      { name: "point_name", type: "text", required: true },
      { name: "input_type", type: "text", required: false },
      { name: "value", type: "text", required: false },
      { name: "status", type: "text", required: false },
      { name: "is_recheck", type: "bool", required: false }
    ]
  },

  // Attendance: one status per employee/date/shift.
  {
    name: "attendance",
    type: "base",
    fields: [
      { name: "att_key", type: "text", required: true },
      { name: "work_date", type: "text", required: true },
      { name: "work_year", type: "number", required: true },

      { name: "shift_code", type: "text", required: true },
      { name: "shift_name", type: "text", required: true },

      { name: "emp_code", type: "text", required: true },
      { name: "emp_name", type: "text", required: true },

      { name: "status", type: "text", required: true },
      { name: "shift_available", type: "number", required: false },
      { name: "utilized_minutes", type: "number", required: false },
      { name: "source_entry_no", type: "text", required: false },
      { name: "remarks", type: "text", required: false }
    ]
  }
];

async function getExistingCollections() {
  const result = await pocketBaseRequest("/api/collections", {
    method: "GET",
    query: {
      page: 1,
      perPage: 200
    }
  });

  return Array.isArray(result.items) ? result.items : [];
}

function buildFields(fields) {
  return fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required === true,
    presentable: false,
    unique: false,
    options: {}
  }));
}

async function createCollection(collectionDef) {
 const payload = {
  name: collectionDef.name,
  type: collectionDef.type || "base",
  system: false,
  fields: buildFields(collectionDef.fields),
  indexes: [],
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null
};

  return pocketBaseRequest("/api/collections", {
    method: "POST",
    body: payload
  });
}

async function setupPocketBaseSchema() {
  console.log("Starting PocketBase schema setup...");

  const existingCollections = await getExistingCollections();
  const existingNames = new Set(existingCollections.map((c) => c.name));

  for (const collectionDef of collectionsToCreate) {
    if (existingNames.has(collectionDef.name)) {
      console.log(`Already exists: ${collectionDef.name}`);
      continue;
    }

    console.log(`Creating collection: ${collectionDef.name}`);
    await createCollection(collectionDef);
    console.log(`Created: ${collectionDef.name}`);
  }

  console.log("PocketBase schema setup completed.");
}

setupPocketBaseSchema().catch((err) => {
  console.error("PocketBase schema setup failed:");
  console.error(err);
  process.exit(1);
});