// server/services/peopleDashboardServiceV5.js
// Wrapper over V4 to keep People Dashboard department cards people-relevant.

const { getPeopleDashboard: getPeopleDashboardV4 } = require("./peopleDashboardServiceV4");

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function isUsefulDepartment(dept) {
  return (
    num(dept.people, 0) > 0 ||
    num(dept.actualHours, 0) > 0 ||
    num(dept.standardHours, 0) > 0 ||
    num(dept.reworkHours, 0) > 0 ||
    num(dept.otherWorkHours, 0) > 0
  );
}

async function getPeopleDashboard(params = {}) {
  const data = await getPeopleDashboardV4(params);

  const usefulDepartments = (Array.isArray(data.departments) ? data.departments : [])
    .filter((dept) => clean(dept.department))
    .filter(isUsefulDepartment);

  data.departments = usefulDepartments;
  data.filterOptions = {
    ...(data.filterOptions || {}),
    departments: usefulDepartments.map((d) => clean(d.department)).filter(Boolean)
  };

  data.meta = {
    ...(data.meta || {}),
    service: "peopleDashboardServiceV5",
    departmentSource: "people-relevant departments only",
    departmentRule: "show department only when people or production hours exist"
  };

  return data;
}

module.exports = {
  getPeopleDashboard
};
