// server/services/systemInfoService.js
// Detects current app URLs and network addresses without assuming IP/link values.

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

function appUrl(ip, port) {
  return `http://${ip}:${port}`;
}

function getIpv4Addresses() {
  const result = [];
  const nets = os.networkInterfaces();

  for (const [name, addresses] of Object.entries(nets)) {
    for (const item of addresses || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const ip = item.address;
      if (!ip || ip.startsWith("169.254.")) continue;

      result.push({
        name,
        ip,
        type: isTailscaleIp(ip) ? "tailscale" : isPrivateLanIp(ip) ? "lan" : "other"
      });
    }
  }

  return result.sort((a, b) => {
    const order = { lan: 0, tailscale: 1, other: 2 };
    return (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name);
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
  const port = Number(process.env.SPWT_API_PORT || 3030);
  const interfaces = getIpv4Addresses();
  const lan = interfaces.filter(i => i.type === "lan").map(i => ({ ...i, url: appUrl(i.ip, port) }));
  const tsFromInterface = interfaces.filter(i => i.type === "tailscale").map(i => i.ip);
  const tsCli = await getTailscaleIpsFromCli();
  const tsIps = Array.from(new Set([...tsFromInterface, ...(tsCli.ips || [])]));
  const tailscale = tsIps.map(ip => ({ ip, url: appUrl(ip, port) }));

  return {
    generatedAt: new Date().toISOString(),
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      nodeVersion: process.version,
      pid: process.pid,
      port,
      rootDir: process.cwd()
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
      tailscaleCli: tsCli.ok ? "ok" : `not available: ${tsCli.error || "unknown"}`
    },
    notes: [
      "Use LAN URL for devices on the same WiFi/LAN.",
      "Use Tailscale URL for approved VPN devices.",
      "localhost works only on the server PC."
    ]
  };
}

module.exports = { getSystemInfo };
