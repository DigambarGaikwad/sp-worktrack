// server/app.js
// SP WorkTrack DB Edition - API Server
// This server will sit between Electron frontend and PocketBase / future company DB.

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const employeesRoutes = require("./routes/employeesRoutes");

dotenv.config();

const app = express();

const PORT = Number(process.env.SPWT_API_PORT || 3030);

// ---------- Middleware ----------
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));

// ---------- Routes ----------
app.use("/api/employees", employeesRoutes);
// ---------- Health Check ----------
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "SP WorkTrack API",
    mode: process.env.SPWT_STORAGE_MODE || "pocketbase",
    timestamp: new Date().toISOString()
  });
});

// ---------- Temporary root ----------
app.get("/", (req, res) => {
  res.send("SP WorkTrack API is running ✅");
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`SP WorkTrack API running on http://localhost:${PORT}`);
});