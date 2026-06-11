// NEXMIND orchestrator bot — schedules the desk against a running app server.
// All logic lives in the app; this script only decides WHEN to call it.
//   manage  every 5 min  (always — open positions must close even when halted)
//   scan    every 15 min (skipped while the kill switch is on)
//   intel   every 30 min (news + Fear & Greed)
// Run: npm run bot   (NEXMIND_URL overrides http://localhost:3000)

const BASE = process.env.NEXMIND_URL ?? "http://localhost:3000";
const MINUTE_MS = 60_000;

type Json = Record<string, unknown>;

function log(job: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${job.padEnd(6)} ${msg}`);
}

async function post(path: string): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return (await res.json()) as Json;
}

async function killSwitchOn(): Promise<boolean> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) return false; // fail open for reads; iron rules enforce server-side anyway
  return ((await res.json()) as { killSwitch?: boolean }).killSwitch === true;
}

async function runManage() {
  const r = await post("/api/manage");
  const closed = Array.isArray(r.closed) ? r.closed.length : 0;
  const partials = Array.isArray(r.partials) ? r.partials.length : 0;
  log("manage", `checked ${r.checked ?? 0} · closed ${closed} · partials ${partials}`);
}

async function runScan() {
  if (await killSwitchOn()) {
    log("scan", "kill switch on — skipped");
    return;
  }
  const r = await post("/api/scan-all");
  log("scan", `scanned ${r.scanned ?? 0} · executed ${r.executed ?? 0} · cost $${Number(r.totalCostUsd ?? 0).toFixed(4)}`);
}

async function runIntel() {
  const r = (await post("/api/intel/refresh")) as {
    news?: { inserted?: number };
    fearGreed?: { value: number; label: string } | null;
  };
  const fg = r.fearGreed ? `${r.fearGreed.value} (${r.fearGreed.label})` : "n/a";
  log("intel", `news +${r.news?.inserted ?? 0} · F&G ${fg}`);
}

const jobs = [
  { name: "manage", every: 5, run: runManage },
  { name: "scan", every: 15, run: runScan },
  { name: "intel", every: 30, run: runIntel },
];

let minutes = 0;
async function tick() {
  minutes++;
  for (const job of jobs) {
    if (minutes % job.every !== 0) continue;
    try {
      await job.run();
    } catch (e) {
      log(job.name, `ERROR ${(e as Error).message}`);
    }
  }
}

console.log(`NEXMIND bot → ${BASE} (manage 5m · scan 15m · intel 30m). Ctrl+C to stop.`);
void (async () => {
  // Run every job once at startup so output is immediate and wiring problems surface now.
  for (const job of jobs) {
    try {
      await job.run();
    } catch (e) {
      log(job.name, `ERROR ${(e as Error).message}`);
    }
  }
})();

const timer = setInterval(() => void tick(), MINUTE_MS);
process.on("SIGINT", () => {
  clearInterval(timer);
  console.log("\nbot stopped");
  process.exit(0);
});
