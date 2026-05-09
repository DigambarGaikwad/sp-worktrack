// server/services/employeeService.js
// Employee business logic layer.
// Later, this file can switch from PocketBase to company DB without changing routes.

const { pocketBaseRequest } = require("../adapters/pocketbaseClient");

function normalizeEmployee(record) {
  return {
    id: record.id,
    empCode: String(record.emp_code || "").trim(),
    name: String(record.full_name || "").trim(),
    department: String(record.department || "").trim(),
    designation: String(record.designation || "").trim(),
    active: record.active === true,
    created: record.created,
    updated: record.updated
  };
}
async function listEmployees(filters = {}) {
  const activeOnly = filters.activeOnly !== false;

  const query = {
    page: 1,
    perPage: 200,
    sort: "emp_code"
  };

  if (activeOnly) {
    query.filter = "active=true";
  }

  const result = await pocketBaseRequest("/api/collections/employees/records", {
    method: "GET",
    query
  });

  const items = Array.isArray(result.items) ? result.items : [];

  return items.map(normalizeEmployee);
}

module.exports = {
  listEmployees
};