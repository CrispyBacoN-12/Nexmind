// One-off: register a strategy that was designed and iterated on directly in
// TradingView/Pine Script (never went through runResearch()'s JS-sandbox
// pipeline) so it doesn't fall outside NEXMIND's DB/vault tracking the way the
// 4 gold-trend .pine files earlier this session did. Mirrors
// reject-after-deep-validation.mts's DB-write pattern, but creates a new
// ResearchRun + ResearchStrategy instead of updating an existing one, and
// writes its own vault note (exportStrategyNote() assumes JS-sandbox code in
// a ```js fence, which would mislabel Pine source).
// Usage: node --env-file=.env --import tsx scripts/add-tradingview-candidate.mts

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/db";

const PINE_PATH = join(process.cwd(), "..", "Liquidity-Sweep-VolumeProfile-Strategy.pine");
const VAULT_DIR = join(process.cwd(), "obsidian-vault");
const STRATEGIES_DIR = join(VAULT_DIR, "Strategies");

const LABEL = "Liquidity Sweep + Volume Profile + SMA50 (Long Only, ATR Trail)";
const SYMBOL = "GC=F";
const BRIEF =
  "Manually designed in conversation from a 'what if we combined these indicators' " +
  "brainstorm (volume spike + rolling volume profile Value Area + SMA50 trend filter " +
  "on top of the liquidity-sweep entry from research-59..64/71/72, all of which failed " +
  "standalone). Iterated entirely against TradingView's own real GC=F feed via its " +
  "Strategy Tester (not the local JS-sandbox backtest pipeline, since GC=F volume from " +
  "free feeds like Yahoo/Alpaca is patchy) -- this run's `code` is the Pine v5 source, " +
  "not the JS sandbox DSL used by runResearch(); auto-review/compile jobs that scan by " +
  "status never call compileStrategy() on stored code, so this doesn't break anything, " +
  "but flagging it here for future readers.";

const iterations = [
  { note: "Long & Short, all filters on, Fixed TP (SL 1.5x / TP 1.2x ATR).", backtestSummary: { totalPnl: -1500, profitFactor: null } },
  { note: "Switched Exit Mode to ATR Trailing Stop (activate 1.0x / offset 1.0x ATR).", backtestSummary: { trades: 51, totalPnl: -737.16, profitFactor: 0.752 } },
  { note: "Cut to Long Only -- shorts were fighting the period's gold uptrend.", backtestSummary: { trades: 36, totalPnl: -224.68, profitFactor: 0.877 } },
  { note: "Widened SL to 2.0x ATR + Trail Offset to 1.75x ATR (more room for winners now that entries are heavily filtered).", backtestSummary: { trades: 34, totalPnl: 1325.05, profitFactor: 1.652, maxDrawdownPct: 8.31 } },
  { note: "Sensitivity check: SL 1.8-2.2x / Trail 1.5-2.0x ATR neighborhood all held PF>1 -- a robust region, not one lucky point.", backtestSummary: null },
  { note: "Baked SL=2.0/Trail=1.75/Long Only/ATR Trailing Stop in as the .pine file's new defaults; reloaded fresh on a wider date range (2025-01-02 to 2026-08-01) to confirm -- this is the final logged result.", backtestSummary: { trades: 34, winRate: 41.18, totalPnl: 1312.38, profitFactor: 1.645, maxDrawdownPct: 7.67 } },
];

const FINAL_SUMMARY = {
  trades: 34,
  wins: 14,
  losses: 20,
  winRate: 41.18,
  totalPnl: 1312.38,
  avgR: null,
  expectancy: 1312.38 / 34,
  profitFactor: 1.645,
  maxDrawdownPct: 7.67,
  sharpeRatio: null,
  sortinoRatio: null,
  totalCostsUsd: 0,
};

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function main() {
  const pineCode = readFileSync(PINE_PATH, "utf8");

  const run = await prisma.researchRun.create({
    data: {
      brief: BRIEF,
      symbol: SYMBOL,
      interval: "1h",
      range: "2025-01-02_2026-08-01 (TradingView Strategy Tester, real feed)",
      status: "done",
      costUsd: 0,
      finishedAt: new Date(),
    },
  });

  const strategy = await prisma.researchStrategy.create({
    data: {
      runId: run.id,
      label: LABEL,
      code: pineCode,
      status: "proposed",
      iterations: JSON.stringify(iterations),
      backtestSummary: JSON.stringify(FINAL_SUMMARY),
      safetyFlag: false,
    },
  });

  ensureDir(STRATEGIES_DIR);
  const frontmatter = [
    "---",
    "type: strategy",
    `key: research-${strategy.id}`,
    "status: proposed",
    `symbol: "${SYMBOL}"`,
    "timeframe: \"1h\"",
    "tags: [strategy, research, liquidity-sweep, volume-profile, sma, gold, tradingview]",
    "---",
  ].join("\n");

  const body = [
    `# ${LABEL}`,
    "",
    BRIEF,
    "",
    "## Logic",
    "",
    "```pinescript",
    pineCode.trim(),
    "```",
    "",
    "## TradingView backtest history (real feed, Strategy Tester)",
    "",
    ...iterations.map((it, i) => {
      const b = it.backtestSummary as Record<string, number | null> | null;
      const parts = b
        ? [
            b.trades != null ? `${b.trades} trades` : null,
            b.winRate != null ? `${b.winRate.toFixed(2)}% win rate` : null,
            b.profitFactor != null ? `PF ${b.profitFactor.toFixed(3)}` : "PF n/a",
            b.totalPnl != null ? `PnL $${b.totalPnl.toFixed(2)}` : null,
            b.maxDrawdownPct != null ? `max DD ${b.maxDrawdownPct.toFixed(2)}%` : null,
          ].filter(Boolean).join(", ")
        : null;
      return `${i + 1}. ${it.note}${parts ? ` -> ${parts}` : ""}`;
    }),
    "",
    `**Final/current defaults' result:** ${FINAL_SUMMARY.trades} trades, ${FINAL_SUMMARY.winRate.toFixed(2)}% win rate, ` +
      `profit factor ${FINAL_SUMMARY.profitFactor.toFixed(3)}, total P/L $${FINAL_SUMMARY.totalPnl.toFixed(2)}, ` +
      `max drawdown ${FINAL_SUMMARY.maxDrawdownPct.toFixed(2)}%.`,
    "",
    "## Live status",
    "",
    `Proposed candidate, not yet reviewed for live capital -- sample is still thin (34 trades). ` +
      `Sensitivity-checked (SL 1.8-2.2x / Trail 1.5-2.0x ATR neighborhood all PF>1) so the region looks ` +
      `genuine rather than a single overfit point, but the recommended next step is forward/paper-trading ` +
      `a few more weeks before committing real capital. From research run #${run.id}.`,
    "",
  ].join("\n");

  const path = join(STRATEGIES_DIR, `${LABEL} (${strategy.id}).md`);
  writeFileSync(path, `${frontmatter}\n\n${body}`, "utf8");

  console.log(`research-${strategy.id} created (run #${run.id}), status=proposed, vault note written to:\n${path}`);
}

main().then(() => process.exit(0));
