// server/services/adminAccessPermissionExtensions.js
// Extends DB-mode Admin Users & Access permissions without adding another DB migration.

const { ALL_PERMISSIONS, ROLE_TEMPLATES } = require("./adminAccessService");

const EXTRA_PERMISSIONS = [
  "backupControls",
  "reportEmails",
  "maintenance",
  "performanceComments"
];

for (const permission of EXTRA_PERMISSIONS) {
  if (!ALL_PERMISSIONS.includes(permission)) ALL_PERMISSIONS.push(permission);
}

// Keep admin role as full-access role when new permissions are added.
ROLE_TEMPLATES.admin = ALL_PERMISSIONS;

module.exports = { EXTRA_PERMISSIONS };
