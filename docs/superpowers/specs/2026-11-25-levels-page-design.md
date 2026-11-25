# Levels page — design (short)

Approved by the owner 2026-11-25 ("ok"). Follows `2026-11-25-levels-design.md`;
the zone math is unchanged.

## Intent

The owner uses support/resistance zones to help decide where to buy or take
profit. On /portfolio they sat under the holdings, computed for every holding at
once, on a static close-only chart. The owner wants:

1. its own page, with its own sidebar entry;
2. only the ticker they searched for;
3. a chart that behaves like TradingView (candles, zoom, pan, crosshair).

## Decisions

- **Local only** (owner chose "ก"). `/levels` and its API return the
  local-only notice / 404 on Vercel or for a non-localhost request, the same
  guard as /portfolio. The sidebar shows the entry only when not on Vercel.
  Reason: a held ticker shows the owner's average cost as a line on the chart.
- **One ticker at a time.** A search box. The newest search replaces what is
  shown. There is no "compute every holding" button. /portfolio loses its
  levels section.
- **Chart library: `lightweight-charts`, pinned to 5.2.1** (Apache-2.0,
  TradingView's own; 5.3.0 is only 15 days old). The TradingView attribution
  logo stays on, as the licence asks.
- **API** moves to `/api/levels?ticker=X`. A ticker is required (400 without
  one). It returns the same `computeLevels` result plus the full 2-year daily
  OHLCV series, with MA50 and MA200 for each bar. It no longer returns the
  close-only, one-year series.

## The page

- Header strip: ticker, price (with an "intraday" badge when the bar is still
  forming), and the nearest support and nearest resistance with their % distance.
- Chart:
  - candles over 2 years, opening on the last ~6 months;
  - a volume histogram in a strip at the bottom;
  - MA50 and MA200 lines;
  - wheel to zoom, drag to pan;
  - a crosshair, plus a top-left legend showing O/H/L/C, volume and the date
    of the hovered bar (the last bar when not hovering);
  - range buttons 3M / 6M / 1Y / 2Y.
- Zones are shaded horizontal bands across the full width. They are green below
  the price, red above, and amber when the price sits inside. A stale zone is
  fainter.
- For a held ticker, a dashed purple price line labelled "ทุน" is drawn at the
  average cost.
- Below the chart, the existing zone list, with MA and 52-week values.
- The footer disclaimer is unchanged.

## Approaches considered

1. **lightweight-charts (chosen).** Candles, zoom, pan, crosshair and price
   lines come built in. Bands need a small custom series primitive.
2. **Keep recharts and add zoom.** It has no native candles, and pan and zoom
   would be hand-rolled and clunky.
3. **Embed the TradingView widget.** It uses TradingView's own data, so our
   zones cannot be drawn on it, which defeats the page.

## Non-goals

- No drawing tools, indicators menu or other timeframes. Daily only.
- No change to the zone math.
- No public version.
- Never any buy/sell wording.
