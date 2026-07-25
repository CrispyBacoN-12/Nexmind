// Offline dataset builder for the RL sizer's training data. Walks gold candle
// history, driving ONE continuously-simulated position via the same
// position-lifecycle state machine (OpenPosition/LadderState/decideAction/
// applySlippage) the live desk and backtester use, so exposurePct/cashPct/
// drawdownPct are genuine running values, not per-row artifacts.
// Usage: npx tsx scripts/rl/build-gold-dataset.ts > rl/data/gold-dataset.csv

// scanner.ts's strategy-registry path (getResearchStrategy) transitively
// imports src/lib/db.ts (Prisma), which throws at module-load time if
// DATABASE_URL isn't set — load .env the same way scripts/backfill-lessons.ts
// does so this standalone script works outside `next dev`'s env loading.
import "dotenv/config";
import { fetchCandles } from "../../src/lib/marketData";
import { sma, rsi, macd, atr, adx, bollinger, type Candle } from "../../src/lib/indicators";
import { decideSetup, DEFAULT_THRESHOLDS, type ScanSnapshot } from "../../src/lib/trading/scanner";
import { decideAction, applySlippage, type OpenPosition, type LadderState } from "../../src/lib/trading/positionRules";
import { proxyConfidence } from "../../src/lib/trading/rlProxyConfidence";
import { DEFAULT_COST_MODEL } from "../../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const WARMUP = 60;
const STARTING_BALANCE = 10000;
const RISK_USD = 100;
const ATR_SL_MULT = 1.5;
const ATR_TP_MULT = 2.5;
const TP2_FACTOR = 1.6;

interface StateRow {
  proxyConfidence: number;
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;
  cashPct: number;
  drawdownPct: number;
  side: "long" | "short";
  reward: number; // filled in with the realized R-multiple once the position this row opened closes
}

/**
 * Per-bar indicator snapshots, computed once over the whole series. Mirrors
 * backtest/engine.ts's snapshots() builder, plus bbWidth computed the same
 * way scanner.ts's scanSymbol() does: (upper-lower)/middle from the real
 * bollinger() indicator (not a reimplementation) so this script can never
 * drift from the live/backtest bbWidth definition.
 */
function snapshots(candles: Candle[]): ScanSnapshot[] {
  const closes = candles.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrArr = atr(candles, 14);
  const { adx: adxArr, plusDI, minusDI } = adx(candles, 14);
  const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = bollinger(closes, 20, 2);
  return candles.map((c, i) => {
    const bbU = bbUpper[i];
    const bbM = bbMiddle[i];
    const bbL = bbLower[i];
    const bbWidth = bbU != null && bbL != null && bbM ? (bbU - bbL) / bbM : null;
    return {
      price: c.c, sma20: s20[i], sma50: s50[i], rsi: r[i], adx: adxArr[i],
      plusDI: plusDI[i], minusDI: minusDI[i], macdHist: histogram[i], atr: atrArr[i],
      bbWidth,
    };
  });
}

/** NaN/undefined-safe CSV cell: only finite numbers or "long"/"short" pass through as-is. */
function cell(v: number | string | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return v;
}

/**
 * Yahoo's chart endpoint rejects (422) GC=F 1h requests beyond ~2y of history
 * outright (it doesn't silently truncate) — confirmed against the live
 * endpoint and consistent with scripts/blind-test-gold.ts's own "2y"/"5y"
 * fallback precedent for this exact symbol/interval pair. Try 5y first for
 * the longest history Yahoo will actually serve, fall back to 2y.
 */
async function fetchGoldHistory() {
  for (const range of ["5y", "2y"] as const) {
    try {
      const resp = await fetchCandles(SYMBOL, range, "1h");
      console.error(`fetched ${SYMBOL} 1h/${range}: ${resp.candles.length} bars`);
      return resp;
    } catch (e) {
      console.error(`fetch ${SYMBOL} 1h/${range} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`could not fetch ${SYMBOL} 1h candles at any range`);
}

async function main() {
  const resp = await fetchGoldHistory();
  const candles = resp.candles;
  const firstDate = new Date(candles[0].t * 1000).toISOString().slice(0, 10);
  const lastDate = new Date(candles[candles.length - 1].t * 1000).toISOString().slice(0, 10);
  console.error(`${candles.length} candles, ${firstDate} to ${lastDate}`);
  const snaps = snapshots(candles);

  let openPos: OpenPosition | null = null;
  let ladder: LadderState = {};
  let openLot = 0;
  let balance = STARTING_BALANCE;
  let peakBalance = STARTING_BALANCE;

  const rows: StateRow[] = [];
  let pendingRows: StateRow[] = []; // rows waiting for their position to close

  for (let i = WARMUP; i < candles.length; i++) {
    const bar = candles[i];
    const price = bar.c;

    if (openPos) {
      // Alias to a `const` with an explicit annotation: TS's control-flow
      // narrowing of the outer `let openPos` doesn't hold across the
      // self-referential `openPos = { ...openPos, ... }` reassignment below
      // (verified against tsc directly — without this alias it reports
      // TS2698/"Property does not exist on type 'never'" at the spread).
      const pos: OpenPosition = openPos;
      const action = decideAction(pos, ladder, price);
      if (action.kind === "partial-tp1") {
        const exit = applySlippage(pos.side === "long" ? "sell" : "buy", action.exit, DEFAULT_COST_MODEL.slippageBps ?? 0);
        const favorableMove = pos.side === "long" ? exit - pos.entry : pos.entry - exit;
        const partialPnl = favorableMove * (openLot / 2);
        balance += partialPnl;
        ladder = { tp1Hit: true, partialPnl, origSl: pos.sl };
        openPos = { ...pos, sl: pos.entry };
      } else if (action.kind === "close") {
        const exit = applySlippage(pos.side === "long" ? "sell" : "buy", action.exit, DEFAULT_COST_MODEL.slippageBps ?? 0);
        const remainingLot = ladder.tp1Hit ? openLot / 2 : openLot;
        const favorableMove = pos.side === "long" ? exit - pos.entry : pos.entry - exit;
        const pnl = (ladder.partialPnl ?? 0) + favorableMove * remainingLot;
        balance += pnl;
        const risk = Math.abs(pos.entry - (ladder.origSl ?? pos.sl));
        const rMultiple = risk > 0 ? pnl / (risk * openLot) : 0;
        for (const row of pendingRows) row.reward = rMultiple;
        pendingRows = [];
        openPos = null;
        ladder = {};
      }
    }

    let justOpenedSide: "long" | "short" | null = null;
    if (!openPos) {
      const { side } = decideSetup(snaps[i], DEFAULT_THRESHOLDS);
      if (side) {
        const a = snaps[i].atr ?? bar.c * 0.005;
        const dir = side === "long" ? 1 : -1;
        const entry = applySlippage(side === "long" ? "buy" : "sell", bar.c, DEFAULT_COST_MODEL.slippageBps ?? 0);
        const sl = entry - dir * ATR_SL_MULT * a;
        const tp1 = entry + dir * ATR_TP_MULT * a;
        const tp2 = entry + dir * ATR_TP_MULT * TP2_FACTOR * a;
        openPos = { side, entry, sl, tp1, tp2 };
        ladder = {};
        openLot = RISK_USD / Math.abs(entry - sl);
        justOpenedSide = side;
      }
    }

    // Computed AFTER the manage/entry steps above so a row logged this bar
    // reflects the state the sizer would actually observe at its decision
    // point: a freshly-opened trade's row shows that trade's real exposure
    // (RISK_USD/balance), not a "still flat, pre-decision" snapshot. This is
    // what makes exposurePct/cashPct genuine running values instead of a
    // constant 0/1 on every row — with RISK_USD fixed and balance drifting
    // trade to trade, both columns vary meaningfully across the dataset.
    peakBalance = Math.max(peakBalance, balance);
    const drawdownPct = peakBalance > 0 ? (peakBalance - balance) / peakBalance : 0;
    const exposurePct = openPos ? RISK_USD / balance : 0;
    const cashPct = 1 - exposurePct;

    if (justOpenedSide) {
      const row: StateRow = {
        proxyConfidence: proxyConfidence({
          adx: snaps[i].adx, rsi: snaps[i].rsi,
          plusDI: snaps[i].plusDI, minusDI: snaps[i].minusDI,
          side: justOpenedSide,
        }),
        atr: snaps[i].atr,
        adx: snaps[i].adx,
        bbWidth: snaps[i].bbWidth ?? null,
        exposurePct, cashPct, drawdownPct, side: justOpenedSide,
        reward: 0,
      };
      rows.push(row);
      pendingRows.push(row);
    }
  }

  console.log("proxyConfidence,atr,adx,bbWidth,exposurePct,cashPct,drawdownPct,side,reward");
  for (const r of rows) {
    console.log([cell(r.proxyConfidence), cell(r.atr), cell(r.adx), cell(r.bbWidth), cell(r.exposurePct), cell(r.cashPct), cell(r.drawdownPct), r.side, cell(r.reward)].join(","));
  }
  console.error(`\n${rows.length} training rows written; ${pendingRows.length} still open at end of history (reward left at 0)`);
}

main();
