require("dotenv").config();

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const COLLECTIONS = [
  // transaction data
  "production_entry_lines",
  "production_entries",
  "booking_logs",
  "booking_status",
  "quality_logs",
  "attendance",
  "planned_absences",

  // setup/master data
  "quality_points",
  "booking_points",
  "subworks",
  "departments",
  "machine_types",
  "machines",
  "employees",
  "shifts",
  "loss_reasons",
  "root_areas"
];

// admin_settings intentionally kept, so PIN/recovery settings remain.

async function listAll(collectionName) {
  const all = [];
  let page = 1;

  while (true) {
    try {
      const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
        method: "GET",
        query: { page, perPage: 500 }
      });

      const items = Array.isArray(result.items) ? result.items : [];
      all.push(...items);

      if (!items.length || page >= Number(result.totalPages || 1)) break;
      page += 1;
    } catch (err) {
      if (err.status === 404) {
        console.log(`${collectionName}: collection not found, skipped`);
        return [];
      }
      throw err;
    }
  }

  return all;
}

async function deleteCollectionRecords(collectionName) {
  const rows = await listAll(collectionName);
  let deleted = 0;

  for (const row of rows) {
    if (!row.id) continue;

    await pocketBaseRequest(`/api/collections/${collectionName}/records/${row.id}`, {
      method: "DELETE"
    });

    deleted += 1;
    process.stdout.write(`\r${collectionName}: deleted ${deleted}/${rows.length}`);
  }

  console.log(rows.length ? "" : `${collectionName}: 0`);
  return { collection: collectionName, deleted };
}

async function main() {
  const confirmText = process.argv[2];

  if (confirmText !== "EMPTY_DB") {
    console.log("This will delete all SP WorkTrack app data except admin settings.");
    console.log("Run this exact command to confirm:");
    console.log("node server\\scripts\\emptyDbForFreshStart.js EMPTY_DB");
    process.exit(1);
  }

  console.log("Emptying SP WorkTrack app data...");
  const results = [];

  for (const collection of COLLECTIONS) {
    results.push(await deleteCollectionRecords(collection));
  }

  console.log("\nDone.");
  console.table(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
