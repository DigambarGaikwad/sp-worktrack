const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

const EMPTY_DB_COLLECTIONS = [
  "production_entry_lines",
  "production_entries",
  "booking_logs",
  "booking_status",
  "quality_logs",
  "attendance",
  "planned_absences",

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

function clean(value) {
  return String(value ?? "").trim();
}

function isMissingCollectionError(err) {
  return err?.status === 404 || /missing collection context|collection not found/i.test(String(err?.message || ""));
}

async function listRecords(collectionName) {
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
      if (isMissingCollectionError(err)) return [];
      throw err;
    }
  }

  return all;
}

async function countCollection(collectionName) {
  try {
    const result = await pocketBaseRequest(`/api/collections/${collectionName}/records`, {
      method: "GET",
      query: { page: 1, perPage: 1 }
    });

    return Number(result.totalItems || 0);
  } catch (err) {
    if (isMissingCollectionError(err)) return 0;
    throw err;
  }
}

async function deleteCollection(collectionName) {
  const rows = await listRecords(collectionName);
  let deleted = 0;

  for (const row of rows) {
    if (!row?.id) continue;

    await pocketBaseRequest(`/api/collections/${collectionName}/records/${row.id}`, {
      method: "DELETE"
    });

    deleted += 1;
  }

  return { collection: collectionName, deleted };
}

async function previewEmptyDatabase() {
  const counts = {};

  for (const collection of EMPTY_DB_COLLECTIONS) {
    counts[collection] = await countCollection(collection);
  }

  return {
    note: "This will empty all SP WorkTrack app data except admin_settings.",
    kept: ["admin_settings"],
    collections: EMPTY_DB_COLLECTIONS,
    counts,
    total: Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0)
  };
}

async function emptyDatabase(params = {}) {
  const confirmText = clean(params.confirmText || params.confirm);

  if (confirmText !== "EMPTY_DB") {
    const err = new Error("Type EMPTY_DB to confirm full database empty.");
    err.status = 400;
    throw err;
  }

  const preview = await previewEmptyDatabase();
  const deleted = [];

  for (const collection of EMPTY_DB_COLLECTIONS) {
    deleted.push(await deleteCollection(collection));
  }

  return {
    ...preview,
    deleted,
    deletedTotal: deleted.reduce((sum, x) => sum + Number(x.deleted || 0), 0)
  };
}

module.exports = {
  previewEmptyDatabase,
  emptyDatabase
};
