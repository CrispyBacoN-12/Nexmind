// NEXMIND orchestrator bot — schedules every active swing desk against a
// running app server. All logic lives in the app; this script only decides
// WHEN to call it, and for WHICH portfolios (fetched live, not hardcoded).
//   manage  every 5 min  (always — open positions must close even when halted)
//   scan    every 15 min (watchlist + universe preset per desk; skipped while the kill switch is on)
//   intel   every 30 min (news + Fear & Greed)
// Run: npm run bot   (NEXMIND_URL overrides http://localhost:3275)

const BASE = process.env.NEXMIND_URL ?? "http://localhost:3275";
const MINUTE_MS = 60_000;

type Json = Record<string, unknown>;
interface Portfolio { id: number; name: string; kind: string; universe: string }

import { SECONDARY_PASSES } from "../src/lib/trading/secondaryPasses";

function log(job: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${job.padEnd(6)} ${msg}`);
}

async function post(path: string, body?: Json): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return (await res.json()) as Json;
}

async function killSwitchOn(): Promise<boolean> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) return false; // fail open for reads; iron rules enforce server-side anyway
  return ((await res.json()) as { killSwitch?: boolean }).killSwitch === true;
}

async function activeSwingPortfolios(): Promise<Portfolio[]> {
  const res = await fetch(`${BASE}/api/portfolios`);
  if (!res.ok) throw new Error(`GET /api/portfolios → HTTP ${res.status}`);
  const all = (await res.json()) as Portfolio[];
  return all.filter((p) => p.kind === "swing");
}

async function runManage() {
  const portfolios = await activeSwingPortfolios();
  for (const p of portfolios) {
    try {
      const r = await post("/api/manage", { portfolioId: p.id });
      const closed = Array.isArray(r.closed) ? r.closed.length : 0;
      const partials = Array.isArray(r.partials) ? r.partials.length : 0;
      log("manage", `${p.name}: checked ${r.checked ?? 0} · closed ${closed} · partials ${partials}`);
    } catch (e) {
      log("manage", `${p.name}: ERROR ${(e as Error).message}`);
    }
  }
}

async function runScan() {
  if (await killSwitchOn()) {
    log("scan", "kill switch on — skipped");
    return;
  }
  const portfolios = await activeSwingPortfolios();
  for (const p of portfolios) {
    try {
      const r = await post("/api/scan-all", { portfolioId: p.id });
      log("scan", `${p.name} (watchlist): scanned ${r.scanned ?? 0} · executed ${r.executed ?? 0} · cost $${Number(r.totalCostUsd ?? 0).toFixed(4)}`);
    } catch (e) {
      log("scan", `${p.name} (watchlist): ERROR ${(e as Error).message}`);
    }
    if (!p.universe) continue;
    try {
      const u = await post("/api/scan-universe", { portfolioId: p.id, preset: p.universe, max: 120 });
      const setups = Array.isArray(u.setups) ? u.setups.length : 0;
      log("scan", `${p.name} (${p.universe}): scanned ${u.scanned ?? 0} · setups ${setups} · executed ${u.executed ?? 0} · cost $${Number(u.totalCostUsd ?? 0).toFixed(4)}`);
    } catch (e) {
      log("scan", `${p.name} (${p.universe}): ERROR ${(e as Error).message}`);
    }
  }

  for (const sp of SECONDARY_PASSES) {
    const p = portfolios.find((x) => x.id === sp.portfolioId);
    if (!p) continue; // portfolio archived/missing — skip silently, don't block the other passes
    try {
      const r = await post("/api/scan-all", { portfolioId: sp.portfolioId, strategy: sp.strategy, interval: sp.interval, range: sp.range });
      log("scan", `${p.name} [+${sp.label}]: scanned ${r.scanned ?? 0} · executed ${r.executed ?? 0} · cost $${Number(r.totalCostUsd ?? 0).toFixed(4)}`);
    } catch (e) {
      log("scan", `${p.name} [+${sp.label}]: ERROR ${(e as Error).message}`);
    }
  }
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
