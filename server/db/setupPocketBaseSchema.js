// server/db/setupPocketBaseSchema.js
// SP WorkTrack DB Edition - PocketBase schema setup
// Purpose: create required collections automatically so we do not depend on manual setup.

require("dotenv").config();

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const collectionsToCreate = [
  {
    name: "machine_types",
    type: "base",
    fields: [
      { name: "type_code", type: "text", required: true },
      { name: "type_name", type: "text", required: true },
      { name: "active", type: "bool", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_machine_types_type_code ON machine_types (type_code)"
    ]
  },

  {
    name: "machines",
    type: "base",
    fields: [
      { name: "machine_no", type: "text", required: true },
      { name: "machine_type_code", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "active", type: "bool", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_machines_machine_no ON machines (machine_no)",
      "CREATE INDEX idx_machines_type_status ON machines (machine_type_code, status)"
    ]
  },

  {
    name: "departments",
    type: "base",
    fields: [
      { name: "department_code", type: "text", required: true },
      { name: "department_name", type: "text", required: true },
      { name: "active", type: "bool", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_departments_department_code ON departments (department_code)"
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
      { name: "standard_time", type: "number", required: true },
      { name: "active", type: "bool", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_subworks_unique ON subworks (machine_type_code, department_code, subwork_code)",
      "CREATE INDEX idx_subworks_type_dept ON subworks (machine_type_code, department_code)"
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
      { name: "standard_time", type: "number", required: true },
      { name: "sequence_no", type: "number", required: true },
      { name: "active", type: "bool", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_booking_points_unique ON booking_points (machine_type_code, department_code, subwork_code, point_code)",
      "CREATE INDEX idx_booking_points_subwork ON booking_points (machine_type_code, department_code, subwork_code)"
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
    schema: buildFields(collectionDef.fields),
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