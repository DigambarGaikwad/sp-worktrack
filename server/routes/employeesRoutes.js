// server/routes/employeesRoutes.js
// Employee API routes.

const express = require("express");
const { listEmployees } = require("../services/employeeService");

const router = express.Router();

/**
 * GET /api/employees
 * Returns active employees by default.
 *
 * Optional:
 * /api/employees?activeOnly=false
 */
router.get("/", async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly || "true").toLowerCase() !== "false";

    const employees = await listEmployees({
      activeOnly
    });

    res.json({
      ok: true,
      count: employees.length,
      employees
    });
  } catch (err) {
    console.error("GET /api/employees failed:", err);

    res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to fetch employees",
      details: err.details || null
    });
  }
});

module.exports = router;