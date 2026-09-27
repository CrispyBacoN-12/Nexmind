// Test B — residual momentum as the slot queue for daily mr-down3.
//
// WHY THIS EXISTS
//
// mr-down3 fires ~40 times a day across the panel and the book holds 5 slots,
// so which signals get the slots is a rule of its own, and no ranking has ever
// been tested. This asks whether ranking the day's candidates by 12-month
// residual momentum (single-index vs SPY, most recent month skipped) fills the
// slots with better trades than a random queue, under the portfolio rule the
// owner actually trades under (src/lib/portfolio/, strictMode true), after
// 5bps+1bp costs and overnight gap-through on stops.
//
// THE PRE-REGISTRATION IS docs/quant/PRE_REGISTRATION_TEST_B.md, committed
// (df0f51a) before this file existed. Every rule below implements a section of
// it and cites it; where this code and that document disagree, the document
// wins and the run is void. The verdict block prints exactly the conjunct rule
// of §7 and nothing else decides it.
//
// Two implementation shortcuts are EQUIVALENT to the document's semantics and
// are checked at run time rather than trusted:
//   * correlation: a union-calendar version of dateAlignedCorrelation, checked
//     against the real function on 200 random (pair, date) samples to 1e-9;
//   * NAV history: readNav reads only the latest point, the one before it and
//     the maximum, so the walk passes those three. Checked against the full
//     history on every day of the treatment walk.
// Aborting checks run BEFORE any queue is walked: trade-set reproduction (§3),
// correlation equivalence (§5), and no-lookahead asserts throughout (§5).
//
//   node --env-file=.env --import tsx scripts/cache-sp500-sectors.mts          (once, first)
//   node --env-file=.env --import tsx scripts/test-b-residual-momentum-queue.mts | tee scripts/test-b-residual-momentum-queue.log
//   node --env-file=.env --import tsx scripts/test-b-residual-momentum-queue.mts --walks=2   (smoke run, prints no result)

import { existsSync, readFileSync } from "node:fs";

import { computeEntrySignals, type CostModel, type EntrySignals, type SimTrade } from "@/lib/backtest/engine";
import { gapRisk } from "@/lib/advisor/gapRisk";
import type { Candle } from "@/lib/indicators";
import { allocateSlots, byScoreDesc, type RankedCandidate } from "@/lib/portfolio/allocate";
import { readNav } from "@/lib/portfolio/evaluate";
import { dateAlignedCorrelation, regimeFromBenchmark } from "@/lib/portfolio/marketInputs";
import { resolveGicsSector, type ResolvedSector } from "@/lib/portfolio/sectorMap";
import { DEFAULT_PORTFOLIO_CONFIG, GATE_ORDER, type GateName, type NavPoint, type PortfolioSlot } from "@/lib/portfolio/types";
import { mulberry32, percentile } from "@/lib/research/control";
import { LADDERS, mechanismByKey } from "@/lib/research/mechanisms";
import { DEEP_FOLD_LIST, DEEP_PANEL_CACHE_PATH, loadPanel, type Fold } from "@/lib/research/panel";
import { PANEL_SEED, simulateFold, sliceFold, withSignals } from "@/lib/research/panelRun";

// ---- fixed by the pre-registration ------------------------------------------
const MECH = mechanismByKey("mr-down3"); // §3
const EXIT = LADDERS.flat; // §3
const COSTS_VERDICT: CostModel = { slippageBps: 5, commissionBps: 1 }; // §3, = EQUITY_COST_MODEL
const COSTS_CONTEXT: CostModel = { slippageBps: 0.5, commissionBps: 1 }; // §3, context only
const SECTOR_CACHE_PATH = ".cache/sectors/sp500-deep-finnhub-industry.json"; // §5
const BETA_FROM = 273; // §4: beta over k in [t-273, t-22]
const SCORE_FROM = 147; // §4: score over k in [t-147, t-22]
const SKIP = 22;
const COVERAGE = 0.9; // §4
const NULL_SCORE = -1e12; // §4: a null score ranks below every scored candidate, ticker breaks ties
const GAP_LOOKBACK = 504; // §5: gapRisk on bars in (t-504, t]
const GAP_SL_MULT = 1.5; // §5: the ladder's slMult
const C_VERDICT = 100_000; // §5
const C_SMALL = 2_500; // §5, context only
const RISK_PCT = DEFAULT_PORTFOLIO_CONFIG.riskPctPerTrade; // 1%
const CONTROL_WALKS = 500; // §6
const CONTROL_P = 0.95; // §7
const CORR_SAMPLES = 200; // §5
const CFG = DEFAULT_PORTFOLIO_CONFIG;

/** §3 reproduction targets, from scripts/mr-down3-open-fill.log (5bps+1bp, next-bar open). */
const REPRO: Record<string, { trades: number; avgR: string }> = {
  deep1: { trades: 30168, avgR: "0.011" },
  deep2: { trades: 33196, avgR: "0.012" },
  deep3: { trades: 41468, avgR: "0.055" },
};
/** Same log, 0.5bps+1bp — checked too, since the context row uses that trade set. */
const REPRO_CONTEXT: Record<string, { trades: number; avgR: string }> = {
  deep1: { trades: 30101, avgR: "0.032" },
  deep2: { trades: 33117, avgR: "0.037" },
  deep3: { trades: 41365, avgR: "0.085" },
};

const walksArg = process.argv.find((a) => a.startsWith("--walks="));
const WALKS = walksArg ? Number(walksArg.split("=")[1]) : CONTROL_WALKS;
const SMOKE = WALKS !== CONTROL_WALKS;

// ---- small helpers ----------------------------------------------------------
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.log(`\n*** ABORT: ${msg} ***\n    No verdict. The run is void.`);
    process.exit(2);
  }
}

/** Push every signal one bar later, so a close-derived decision fills at the next open (§3). */
const shift1 = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

// ---- data -------------------------------------------------------------------
const panel = loadPanel(DEEP_PANEL_CACHE_PATH);
const SPY = panel.bars.SPY;
assert(SPY?.length, "SPY missing from the deep panel");
const SYMBOLS = panel.symbols.filter((s) => s !== "SPY"); // §2: SPY is not traded

assert(existsSync(SECTOR_CACHE_PATH), `sector cache missing at ${SECTOR_CACHE_PATH}; run scripts/cache-sp500-sectors.mts first`);
const sectorCache = JSON.parse(readFileSync(SECTOR_CACHE_PATH, "utf8")) as Record<string, { industry: string | null; note: string | null }>;
const SECTOR: Record<string, ResolvedSector> = {};
for (const s of SYMBOLS) {
  const e = sectorCache[s];
  assert(e, `sector cache has no entry for ${s}`);
  assert(!(e.note && /HTTP|error|fetch|not set/i.test(e.note)), `sector fetch failed for ${s}: ${e.note}`);
  SECTOR[s] = resolveGicsSector(s, e.industry);
}

// Union calendar over every bar date in the panel: the correlation's date
// pairing (§5) is over dates on which BOTH names have a return, whichever those are.
const U_DATES = [...new Set(Object.values(panel.bars).flatMap((bars) => bars.map((b) => day(b.t))))].sort();
const U_IDX = new Map(U_DATES.map((d, i) => [d, i]));
const NU = U_DATES.length;

interface SymData {
  bars: Candle[];
  dates: string[];
  barIdx: Map<string, number>;
  /** close-to-close return keyed by the later bar's date, on the union calendar (NaN = none) */
  retU: Float64Array;
  /** index of the last bar dated <= each union date (-1 = none) */
  lastBarU: Int32Array;
}
const DATA: Record<string, SymData> = {};
for (const s of panel.symbols) {
  const bars = panel.bars[s];
  const dates = bars.map((b) => day(b.t));
  const retU = new Float64Array(NU).fill(NaN);
  const lastBarU = new Int32Array(NU).fill(-1);
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    if (prev > 0 && Number.isFinite(bars[i].c)) retU[U_IDX.get(dates[i])!] = bars[i].c / prev - 1; // = returnsByDate
  }
  let j = -1;
  for (let u = 0, b = 0; u < NU; u++) {
    while (b < dates.length && dates[b] <= U_DATES[u]) j = b++;
    lastBarU[u] = j;
  }
  DATA[s] = { bars, dates, barIdx: new Map(dates.map((d, i) => [d, i])), retU, lastBarU };
}

const SPY_DATES = DATA.SPY.dates;
/** Union index of each SPY date — §4's calendar is SPY's trading dates. */
const SPY_U = SPY_DATES.map((d) => U_IDX.get(d)!);
/** Index of the last SPY date <= d (or < d when strict). */
function spyIndexAtOrBefore(d: string, strict = false): number {
  let lo = 0;
  let hi = SPY_DATES.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? SPY_DATES[mid] < d : SPY_DATES[mid] <= d) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
function uIndexAtOrBefore(d: string): number {
  let lo = 0;
  let hi = NU - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (U_DATES[mid] <= d) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// ---- §4 the score -----------------------------------------------------------
/** Residual momentum at signal date t, or null under 90% coverage of either window. */
function residualMomentum(sym: string, t: string): number | null {
  const j = spyIndexAtOrBefore(t);
  if (j - BETA_FROM < 1) return null;
  const ri = DATA[sym].retU;
  const rm = DATA.SPY.retU;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = j - BETA_FROM; k <= j - SKIP; k++) {
    const x = rm[SPY_U[k]];
    const y = ri[SPY_U[k]];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < COVERAGE * (BETA_FROM - SKIP + 1)) return null;
  const varx = sxx - (sx * sx) / n;
  if (!(varx > 0)) return null;
  const beta = (sxy - (sx * sy) / n) / varx;

  let m = 0;
  let score = 0;
  for (let k = j - SCORE_FROM; k <= j - SKIP; k++) {
    const x = rm[SPY_U[k]];
    const y = ri[SPY_U[k]];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    m++;
    score += y - beta * x;
  }
  if (m < COVERAGE * (SCORE_FROM - SKIP + 1)) return null;
  assert(SPY_DATES[j - SKIP] <= t, `score window reads past t for ${sym} @ ${t}`); // §5 no-lookahead
  return score;
}

// ---- §5 gate inputs -----------------------------------------------------------
/** dateAlignedCorrelation over candles through date d, on the union calendar. */
const corrMemo = new Map<string, number | null>();
function correlationAt(a: string, b: string, uEnd: number): number | null {
  const key = a < b ? `${a}|${b}|${uEnd}` : `${b}|${a}|${uEnd}`;
  const hit = corrMemo.get(key);
  if (hit !== undefined) return hit;
  const ra = DATA[a].retU;
  const rb = DATA[b].retU;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let u = uEnd; u >= 0 && xs.length < 60; u--) {
    if (Number.isFinite(ra[u]) && Number.isFinite(rb[u])) {
      xs.push(ra[u]);
      ys.push(rb[u]);
    }
  }
  let out: number | null = null;
  if (xs.length >= 40) {
    xs.reverse();
    ys.reverse();
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    out = vx === 0 || vy === 0 ? null : cov / Math.sqrt(vx * vy);
  }
  if (corrMemo.size > 2_000_000) corrMemo.clear(); // a cache, not state: bounded so 500 walks fit in memory
  corrMemo.set(key, out);
  return out;
}

const regimeMemo = new Map<number, ReturnType<typeof regimeFromBenchmark>>();
function regimeAtSpyIndex(j: number) {
  if (!regimeMemo.has(j)) regimeMemo.set(j, j < 0 ? null : regimeFromBenchmark(SPY.slice(0, j + 1)));
  return regimeMemo.get(j)!;
}

// ---- §3 candidates -------------------------------------------------------------
interface Cand {
  sym: string;
  fill: string; // D
  sig: string; // t
  close: string;
  entry: number;
  sl: number;
  risk: number;
  rRaw: number | null;
  rAdj: number | null;
  /** net P&L per share, gap-adjusted (= rAdj x risk when r exists) */
  pnlAdj: number;
  gapped: boolean;
  score: number | null;
  worstLossR: number | null;
  sector: ResolvedSector;
}

const featMemo = new Map<string, { score: number | null; worstLossR: number | null }>();
function candidateOf(t: SimTrade, slipBps: number): Cand {
  const d = DATA[t.symbol];
  const fill = day(t.openedAt.getTime() / 1000);
  const close = day(t.closedAt.getTime() / 1000);
  const fi = d.barIdx.get(fill);
  assert(fi != null && fi >= 1, `fill bar not found for ${t.symbol} @ ${fill}`);
  const sig = d.dates[fi - 1];
  assert(sig < fill, `signal date ${sig} not before fill ${fill} for ${t.symbol}`); // §5 no-lookahead

  const key = `${t.symbol}|${fill}`;
  let feat = featMemo.get(key);
  if (!feat) {
    const window = d.bars.slice(Math.max(0, fi - GAP_LOOKBACK), fi); // bars in (t-504, t]
    assert(day(window[window.length - 1].t) === sig, `gapRisk window does not end at t for ${key}`); // §5
    feat = { score: residualMomentum(t.symbol, sig), worstLossR: gapRisk(window, GAP_SL_MULT)?.worstLossR ?? null };
    featMemo.set(key, feat);
  }

  // §3 gap slippage on stops: re-price a loss to the exit bar's open when it opened through the stop.
  const risk = Math.abs(t.entry - t.sl);
  let delta = 0;
  if (t.outcome === "loss" && close !== fill) {
    const bar = d.bars[d.barIdx.get(close)!];
    if (bar.o < t.sl) {
      delta = t.exit - bar.o * (1 - slipBps / 10000);
      assert(delta > 0, `gap adjustment not adverse for ${key}`);
    }
  }
  return {
    sym: t.symbol,
    fill,
    sig,
    close,
    entry: t.entry,
    sl: t.sl,
    risk,
    rRaw: t.rMultiple,
    rAdj: t.rMultiple == null ? null : t.rMultiple - delta / risk,
    pnlAdj: t.pnl / t.lot - delta,
    gapped: delta > 0,
    score: feat.score,
    worstLossR: feat.worstLossR,
    sector: SECTOR[t.symbol],
  };
}

// ---- §5 the walk ---------------------------------------------------------------
interface Taken {
  c: Cand;
  shares: number;
  bottleneck: boolean;
}
interface WalkResult {
  taken: Taken[];
  blocks: Record<GateName, number>;
  zeroShareRejects: number;
  candidateDays: number;
  bottleneckDays: number;
  unfilledDays: number;
  safeModeDays: number;
  staleNavDays: number;
  finalNav: number;
  maxDdPct: number;
}

interface FoldBook {
  fold: Fold;
  calendar: string[];
  seedDate: string;
  byDay: Map<string, Cand[]>;
  /** every candidate in the fold, in the fixed §6 draw order (fill date, then ticker) */
  ordered: Cand[];
}

function buildBook(fold: Fold, cands: Cand[]): FoldBook {
  const ordered = [...cands].sort((a, b) => (a.fill < b.fill ? -1 : a.fill > b.fill ? 1 : a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0));
  const byDay = new Map<string, Cand[]>();
  for (const c of ordered) (byDay.get(c.fill) ?? byDay.set(c.fill, []).get(c.fill)!).push(c);
  const spyIn = SPY_DATES.filter((d) => d >= fold.from && d < fold.to);
  const calendar = [...new Set([...spyIn, ...byDay.keys()])].sort();
  const seedIdx = spyIndexAtOrBefore(fold.from, true);
  assert(seedIdx >= 0, `no SPY session before ${fold.name}`);
  return { fold, calendar, seedDate: SPY_DATES[seedIdx], byDay, ordered };
}

function walk(book: FoldBook, scores: Map<Cand, number>, C: number, checkNav: boolean): WalkResult {
  const baseShares = (c: Cand) => Math.max(0, Math.min(Math.floor((C * RISK_PCT) / 100 / (c.entry - c.sl)), Math.floor(C / CFG.maxSlots / c.entry)));
  const blocks = Object.fromEntries(GATE_ORDER.map((g) => [g, 0])) as Record<GateName, number>;
  const out: WalkResult = {
    taken: [],
    blocks,
    zeroShareRejects: 0,
    candidateDays: 0,
    bottleneckDays: 0,
    unfilledDays: 0,
    safeModeDays: 0,
    staleNavDays: 0,
    finalNav: C,
    maxDdPct: 0,
  };

  // NAV: seeded with C the session before the fold (§5); compact = [peak, prev, last].
  let last: NavPoint = { date: book.seedDate, nav: C };
  let prev: NavPoint | null = null;
  let peak: NavPoint = last;
  const full: NavPoint[] = [last];
  let realized = 0;
  let open: Array<{ c: Cand; shares: number }> = [];

  for (const D of book.calendar) {
    const cands = book.byDay.get(D);
    if (cands?.length) {
      out.candidateDays++;
      const compact = [peak, prev, last].filter((p, i, arr): p is NavPoint => p != null && arr.findIndex((q) => q === p) === i);
      assert(last.date < D, `NAV history reaches ${last.date} on fill day ${D}`); // §5 no-lookahead
      if (checkNav) {
        const a = JSON.stringify(readNav(full, D, CFG.navStaleDays));
        const b = JSON.stringify(readNav(compact, D, CFG.navStaleDays));
        assert(a === b, `compact NAV history diverges from the full history on ${D}`);
      }
      const nav = readNav(compact, D, CFG.navStaleDays);
      if (nav.nav == null) out.staleNavDays++;
      else if ((nav.peakDrawdownPct ?? 0) >= CFG.drawdownSafeModePct) out.safeModeDays++;

      const jPrev = spyIndexAtOrBefore(D, true);
      assert(jPrev < 0 || SPY_DATES[jPrev] < D, "regime reads the fill day");
      const regime = regimeAtSpyIndex(jPrev);
      const cap = regime == null ? 0 : regime.spyClose < regime.spySma200 ? CFG.riskOffMaxSlots : CFG.maxSlots;
      const uEnd = uIndexAtOrBefore(last.date); // = close of t: no candidate symbol has a bar between t and D
      assert(U_DATES[uEnd] < D, "correlation reads the fill day");
      const correlationOf = (a: string, b: string) => correlationAt(a, b, uEnd);

      let slots: PortfolioSlot[] = open.map(({ c, shares }) => ({ ticker: c.sym, sector: c.sector, shares, entry: c.entry, stop: c.sl, worstLossR: c.worstLossR }));
      const bottleneck = cands.length > Math.max(0, cap - slots.length);
      if (bottleneck) out.bottleneckDays++;

      const ranked: RankedCandidate[] = cands
        .map((c) => ({ ticker: c.sym, sector: c.sector, baseShares: baseShares(c), entry: c.entry, stop: c.sl, worstLossR: c.worstLossR, score: scores.get(c)! }))
        .sort(byScoreDesc);
      const bySym = new Map(cands.map((c) => [c.sym, c]));

      // §5.2: fed one at a time in queue order, stopping once the book is at its cap —
      // identical to one allocateSlots call, since CAPACITY/REGIME block every later name.
      for (const rc of ranked) {
        if (slots.length >= cap) break;
        const r = allocateSlots({ today: D, slots, navHistory: compact, regime, correlationOf }, [rc]);
        if (r.accepted.length) {
          slots = r.slots;
          const c = bySym.get(rc.ticker)!;
          open.push({ c, shares: r.accepted[0].shares });
          out.taken.push({ c, shares: r.accepted[0].shares, bottleneck });
          continue;
        }
        const blockedBy = r.rejected[0]?.blockedBy ?? [];
        if (blockedBy.length === 0) out.zeroShareRejects++;
        for (const g of blockedBy) blocks[g]++;
        if (blockedBy.includes("DRAWDOWN")) break; // candidate-independent: blocks every later name too
      }
      if (slots.length < cap) out.unfilledDays++;
    }

    // Close of D: realise everything that exited today, then mark the rest to market.
    const still: typeof open = [];
    for (const p of open) {
      if (p.c.close <= D) realized += p.shares * p.c.pnlAdj;
      else still.push(p);
    }
    open = still;
    let mtm = 0;
    const u = U_IDX.get(D)!;
    for (const p of open) {
      const bi = DATA[p.c.sym].lastBarU[u];
      mtm += p.shares * (DATA[p.c.sym].bars[bi].c - p.c.entry);
    }
    const point: NavPoint = { date: D, nav: C + realized + mtm };
    prev = last;
    last = point;
    if (point.nav > peak.nav) peak = point;
    if (checkNav) full.push(point);
    out.maxDdPct = Math.max(out.maxDdPct, ((peak.nav - point.nav) / peak.nav) * 100);
  }
  assert(open.length === 0, `${open.length} positions still open at the end of ${book.fold.name}`);
  out.finalNav = last.nav;
  return out;
}

/** S: mean gap-adjusted rMultiple over all trades taken, null r excluded (§7). */
const S = (taken: Taken[], raw = false) => mean(taken.map((t) => (raw ? t.c.rRaw : t.c.rAdj)).filter((r): r is number => r != null));

// ---- main --------------------------------------------------------------------------
function prepare(fold: Fold) {
  // All symbols, SPY included: that is how scripts/mr-down3-open-fill.log was
  // produced, so the §3 reproduction must slice the same way. SPY's own trades
  // are dropped from the candidate set afterwards (§2: SPY is not traded).
  return withSignals(sliceFold(panel, fold), (_s, candles) => computeEntrySignals(candles, undefined, MECH.rule!(candles))).map((p) => ({
    ...p,
    signals: shift1(p.signals),
  }));
}

function main() {
  console.log("Test B — residual momentum as the mr-down3 slot queue");
  console.log("pre-registration: docs/quant/PRE_REGISTRATION_TEST_B.md (committed df0f51a, before this file)");
  console.log(`panel ${DEEP_PANEL_CACHE_PATH} fetched ${panel.fetchedAt}; ${SYMBOLS.length} traded names + SPY`);
  console.log(`ladder=flat  fill=next-bar open  seed=${PANEL_SEED}  control walks=${WALKS}  C=$${C_VERDICT.toLocaleString()}`);
  if (SMOKE) console.log("*** SMOKE RUN: walk count differs from the pre-registered 500. NOT A RESULT. ***");
  const other = SYMBOLS.filter((s) => SECTOR[s] === "Other");
  console.log(`sector "Other" (SECTOR gate fails closed): ${other.length}/${SYMBOLS.length}${other.length ? ` — ${other.join(" ")}` : ""}`);

  // §3 trade sets + reproduction check
  console.log(`\n${"=".repeat(78)}\n0. HARNESS CHECKS (abort on failure)\n${"=".repeat(78)}`);
  const verdictCands: Record<string, Cand[]> = {};
  const contextCands: Record<string, Cand[]> = {};
  for (const fold of DEEP_FOLD_LIST) {
    const prepared = prepare(fold);
    for (const [costs, target, sink] of [
      [COSTS_VERDICT, REPRO, verdictCands],
      [COSTS_CONTEXT, REPRO_CONTEXT, contextCands],
    ] as const) {
      const run = simulateFold(prepared, fold, { ...EXIT, costs, entryAt: "open" });
      const want = target[fold.name];
      const got = { trades: run.trades.length, avgR: f(run.summary.avgR, 3) };
      console.log(
        `  reproduce ${fold.name} @ ${costs.slippageBps}bps+${costs.commissionBps}bp: ${got.trades} trades avgR ${got.avgR}  (log: ${want.trades} / ${want.avgR})`,
      );
      assert(got.trades === want.trades && got.avgR === want.avgR, `${fold.name} trade set does not reproduce the open-fill log`);
      const spyTrades = run.trades.filter((t) => t.symbol === "SPY").length;
      if (costs === COSTS_VERDICT) console.log(`    ${spyTrades} SPY trades dropped from the candidate set (§2)`);
      sink[fold.name] = run.trades.filter((t) => t.symbol !== "SPY").map((t) => candidateOf(t, costs.slippageBps!));
    }
  }
  console.log("  trade sets reproduce: OK");

  // §5 correlation equivalence
  const crng = mulberry32(PANEL_SEED + 1);
  const all = Object.values(verdictCands).flat();
  let worst = 0;
  let nulls = 0;
  for (let i = 0; i < CORR_SAMPLES; i++) {
    const c = all[Math.floor(crng() * all.length)];
    let b = SYMBOLS[Math.floor(crng() * SYMBOLS.length)];
    if (b === c.sym) b = SYMBOLS[(SYMBOLS.indexOf(b) + 1) % SYMBOLS.length];
    const through = (s: string) => DATA[s].bars.filter((x) => day(x.t) <= c.sig);
    const ref = dateAlignedCorrelation(through(c.sym), through(b));
    const fast = correlationAt(c.sym, b, uIndexAtOrBefore(c.sig));
    assert((ref == null) === (fast == null), `correlation null mismatch ${c.sym}/${b} @ ${c.sig}: ${ref} vs ${fast}`);
    if (ref == null) nulls++;
    else worst = Math.max(worst, Math.abs(ref - fast!));
  }
  assert(worst <= 1e-9, `fast correlation differs from dateAlignedCorrelation by ${worst}`);
  console.log(`  correlation equivalence: ${CORR_SAMPLES} samples, max |diff| ${worst.toExponential(2)}, ${nulls} null in both: OK`);

  for (const fold of DEEP_FOLD_LIST) {
    const cs = verdictCands[fold.name];
    const gapped = cs.filter((c) => c.gapped);
    console.log(
      `  ${fold.name}: ${cs.length} candidates, ${cs.filter((c) => c.score == null).length} null score, ` +
        `${cs.filter((c) => c.worstLossR == null).length} unmeasured gap, ${gapped.length} stops gapped through ` +
        `(mean extra loss ${f(mean(gapped.map((c) => (c.rRaw ?? 0) - (c.rAdj ?? 0))), 3)}R); ` +
        `unranked avgR raw ${f(mean(cs.map((c) => c.rRaw).filter((r): r is number => r != null)), 4)} adj ${f(mean(cs.map((c) => c.rAdj).filter((r): r is number => r != null)), 4)}`,
    );
  }

  // §5-§6 walks
  const books = DEEP_FOLD_LIST.map((fold) => buildBook(fold, verdictCands[fold.name]));
  const treatScores = (book: FoldBook) => new Map(book.ordered.map((c) => [c, c.score ?? NULL_SCORE]));

  const t0 = Date.now();
  const treat = books.map((b) => walk(b, treatScores(b), C_VERDICT, true));
  console.log(`  compact-NAV equivalence: checked on every candidate day of the treatment walk: OK`);

  const rng = mulberry32(PANEL_SEED); // §6: one stream, walk -> fold -> fill date -> ticker
  const ctrl: WalkResult[][] = [];
  for (let w = 0; w < WALKS; w++) {
    ctrl.push(books.map((b) => walk(b, new Map(b.ordered.map((c) => [c, rng()])), C_VERDICT, false)));
    if ((w + 1) % 50 === 0) console.error(`  control walk ${w + 1}/${WALKS}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (SMOKE) {
    // A smoke run checks the harness and times the walks. It prints no S, no
    // control distribution and no verdict, so the one real run stays unread.
    const secs = (Date.now() - t0) / 1000;
    console.log(`  smoke: treatment + ${WALKS} control walks in ${secs.toFixed(0)}s (~${(secs / (WALKS + 1)).toFixed(1)}s per walk)`);
    console.log("  SMOKE RUN: harness checks passed; results withheld by design.");
    return;
  }

  // ---- results ----------------------------------------------------------------------
  const pooled = (rs: WalkResult[], raw = false) => S(rs.flatMap((r) => r.taken), raw);
  const sTreat = pooled(treat);
  const sCtrl = ctrl.map((rs) => pooled(rs)).sort((a, b) => a - b);
  const p95 = percentile(sCtrl, CONTROL_P);

  console.log(`\n${"=".repeat(78)}\n1. CONTEXT (printed, never part of the verdict)\n${"=".repeat(78)}`);
  console.log("  per fold, C=$100k, 5bps+1bp, gap-adjusted:");
  console.log("    fold    taken   S_treat   ctrl med  ctrl p95   S_raw    bottleneck days  S on bottleneck days  maxDD%   final NAV");
  for (const [i, fold] of DEEP_FOLD_LIST.entries()) {
    const tr = treat[i];
    const cs = ctrl.map((rs) => S(rs[i].taken)).sort((a, b) => a - b);
    console.log(
      `    ${fold.name.padEnd(6)} ${String(tr.taken.length).padStart(6)}   ${f(S(tr.taken)).padStart(7)}   ${f(percentile(cs, 0.5)).padStart(7)}   ` +
        `${f(percentile(cs, CONTROL_P)).padStart(7)}   ${f(S(tr.taken, true)).padStart(7)}   ${String(tr.bottleneckDays).padStart(5)}/${String(tr.candidateDays).padEnd(5)}      ` +
        `${f(S(tr.taken.filter((t) => t.bottleneck))).padStart(8)}          ${tr.maxDdPct.toFixed(1).padStart(5)}   ${tr.finalNav.toFixed(0).padStart(9)}`,
    );
  }
  const tally = (rs: WalkResult[]) => GATE_ORDER.map((g) => `${g} ${rs.reduce((a, r) => a + r.blocks[g], 0)}`).join("  ");
  console.log(`  treatment gate blocks (candidates evaluated before the cap filled): ${tally(treat)}`);
  console.log(
    `  treatment: zero-share rejects ${treat.reduce((a, r) => a + r.zeroShareRejects, 0)}, unfilled-slot days ${treat.reduce((a, r) => a + r.unfilledDays, 0)}, ` +
      `safe-mode days ${treat.reduce((a, r) => a + r.safeModeDays, 0)}, stale-NAV days ${treat.reduce((a, r) => a + r.staleNavDays, 0)}`,
  );
  console.log(`  control mean safe-mode days per walk: ${f(mean(ctrl.map((rs) => rs.reduce((a, r) => a + r.safeModeDays, 0))), 1)}`);
  console.log(`  pooled S unadjusted (engine-booked stops): treatment ${f(pooled(treat, true))}  control median ${f(percentile(ctrl.map((rs) => pooled(rs, true)).sort((a, b) => a - b), 0.5))}`);

  const low = DEEP_FOLD_LIST.map((fold) => walk(buildBook(fold, contextCands[fold.name]), treatScores(buildBook(fold, contextCands[fold.name])), C_VERDICT, false));
  console.log(`  treatment S at 0.5bps+1bp: ${f(pooled(low))}  (${low.reduce((a, r) => a + r.taken.length, 0)} trades)`);
  const small = books.map((b) => walk(b, treatScores(b), C_SMALL, false));
  const smallNav = small.map((r) => r.finalNav.toFixed(0)).join(" / ");
  console.log(
    `  $2,500 restatement (treatment): S ${f(pooled(small))}  ${small.reduce((a, r) => a + r.taken.length, 0)} trades, ` +
      `${small.reduce((a, r) => a + r.zeroShareRejects, 0)} zero-share rejects, final NAV per fold ${smallNav}`,
  );
  console.log(`  control walks took ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // ---- §7 verdict ---------------------------------------------------------------------
  const selection = sTreat > p95;
  const usable = sTreat > 0;
  const verdict = selection && usable ? "PASS" : selection ? "NOT USABLE IN PRACTICE" : "FAIL";
  console.log(`\n${"=".repeat(78)}\nVERDICT — the §7 conjunct, scored against the pre-registration\n${"=".repeat(78)}`);
  console.log(`  S_treatment (pooled deep1-3, gap-adjusted, 5bps+1bp): ${f(sTreat)}  over ${treat.reduce((a, r) => a + r.taken.length, 0)} trades`);
  console.log(`  control (${WALKS} random-queue walks): median ${f(percentile(sCtrl, 0.5))}  p95 ${f(p95)}  max ${f(sCtrl[sCtrl.length - 1])}`);
  console.log(`  (1) SELECTION  S_treatment > p95(S_random): ${f(sTreat)} > ${f(p95)}  -> ${selection ? "YES" : "NO"}`);
  console.log(`  (2) USABLE     S_treatment > 0:             ${f(sTreat)} > 0  -> ${usable ? "YES" : "NO"}`);
  console.log(`\n  TEST B: ${verdict}${SMOKE ? "   (SMOKE RUN — NOT A RESULT)" : ""}`);
  if (verdict !== "PASS") console.log("  Final for this test (§7): no rescue search on these folds.");
  else console.log("  A PASS is a hypothesis, not a deployment (§7): it earns a forward paper record, not a live allocation.");
}

main();
