import { z } from "zod";

export const GoldCandleSchema = z.object({
  t: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});
export type GoldCandle = z.infer<typeof GoldCandleSchema>;

export const GoldCandlesResponseSchema = z.object({
  symbol: z.string(),
  candles: z.array(GoldCandleSchema),
  truncated: z.boolean(),
});
export type GoldCandlesResponse = z.infer<typeof GoldCandlesResponseSchema>;

export const GoldTickSchema = z.object({
  t: z.number(),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  volume: z.number(),
});
export type GoldTick = z.infer<typeof GoldTickSchema>;

export const GoldTicksResponseSchema = z.object({
  symbol: z.string(),
  ticks: z.array(GoldTickSchema),
  truncated: z.boolean(),
});
export type GoldTicksResponse = z.infer<typeof GoldTicksResponseSchema>;

export const GoldPositionSchema = z.object({
  ticket: z.number(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  volume: z.number(),
  priceOpen: z.number(),
  priceCurrent: z.number(),
  sl: z.number(),
  tp: z.number(),
  profit: z.number(),
  swap: z.number(),
  magic: z.number(),
  comment: z.string(),
  openedAt: z.number(),
});
export type GoldPosition = z.infer<typeof GoldPositionSchema>;

export const GoldPositionsResponseSchema = z.object({
  positions: z.array(GoldPositionSchema),
});
export type GoldPositionsResponse = z.infer<typeof GoldPositionsResponseSchema>;

// trade_mode is optional here even though bridge.py always sends it today —
// mt5.ts's own Mt5AccountInfo treats it as optional-with-fallback ("unknown"),
// and tests need to simulate that fail-closed path via the fake bridge.
export const GoldAccountResponseSchema = z.object({
  balance: z.number(),
  equity: z.number(),
  profit: z.number(),
  credit: z.number(),
  margin: z.number(),
  margin_free: z.number(),
  margin_level: z.number(),
  leverage: z.number(),
  currency: z.string(),
  trade_allowed: z.boolean(),
  server: z.string(),
  trade_mode: z.string().optional(),
});
export type GoldAccountResponse = z.infer<typeof GoldAccountResponseSchema>;

export const GoldOrderResultSchema = z.union([
  z.object({
    duplicate: z.literal(true),
    position: GoldPositionSchema,
    note: z.string(),
  }),
  z.object({
    duplicate: z.literal(false),
    retcode: z.number(),
    retcodeComment: z.string(),
    order: z.number(),
    deal: z.number(),
    volume: z.number(),
    price: z.number(),
    magic: z.number(),
  }),
]);
export type GoldOrderResult = z.infer<typeof GoldOrderResultSchema>;

export const GoldHealthResponseSchema = z.object({
  connected: z.boolean(),
});
export type GoldHealthResponse = z.infer<typeof GoldHealthResponseSchema>;

export function parseGoldCandlesResponse(data: unknown): GoldCandlesResponse {
  return GoldCandlesResponseSchema.parse(data);
}
export function parseGoldTicksResponse(data: unknown): GoldTicksResponse {
  return GoldTicksResponseSchema.parse(data);
}
export function parseGoldPositionsResponse(data: unknown): GoldPositionsResponse {
  return GoldPositionsResponseSchema.parse(data);
}
export function parseGoldAccountResponse(data: unknown): GoldAccountResponse {
  return GoldAccountResponseSchema.parse(data);
}
export function parseGoldOrderResult(data: unknown): GoldOrderResult {
  return GoldOrderResultSchema.parse(data);
}
export function parseGoldHealthResponse(data: unknown): GoldHealthResponse {
  return GoldHealthResponseSchema.parse(data);
}
