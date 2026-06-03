// server/app.js
// SP WorkTrack DB Edition - API Server

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const employeesRoutes = require("./routes/employeesRoutes");
const adminRoutes = require("./routes/adminRoutes");
const adminRecoveryRoutes = require("./routes/adminRecoveryRoutes");
const productionRoutes = require("./routes/productionRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const emailRoutes = require("./routes/emailRoutes");
const backupRoutes = require("./routes/backupRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const { startBackupScheduler } = require("./services/backupScheduler");

dotenv.config();

const app = express();
const PORT = Number(process.env.SPWT_API_PORT || 3030);

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));

app.use("/api/employees", employeesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/pin", adminRecoveryRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/maintenance", maintenanceRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "SP WorkTrack API",
    mode: process.env.SPWT_STORAGE_MODE || "pocketbase",
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.send("SP WorkTrack API is running");
});

app.listen(PORT, () => {
  console.log(`SP WorkTrack API running on http://localhost:${PORT}`);
  startBackupScheduler();
});
