// OANDA v20 market-data provider (practice environment) — an independent
// cross-check for spot XAU_USD against Yahoo's GC=F futures feed, which
// showed a materially different low during the Aug 3 dip. Data-only: this
// never touches OANDA's order/account endpoints.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const OANDA_PRACTICE_BASE = "https://api-fxpractice.oanda.com";
const DAY_MS = 86_400_000;

/** Map our Interval to an OANDA granularity string. */
export function intervalToGranularity(interval: Interval): string {
  switch (interval) {
    case "5m": return "M5";
    case "15m": return "M15";
    case "30m": return "M30";
    case "60m": return "H1";
    case "1h": return "H1";
    case "1d": return "D";
    case "1wk": return "W";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`oanda: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Lookback window (ms) for a Range, used to compute the OANDA `from` time. */
function rangeToLookbackMs(range: Range): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305, // ~20y
  };
  return days[range] * DAY_MS;
}

interface OandaCandle {
  time: string;
  volume: number;
  complete: boolean;
  mid?: { o: string; h: string; l: string; c: string };
}

/**
 * Fetch candles from OANDA's v20 practice API for a native OANDA instrument
 * (underscore format, e.g. "XAU_USD" — not a Yahoo ticker). Throws when no
 * key is set, on a non-OK response, or when the body has no candles.
 *
 * OANDA caps a single request at 5000 candles — a long range + fine
 * granularity combo will 400 rather than paginate; fine for the ad-hoc
 * cross-checks this is built for, but not a general backfill tool.
 */
export async function fetchOandaCandles(
  instrument: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const key = process.env.OANDA_API_KEY;
  if (!key) throw new Error("oanda: missing OANDA_API_KEY");

  const from = new Date(Date.now() - rangeToLookbackMs(range)).toISOString();
  const to = new Date().toISOString();
  const params = new URLSearchParams({
    price: "M", // midpoint candles — matches the single o/h/l/c shape the rest of the app expects
    granularity: intervalToGranularity(interval),
    from,
    to,
  });

  const res = await fetch(
    `${OANDA_PRACTICE_BASE}/v3/instruments/${encodeURIComponent(instrument)}/candles?${params}`,
    {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      next: { revalidate: 30 },
    },
  );
  if (!res.ok) throw new Error(`oanda upstream ${res.status}`);

  const json = (await res.json()) as { candles?: OandaCandle[] };
  const raw = json.candles ?? [];
  if (raw.length === 0) throw new Error("oanda: no candles for instrument");

  const candles: Candle[] = raw
    .filter((c): c is OandaCandle & { mid: NonNullable<OandaCandle["mid"]> } => Boolean(c.mid))
    .map((c) => ({
      t: Math.floor(Date.parse(c.time) / 1000),
      o: Number(c.mid.o),
      h: Number(c.mid.h),
      l: Number(c.mid.l),
      c: Number(c.mid.c),
      v: c.volume ?? 0,
    }));

  return {
    symbol: instrument,
    range,
    interval,
    price: candles.at(-1)?.c,
    candles,
  };
}
