window.SPWT_CONFIG = {
  // Google Sheet fallback / backup export config
  SHEETS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyKPCowoMoGe1fyqKMUOJYZkQG2bGT0QVjbIYdPnlw97lTtN1cscDs53puixXDQP5Ym/exec",
  SECRET: "DIGAMBAR",

  // DB Edition API
  // Local development / V2 side-by-side fallback:
  API_BASE_URL: window.location.protocol === "file:" ? "http://localhost:3032" : window.location.origin,

  // Data source control
  // "db" = load from PocketBase through Node API
  // "local" = old local JSON/adminOverrides fallback
    DATA_SOURCE: "db",

  // Submit control
  // "db" = submit production entries to PocketBase through Node API
  // "sheets" = old Google Sheet submit
  SUBMIT_TARGET: "db",
  ENABLE_SHEETS_FALLBACK: true
};

// Old / backup Google Apps Script URL
// window.SPWT_CONFIG = {
//   SHEETS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbzY35LcyEbDk8xw-siWtbhe-JbUJuJsmVcHhvq-_i-tOB17GJ8FTXy4XpKa4scEmPzE/exec",
//   SECRET: "DIGAMBAR",
//   API_BASE_URL: window.location.protocol === "file:" ? "http://localhost:3032" : window.location.origin,
//   DATA_SOURCE: "db"
// };
