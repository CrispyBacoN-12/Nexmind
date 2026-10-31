// TradingView screener client for the scan. One POST returns price, gap,
// pre-market, relative volume, ATR and earnings dates for a whole symbol list,
// which is what makes a 500-name scan one request instead of 500 quote calls.
//
// Two traps live here. TradingView writes class shares with a DOT (BRK.B) and
// this repo uses a DASH (BRK-B); the conversion happens at the boundary, both
// ways. And every value arrives positionally in `d`, so a field that is null,
// a string or NaN must become null here, or it reaches a filter or sort later
// as a number that compares false against everything.

import type { TvRow } from "./types";

const ENDPOINT = "https://scanner.tradingview.com/america/scan";

/** Column order is the contract: parseTvResponse reads `d` by these indexes. */
export const TV_COLUMNS: readonly string[] = [
  "name",
  "exchange",
  "type",
  "close",
  "change",
  "gap",
  "premarket_change",
  "premarket_volume",
  "relative_volume_intraday|5",
  "relative_volume_10d_calc",
  "average_volume_10d_calc",
  "ATR",
  "earnings_release_date",
  "earnings_release_time",
  "earnings_release_next_date",
  "earnings_release_next_time",
];

const toTv = (ticker: string) => ticker.replace(/-/g, ".");
const fromTv = (name: string) => name.replace(/\./g, "-");

/** Pure: the POST body for a symbol list. Exported for tests. */
export function buildTvRequest(symbols: string[]): Record<string, unknown> {
  return {
    markets: ["america"],
    filter: [
      { left: "name", operation: "in_range", right: symbols.map(toTv) },
      { left: "type", operation: "equal", right: "stock" },
    ],
    columns: [...TV_COLUMNS],
    // Headroom: a name can list on more than one exchange.
    range: [0, symbols.length + 50],
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One row, or null when the symbol has no usable close (halted, never traded): unpriceable, not a schema break. */
function parseRow(raw: unknown, at: number): TvRow | null {
  const row = raw as { s?: unknown; d?: unknown } | null;
  if (!row || typeof row.s !== "string" || !Array.isArray(row.d)) {
    throw new Error(`TradingView row ${at} has no s/d`);
  }
  if (row.d.length !== TV_COLUMNS.length) {
    throw new Error(`TradingView row ${row.s} has ${row.d.length} values, expected ${TV_COLUMNS.length}`);
  }
  const d = row.d as unknown[];
  const col = (name: string) => d[TV_COLUMNS.indexOf(name)];
  // `s` is "EXCHANGE:SYMBOL"; the symbol half is authoritative for the ticker.
  const sep = row.s.indexOf(":");
  const exchange = sep >= 0 ? row.s.slice(0, sep) : String(col("exchange") ?? "");
  const symbol = sep >= 0 ? row.s.slice(sep + 1) : row.s;
  const close = num(col("close"));
  if (close === null) return null;
  return {
    ticker: fromTv(symbol),
    exchange,
    type: typeof col("type") === "string" ? (col("type") as string) : "",
    close,
    changePct: num(col("change")),
    gapPct: num(col("gap")),
    premarketChangePct: num(col("premarket_change")),
    premarketVolume: num(col("premarket_volume")),
    rvolIntraday: num(col("relative_volume_intraday|5")),
    rvol10d: num(col("relative_volume_10d_calc")),
    avgVolume10d: num(col("average_volume_10d_calc")),
    atr: num(col("ATR")),
    earningsLastAt: num(col("earnings_release_date")),
    earningsLastTime: num(col("earnings_release_time")),
    earningsNextAt: num(col("earnings_release_next_date")),
    earningsNextTime: num(col("earnings_release_next_time")),
  };
}

/** Pure: a response body to rows. Throws on a body with no `data` array. Exported for tests. */
export function parseTvResponse(json: unknown): TvRow[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("TradingView response has no data array");
  return data.map((r, i) => parseRow(r, i)).filter((r): r is TvRow => r !== null);
}

export async function fetchTradingViewRows(symbols: string[]): Promise<TvRow[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(buildTvRequest(symbols)),
  });
  if (!res.ok) throw new Error(`TradingView HTTP ${res.status}`);
  return parseTvResponse(await res.json());
}
