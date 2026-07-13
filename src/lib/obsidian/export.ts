// Exports research strategies as markdown notes into the project's Obsidian vault
// (obsidian-vault/), matching the schema/style of the vault's existing hand-written
// notes (type/key/tags frontmatter, prose body) rather than inventing a new one.
// Write-only: NEXMIND itself never reads the vault back (a possible future step).
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ResearchRun, ResearchStrategy } from "@/generated/prisma/client";

export const VAULT_DIR = join(process.cwd(), "obsidian-vault");
const STRATEGIES_DIR = join(VAULT_DIR, "Strategies");

// snapshot field -> short tag, detected by scanning the candidate's source for
// direct field access (e.g. `s.macdHist`, `snaps[i].rsi`).
const INDICATOR_TAGS: Record<string, string> = {
  sma20: "sma",
  sma50: "sma",
  rsi: "rsi",
  adx: "adx",
  plusDI: "di",
  minusDI: "di",
  macdHist: "macd",
  atr: "atr",
};

// candle-pattern keyword -> short tag, detected from the strategy label (patterns
// are structural checks in the code, not named snapshot fields, so label text is
// the more reliable signal).
const PATTERN_TAGS: Record<string, string> = {
  engulfing: "engulfing",
  hammer: "hammer",
  "shooting star": "shooting-star",
  doji: "doji",
  donchian: "donchian",
  bollinger: "bollinger",
  "liquidity sweep": "liquidity-sweep",
  "zero-cross": "zero-cross",
  "zero cross": "zero-cross",
};

// Readable asset name for the tags list, matching the vault's existing style
// (e.g. DI-Dominance Widening.md tags gold rather than the raw "GC=F" ticker).
// Unrecognized symbols are simply omitted from tags rather than guessed at.
const SYMBOL_TAGS: Record<string, string> = {
  "GC=F": "gold",
};

function detectTags(code: string, label: string, symbol: string): string[] {
  const tags = new Set<string>(["strategy", "research"]);
  for (const [field, tag] of Object.entries(INDICATOR_TAGS)) {
    if (code.includes(`.${field}`)) tags.add(tag);
  }
  const lower = label.toLowerCase();
  for (const [kw, tag] of Object.entries(PATTERN_TAGS)) {
    if (lower.includes(kw)) tags.add(tag);
  }
  const symbolTag = SYMBOL_TAGS[symbol];
  if (symbolTag) tags.add(symbolTag);
  return [...tags];
}

// Filenames can't contain: \ / : * ? " < > |
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function yamlString(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

interface BacktestSummary {
  trades?: number;
  winRate?: number;
  profitFactor?: number;
  totalPnl?: number;
  sharpeRatio?: number;
  expectancy?: number;
}

const STATUS_NOTE: Record<string, (id: number) => string> = {
  proposed: () => `Proposed candidate, not yet reviewed.`,
  rejected: () => `Rejected after review - not live.`,
  approved: (id) => `Approved - available as \`research-${id}\` if assigned to a portfolio's strategy key.`,
};

export function exportStrategyNote(strategy: ResearchStrategy, run: ResearchRun): void {
  ensureDir(STRATEGIES_DIR);

  const tags = detectTags(strategy.code, strategy.label, run.symbol);
  const summary: BacktestSummary = JSON.parse(strategy.backtestSummary || "{}");

  const frontmatter = [
    "---",
    "type: strategy",
    `key: research-${strategy.id}`,
    `status: ${strategy.status}`,
    `symbol: ${yamlString(run.symbol)}`,
    `timeframe: ${yamlString(run.interval)}`,
    `tags: [${tags.join(", ")}]`,
    "---",
  ].join("\n");

  const statusNote = (STATUS_NOTE[strategy.status] ?? (() => `Status: ${strategy.status}.`))(strategy.id);

  const body = [
    `# ${strategy.label}`,
    "",
    run.brief,
    "",
    "## Logic",
    "",
    "```js",
    strategy.code.trim(),
    "```",
    "",
    "## Backtest history",
    "",
    `- Research pipeline backtest (${run.range}, ${run.interval}): ${summary.trades ?? "n/a"} trades, ` +
      `${summary.winRate != null ? summary.winRate.toFixed(1) + "%" : "n/a"} win rate, ` +
      `profit factor ${summary.profitFactor != null ? summary.profitFactor.toFixed(2) : "n/a"}, ` +
      `total P/L ${summary.totalPnl != null ? "$" + summary.totalPnl.toFixed(2) : "n/a"}, ` +
      `Sharpe ${summary.sharpeRatio != null ? summary.sharpeRatio.toFixed(2) : "n/a"}.`,
    "",
    "## Live status",
    "",
    `${statusNote} From research run #${run.id}.`,
    "",
  ].join("\n");

  const path = join(STRATEGIES_DIR, `${sanitizeFilename(strategy.label)} (${strategy.id}).md`);
  writeFileSync(path, `${frontmatter}\n\n${body}`, "utf8");
}
