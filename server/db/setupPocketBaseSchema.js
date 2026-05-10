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