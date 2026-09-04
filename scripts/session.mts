// One desk session, start to finish — the whole system in a single command.
//
// The three Task Scheduler entries assumed a machine that is always on. This
// one does not: it runs everything the desk owes, in dependency order, and
// exits. Run it whenever the machine comes up.
//
//   npm run desk              # full session on every active swing portfolio
//   npm run desk -- 11        # just portfolio 11
//   npm run desk -- --no-research
//   npm run desk -- --research       # force the round even if it ran recently
//   npm run desk -- --if-stale=30    # do nothing if a session ran in the last 30 min
//
// ORDER MATTERS
//   1. intel   — cheap, no AI, and nothing downstream depends on it
//   2. manage  — exits BEFORE entries: a stop hit while the machine was off
//                must free its slot before the scanner competes for one
//   3. scan    — the AI pipeline (SCANNER -> HAWK -> SAGE -> Iron Rules)
//   4. ledger  — mature the counterfactual rows the scan just added to
//   5. research — weekly and expensive, so it is time-gated, not run every wake
//
// Every step is isolated: a failing intel refresh must not cost the desk its
// exits. Steps report and continue; the exit code reflects whether any failed.
import { prisma } from "@/lib/db";
import { refreshFinnhubNews, refreshFearGreed } from "@/lib/intel/news";
import { manageOpenTrades } from "@/lib/trading/manage";
import { runScheduledScan } from "@/lib/trading/runScan";
import { resolveCounterfactuals } from "@/lib/trading/counterfactual";
import { runScheduledResearchRound } from "@/lib/research/scheduledResearch";
import { isSwingKind, canPortfolioTrade } from "@/lib/portfolioGuards";
import { getSetting, setSetting } from "@/lib/settings";

// The old schedule was Sunday 06:00. Waking the machine on Tuesday should still
// run the round it missed; waking it again an hour later should not.
const RESEARCH_EVERY_DAYS = 7;

// When `npm run dev` triggers a session, restarting the dev server must not
// re-spend HAWK/SAGE calls on a bar that has not moved. The engine dedupes
// TRADES per bar, but a refused setup is re-judged on every scan, so the guard
// has to sit here — before the analysts are called at all.
const SESSION_KEY = "lastDeskSessionAt";

const args = process.argv.slice(2);
const portfolioIds = args.map(Number).filter(Number.isInteger);
const forceResearch = args.includes("--research");
const ifStaleArg = args.find((a) => a.startsWith("--if-stale="));
const ifStaleMin = ifStaleArg ? Number(ifStaleArg.slice("--if-stale=".length)) : null;
const skipResearch = args.includes("--no-research");

const ts = () => new Date().toISOString();
const log = (m: string) => console.log(`[${ts()}] ${m}`);

let failed = 0;

/** Run one step; a thrown error is reported and swallowed so the rest still run. */
async function step(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  log(`--- ${name}`);
  try {
    await fn();
  } catch (e) {
    failed++;
    log(`${name} FAILED ${String(e)}`);
  }
  log(`--- ${name} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/** Active swing portfolios, or exactly the ones named on the command line. */
async function targets() {
  const rows = await prisma.portfolio.findMany({
    where: portfolioIds.length ? { id: { in: portfolioIds } } : { status: "active", kind: "swing" },
  });
  return rows.filter((p) => isSwingKind(p.kind) && canPortfolioTrade(p.status));
}

async function researchDue(): Promise<{ due: boolean; why: string }> {
  if (skipResearch) return { due: false, why: "--no-research" };
  if (forceResearch) return { due: true, why: "--research" };
  const last = await prisma.researchRun.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!last) return { due: true, why: "no round has ever run" };
  const days = (Date.now() - last.createdAt.getTime()) / 86_400_000;
  return days >= RESEARCH_EVERY_DAYS
    ? { due: true, why: `last round ${days.toFixed(1)}d ago` }
    : { due: false, why: `last round ${days.toFixed(1)}d ago, due at ${RESEARCH_EVERY_DAYS}d` };
}

/** With --if-stale=N, a session that ran less than N minutes ago is enough. */
async function tooRecent(): Promise<string | null> {
  if (ifStaleMin == null || !Number.isFinite(ifStaleMin)) return null;
  const last = await getSetting(SESSION_KEY, "");
  if (!last) return null;
  const ageMin = (Date.now() - Date.parse(last)) / 60_000;
  return ageMin < ifStaleMin ? `last session ${ageMin.toFixed(0)}m ago, --if-stale=${ifStaleMin}` : null;
}

async function main() {
  const recent = await tooRecent();
  if (recent) { log(`desk session skipped — ${recent}`); return; }

  log(`desk session start${portfolioIds.length ? ` (portfolios ${portfolioIds.join(", ")})` : ""}`);

  await step("intel", async () => {
    const [news, fg] = await Promise.all([refreshFinnhubNews(), refreshFearGreed()]);
    log(`news inserted=${news.inserted} skipped=${news.skipped}${news.error ? ` error=${news.error}` : ""}`);
    log(`fearGreed ${fg ? `${fg.value} (${fg.label})` : "unavailable"}`);
  });

  await step("manage", async () => {
    for (const p of await targets()) {
      const r = await manageOpenTrades(p.id);
      if (r.checked === 0) continue;
      log(`#${p.id} ${p.name}: managed ${r.checked} open (closed ${r.closed.length}, tp1 ${r.partials.length})`);
      for (const c of r.closed) log(`  CLOSE ${c.symbol} ${c.outcome} @ ${c.price.toFixed(2)} pnl=${c.pnl.toFixed(2)}`);
      for (const pt of r.partials) log(`  TP1 ${pt.symbol} half @ ${pt.exit.toFixed(2)} banked=${pt.bankedPnl.toFixed(2)}`);
    }
  });

  await step("scan", async () => {
    for (const line of await runScheduledScan(portfolioIds)) log(line);
  });

  await step("ledger", async () => {
    for (const p of await targets()) {
      const r = await resolveCounterfactuals(p.id);
      if (r.checked === 0) continue;
      log(`#${p.id} ${p.name}: resolved ${r.resolved}/${r.checked} (${r.pending} still open)`);
    }
  });

  const research = await researchDue();
  if (!research.due) {
    log(`--- research skipped (${research.why})`);
  } else {
    await step(`research (${research.why})`, async () => {
      for (const line of await runScheduledResearchRound()) log(line);
    });
  }

  await setSetting(SESSION_KEY, new Date().toISOString());
  log(failed === 0 ? "desk session complete" : `desk session complete with ${failed} failed step(s)`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => { log(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
