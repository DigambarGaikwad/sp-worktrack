window.SPWT_CONFIG = {
  // Google Sheet fallback / backup export config
  SHEETS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyKPCowoMoGe1fyqKMUOJYZkQG2bGT0QVjbIYdPnlw97lTtN1cscDs53puixXDQP5Ym/exec",
  SECRET: "DIGAMBAR",

  // DB Edition API
  // Local development:
  API_BASE_URL: "http://localhost:3030",

  // Data source control
  // "db" = load from PocketBase through Node API
  // "local" = old local JSON/adminOverrides fallback
  DATA_SOURCE: "db"
};

// Old / backup Google Apps Script URL
// window.SPWT_CONFIG = {
//   SHEETS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbzY35LcyEbDk8xw-siWtbhe-JbUJuJsmVcHhvq-_i-tOB17GJ8FTXy4XpKa4scEmPzE/exec",
//   SECRET: "DIGAMBAR",
//   API_BASE_URL: "http://localhost:3030",
//   DATA_SOURCE: "db"
// };