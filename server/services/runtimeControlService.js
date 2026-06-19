// server/services/runtimeControlService.js
// Runtime status and Windows Task Scheduler helpers for SP WorkTrack deployment prep.

const fs = require("fs/promises");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "../..");
const RUNTIME_DIR = path.join(ROOT_DIR, "runtime_scripts");
const LOG_DIR = path.join(ROOT_DIR, "runtime_logs");
const POCKETBASE_DIR = path.join(ROOT_DIR, "local-tools", "pocketbase");
const POCKETBASE_EXE = path.join(POCKETBASE_DIR, "pocketbase.exe");
const NODE_TASK = "SP WorkTrack Node Server";
const POCKETBASE_TASK = "SP WorkTrack PocketBase";
const DEFAULT_NODE_PORT = Number(process.env.SPWT_API_PORT || 3030);
const DEFAULT_PB_PORT = 8090;

function isWindows() {
  return process.platform === "win32";
}

function quotePs(value) {
  return String(value || "").replace(/'/g, "''");
}

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(Object.assign(new Error(stderr || stdout || `${command} failed with exit code ${code}`), result));
    });
  });
}

function runPowerShell(script, options = {}) {
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], options);
}

function portOpen(host, port, timeoutMs = 800) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function pathExists(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size };
  } catch (err) {
    if (err?.code === "ENOENT") return { exists: false, isFile: false, isDirectory: false, size: 0 };
    throw err;
  }
}

async function getTaskStatus(taskName) {
  if (!isWindows()) return { taskName, exists: false, status: "Unsupported", message: "Task Scheduler is Windows-only." };
  const result = await run("schtasks.exe", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"], { allowFailure: true });
  if (result.code !== 0) return { taskName, exists: false, status: "Not Created", message: result.stderr || result.stdout || "Task not found." };

  const text = result.stdout || "";
  const statusMatch = text.match(/^Status:\s*(.+)$/mi);
  const nextRunMatch = text.match(/^Next Run Time:\s*(.+)$/mi);
  const lastRunMatch = text.match(/^Last Run Time:\s*(.+)$/mi);
  const lastResultMatch = text.match(/^Last Result:\s*(.+)$/mi);
  return {
    taskName,
    exists: true,
    status: (statusMatch?.[1] || "Created").trim(),
    nextRun: (nextRunMatch?.[1] || "").trim(),
    lastRun: (lastRunMatch?.[1] || "").trim(),
    lastResult: (lastResultMatch?.[1] || "").trim()
  };
}

async function getProcessSummary() {
  if (!isWindows()) return { pocketbase: [], node: [] };
  const script = `
$items = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','pocketbase.exe') } | Select-Object ProcessId,Name,CommandLine
$items | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(script, { allowFailure: true });
  if (result.code !== 0 || !result.stdout) return { pocketbase: [], node: [] };
  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return {
      pocketbase: rows.filter(p => /pocketbase\.exe/i.test(p.Name || "")),
      node: rows.filter(p => /node\.exe/i.test(p.Name || "") && /server\\app\.js|server\/app\.js|npm/i.test(p.CommandLine || ""))
    };
  } catch {
    return { pocketbase: [], node: [] };
  }
}

async function writeRuntimeScripts() {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });

  const pocketbaseScript = path.join(RUNTIME_DIR, "start-pocketbase.ps1");
  const nodeScript = path.join(RUNTIME_DIR, "start-node-server.ps1");
  const launcherScript = path.join(RUNTIME_DIR, "start-sp-worktrack.ps1");

  await fs.writeFile(pocketbaseScript, [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location '${quotePs(POCKETBASE_DIR)}'`,
    `New-Item -ItemType Directory -Path '${quotePs(LOG_DIR)}' -Force | Out-Null`,
    `& '${quotePs(POCKETBASE_EXE)}' serve --http 127.0.0.1:${DEFAULT_PB_PORT} *> '${quotePs(path.join(LOG_DIR, "pocketbase.log"))}'`
  ].join("\r\n"), "utf8");

  await fs.writeFile(nodeScript, [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location '${quotePs(ROOT_DIR)}'`,
    `New-Item -ItemType Directory -Path '${quotePs(LOG_DIR)}' -Force | Out-Null`,
    "$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source",
    "if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }",
    "if (-not $npm) { throw 'npm command not found. Install Node.js or add npm to PATH.' }",
    `& $npm run server *> '${quotePs(path.join(LOG_DIR, "node-server.log"))}'`
  ].join("\r\n"), "utf8");

  await fs.writeFile(launcherScript, [
    "$ErrorActionPreference = 'Continue'",
    `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${quotePs(pocketbaseScript)}"' -WindowStyle Minimized`,
    "Start-Sleep -Seconds 2",
    `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${quotePs(nodeScript)}"' -WindowStyle Minimized`,
    `Start-Process 'http://localhost:${DEFAULT_NODE_PORT}'`
  ].join("\r\n"), "utf8");

  return { pocketbaseScript, nodeScript, launcherScript, runtimeDir: RUNTIME_DIR, logDir: LOG_DIR };
}

function taskCommand(scriptPath) {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
}

async function createOrUpdateTasks() {
  if (!isWindows()) throw new Error("Task Scheduler setup is supported only on Windows.");
  const scripts = await writeRuntimeScripts();
  const pb = await pathExists(POCKETBASE_EXE);
  if (!pb.exists) throw new Error(`PocketBase executable not found: ${POCKETBASE_EXE}`);

  const pbResult = await run("schtasks.exe", ["/Create", "/TN", POCKETBASE_TASK, "/SC", "ONSTART", "/TR", taskCommand(scripts.pocketbaseScript), "/RL", "HIGHEST", "/F"], { allowFailure: true });
  const nodeResult = await run("schtasks.exe", ["/Create", "/TN", NODE_TASK, "/SC", "ONSTART", "/TR", taskCommand(scripts.nodeScript), "/RL", "HIGHEST", "/F"], { allowFailure: true });

  const ok = pbResult.code === 0 && nodeResult.code === 0;
  return {
    ok,
    scripts,
    pocketbaseTask: pbResult,
    nodeTask: nodeResult,
    message: ok ? "Auto-start tasks created/updated." : "Task creation failed. Run server/terminal as Administrator and try again."
  };
}

async function removeTasks() {
  if (!isWindows()) throw new Error("Task Scheduler is supported only on Windows.");
  const pbResult = await run("schtasks.exe", ["/Delete", "/TN", POCKETBASE_TASK, "/F"], { allowFailure: true });
  const nodeResult = await run("schtasks.exe", ["/Delete", "/TN", NODE_TASK, "/F"], { allowFailure: true });
  return { pocketbaseTask: pbResult, nodeTask: nodeResult, message: "Auto-start task delete command completed." };
}

async function runTask(taskName) {
  if (!isWindows()) throw new Error("Task Scheduler is supported only on Windows.");
  const result = await run("schtasks.exe", ["/Run", "/TN", taskName], { allowFailure: true });
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `Failed to run task ${taskName}`);
  return { taskName, message: `Task started: ${taskName}` };
}

async function stopPocketBaseProcesses() {
  if (!isWindows()) throw new Error("PocketBase stop button is supported only on Windows in this build.");
  const script = `
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pocketbase.exe' }
$count = 0
foreach ($p in $procs) { try { Invoke-CimMethod -InputObject $p -MethodName Terminate | Out-Null; $count++ } catch {} }
Write-Output $count
`;
  const result = await runPowerShell(script, { allowFailure: true });
  return { stopped: Number((result.stdout || "0").trim()) || 0, message: "PocketBase stop command completed." };
}

async function getRuntimeStatus() {
  const [nodePortOpen, pbPortOpen, pbExe, pbDir, rootDir, processes, pbTask, nodeTask] = await Promise.all([
    portOpen("127.0.0.1", DEFAULT_NODE_PORT),
    portOpen("127.0.0.1", DEFAULT_PB_PORT),
    pathExists(POCKETBASE_EXE),
    pathExists(POCKETBASE_DIR),
    pathExists(ROOT_DIR),
    getProcessSummary(),
    getTaskStatus(POCKETBASE_TASK),
    getTaskStatus(NODE_TASK)
  ]);

  return {
    server: {
      rootDir: ROOT_DIR,
      runtimeDir: RUNTIME_DIR,
      logDir: LOG_DIR,
      nodePort: DEFAULT_NODE_PORT,
      pocketBasePort: DEFAULT_PB_PORT,
      platform: process.platform,
      nodeVersion: process.version,
      currentNodePid: process.pid
    },
    node: {
      running: true,
      portOpen: nodePortOpen,
      status: nodePortOpen ? "Running" : "Current API running, but port check failed",
      note: "This page itself is served by Node, so if you can see this status then Node is currently running."
    },
    pocketbase: {
      running: pbPortOpen || processes.pocketbase.length > 0,
      portOpen: pbPortOpen,
      exeExists: pbExe.exists,
      dirExists: pbDir.exists,
      exePath: POCKETBASE_EXE,
      processCount: processes.pocketbase.length,
      status: (pbPortOpen || processes.pocketbase.length > 0) ? "Running" : "Not detected"
    },
    tasks: {
      pocketbase: pbTask,
      node: nodeTask
    },
    scripts: await writeRuntimeScripts(),
    guidance: [
      "Create Auto-Start Tasks once on the server PC, preferably from an Administrator terminal.",
      "Start PocketBase can be triggered from this screen after task creation.",
      "Stopping Node will disconnect this browser because Node serves the app.",
      "If Node is stopped, start it from Task Scheduler or Start SP WorkTrack script on the server PC."
    ]
  };
}

module.exports = {
  NODE_TASK,
  POCKETBASE_TASK,
  getRuntimeStatus,
  createOrUpdateTasks,
  removeTasks,
  runTask,
  stopPocketBaseProcesses
};
