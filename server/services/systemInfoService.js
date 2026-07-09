// server/services/systemInfoService.js
// Detects current app URLs and non-sensitive server/network details.

const os = require("os");
const { execFile } = require("child_process");

function clean(value) {
  return String(value ?? "").trim();
}

function isPrivateLanIp(ip) {
  const parts = clean(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n))) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isTailscaleIp(ip) {
  const parts = clean(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n))) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function adapterScore(name = "", ip = "", type = "") {
  const n = clean(name).toLowerCase();
  if (type === "tailscale") return 50;
  if (n.includes("wi-fi") || n.includes("wifi") || n.includes("wireless") || n.includes("wlan")) return 0;
  if (n.includes("ethernet") || n.includes("local area connection")) return 5;
  if (n.includes("virtual") || n.includes("vmware") || n.includes("hyper-v") || n.includes("virtualbox") || n.includes("wsl") || n.includes("npcap") || n.includes("loopback")) return 80;
  if (ip.startsWith("192.168.")) return 10;
  if (ip.startsWith("10.")) return 20;
  if (ip.startsWith("172.")) return 30;
  return 40;
}

function appUrl(ip, port, path = "") {
  return `http://${ip}:${port}${path || ""}`;
}

function getIpv4Addresses() {
  const result = [];
  const nets = os.networkInterfaces();

  for (const [name, addresses] of Object.entries(nets)) {
    for (const item of addresses || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const ip = item.address;
      if (!ip || ip.startsWith("169.254.")) continue;

      const type = isTailscaleIp(ip) ? "tailscale" : isPrivateLanIp(ip) ? "lan" : "other";
      result.push({ name, ip, type, score: adapterScore(name, ip, type) });
    }
  }

  return result.sort((a, b) => {
    const order = { lan: 0, tailscale: 1, other: 2 };
    return (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.score - b.score || a.name.localeCompare(b.name);
  });
}

function execFileText(command, args = [], timeout = 2500) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: clean(stderr || err.message) });
      resolve({ ok: true, text: clean(stdout) });
    });
  });
}

async function getTailscaleIpsFromCli() {
  const out = await execFileText("tailscale", ["ip", "-4"]);
  if (!out.ok) return { ok: false, error: out.error, ips: [] };
  const ips = out.text.split(/\s+/).map(clean).filter(isTailscaleIp);
  return { ok: true, ips };
}

function buildRequestUrl(req, port) {
  const protocol = clean(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0] || "http";
  const host = clean(req.headers.host || `localhost:${port}`);
  return `${protocol}://${host}`;
}

async function getSystemInfo(req) {
  const port = Number(process.env.SPWT_API_PORT || 3032);
  const appRoot = clean(process.env.SPWT_APP_ROOT || process.cwd());
  const runtimeRoot = clean(process.env.SPWT_RUNTIME_ROOT || appRoot);
  const envFile = clean(process.env.SPWT_ENV_FILE || "");
  const interfaces = getIpv4Addresses();
  const lan = interfaces
    .filter(i => i.type === "lan")
    .map(i => ({ ...i, url: appUrl(i.ip, port), homeUrl: appUrl(i.ip, port, "/index.html"), healthUrl: appUrl(i.ip, port, "/api/health") }));
  const tsFromInterface = interfaces.filter(i => i.type === "tailscale").map(i => i.ip);
  const tsCli = await getTailscaleIpsFromCli();
  const tsIps = Array.from(new Set([...tsFromInterface, ...(tsCli.ips || [])]));
  const tailscale = tsIps.map(ip => ({ ip, url: appUrl(ip, port), homeUrl: appUrl(ip, port, "/index.html"), healthUrl: appUrl(ip, port, "/api/health") }));

  return {
    generatedAt: new Date().toISOString(),
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      nodeVersion: process.version,
      pid: process.pid,
      port,
      bindHost: "0.0.0.0 / all interfaces",
      appRoot,
      runtimeRoot,
      envFile,
      cwd: process.cwd()
    },
    current: {
      apiOrigin: buildRequestUrl(req, port),
      browserUrl: clean(req.query?.currentUrl || req.headers.referer || ""),
      homeFromRequest: `${buildRequestUrl(req, port)}/index.html`
    },
    urls: {
      localhost: appUrl("localhost", port),
      lan,
      tailscale
    },
    network: {
      interfaces,
      bestLanIp: lan[0]?.ip || "",
      bestLanUrl: lan[0]?.url || "",
      allLanUrls: lan.map(x => x.url),
      tailscaleCli: tsCli.ok ? "ok" : `not available: ${tsCli.error || "unknown"}`
    },
    notes: [
      "Use LAN URL only when the server PC and client device are on the same WiFi/LAN subnet.",
      "If LAN URL does not open from Android, first test the Health URL from Android browser.",
      "localhost works only on the server PC; never share localhost to another device.",
      "If Health URL works but app page does not, use /index.html URL.",
      "If no LAN URL works, allow SP WorkTrack/Electron/Node through Windows Firewall for the app port.",
      "Email, PocketBase, and Google Sheet settings are managed from the protected System Settings tab."
    ]
  };
}

module.exports = { getSystemInfo };
