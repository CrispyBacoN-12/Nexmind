// Draws support/resistance zones as full-width shaded bands behind the
// candles. Geometry comes from bandRects (src/lib/levels/chart.ts, tested);
// this file only turns those rectangles into canvas fills.

import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

import { bandRects } from "@/lib/levels/chart";
import type { Zone } from "@/lib/levels/levels";

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer["draw"]>[0];

class BandsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly source: ZoneBands) {}

  draw() {}

  drawBackground(target: CanvasRenderingTarget2D) {
    const series = this.source.series;
    if (!series) return;
    target.useBitmapCoordinateSpace(({ context, mediaSize, bitmapSize, verticalPixelRatio }) => {
      const rects = bandRects(this.source.zones, this.source.price, (p) => series.priceToCoordinate(p), mediaSize.height);
      for (const r of rects) {
        context.globalAlpha = r.opacity;
        context.fillStyle = r.color;
        const top = Math.round(r.top * verticalPixelRatio);
        const bottom = Math.round(r.bottom * verticalPixelRatio);
        context.fillRect(0, top, bitmapSize.width, Math.max(1, bottom - top));
      }
      context.globalAlpha = 1;
    });
  }
}

class BandsView implements IPrimitivePaneView {
  private readonly r: BandsRenderer;
  constructor(source: ZoneBands) {
    this.r = new BandsRenderer(source);
  }
  zOrder() {
    return "bottom" as const;
  }
  renderer() {
    return this.r;
  }
}

export class ZoneBands implements ISeriesPrimitive<Time> {
  series: ISeriesApi<SeriesType> | null = null;
  private readonly views: BandsView[];

  constructor(
    readonly zones: Zone[],
    readonly price: number,
  ) {
    this.views = [new BandsView(this)];
  }

  attached({ series }: SeriesAttachedParameter<Time>) {
    this.series = series;
  }

  detached() {
    this.series = null;
  }

  paneViews() {
    return this.views;
  }
}
