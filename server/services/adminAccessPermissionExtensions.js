// server/services/adminAccessPermissionExtensions.js
// Extends DB-mode Admin Users & Access permissions without adding another DB migration.

const { ALL_PERMISSIONS, ROLE_TEMPLATES } = require("./adminAccessService");

const EXTRA_PERMISSIONS = [
  "backupControls",
  "reportEmails",
  "maintenance",
  "performanceComments",
  "dbTransfer",
  "systemInfo"
];

for (const permission of EXTRA_PERMISSIONS) {
  if (!ALL_PERMISSIONS.includes(permission)) ALL_PERMISSIONS.push(permission);
}

ROLE_TEMPLATES.admin = ALL_PERMISSIONS;

module.exports = { EXTRA_PERMISSIONS };
