// Loads the gold desk's RL sizer (rl/gold-sizer.onnx, trained offline — see
// rl/train_gold_sizer.py) and converts its output weight into a lot, using
// the same riskUsd/slDistance math computeLot() uses. Shadow-mode only: this
// never controls a real trade in this phase (see engine.ts wiring).

import path from "node:path";

export interface RLState {
  proxyConfidence: number;
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;
  cashPct: number;
  drawdownPct: number;
}

export interface RLSizingResult {
  weight: number; // clamped 0..1
  lot: number; // 0 when vetoed or unavailable
  vetoed: boolean; // true if the model's weight rounded down to less than minLot
  available: boolean; // false if the ONNX model failed to load or infer — caller must fall back to computeLot()
}

export interface RLSizingContext {
  entry: number;
  sl: number;
  riskUsd: number;
  maxLotPerTrade: number;
  minLot: number;
}

/** Thin seam over the real onnxruntime-node session so tests can inject a mock. */
export interface RLSession {
  run(features: number[]): Promise<number>;
}

const MODEL_PATH = path.join(process.cwd(), "rl", "gold-sizer.onnx");

let cachedSession: RLSession | null | undefined;

async function loadDefaultSession(): Promise<RLSession | null> {
  if (cachedSession !== undefined) return cachedSession;
  try {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(MODEL_PATH);
    cachedSession = {
      async run(features: number[]): Promise<number> {
        const tensor = new ort.Tensor("float32", Float32Array.from(features), [1, features.length]);
        const results = await session.run({ state: tensor });
        return results.weight.data[0] as number;
      },
    };
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

// Raw (unscaled) feature values, in the exact order rl/train_gold_sizer.py's
// FEATURES list uses — normalization is baked into the ONNX graph itself, so
// nothing here scales anything (see the design doc's Component 3).
function toFeatureVector(state: RLState): number[] {
  return [
    state.proxyConfidence,
    state.atr ?? 0,
    state.adx ?? 0,
    state.bbWidth ?? 0,
    state.exposurePct,
    state.cashPct,
    state.drawdownPct,
  ];
}

export async function sizeWithRL(
  state: RLState,
  ctx: RLSizingContext,
  sessionOverride?: RLSession,
): Promise<RLSizingResult> {
  const session = sessionOverride ?? (await loadDefaultSession());
  if (!session) return { available: false, weight: 0, lot: 0, vetoed: false };

  let rawWeight: number;
  try {
    rawWeight = await session.run(toFeatureVector(state));
  } catch {
    return { available: false, weight: 0, lot: 0, vetoed: false };
  }

  const weight = Number.isFinite(rawWeight) ? Math.max(0, Math.min(1, rawWeight)) : 0;
  const slDistance = Math.abs(ctx.entry - ctx.sl);
  if (slDistance <= 0) return { available: true, weight, lot: 0, vetoed: true };

  const fullLot = ctx.riskUsd / slDistance;
  const rawLot = Math.min(fullLot * weight, ctx.maxLotPerTrade);
  const lot = Math.round(rawLot * 100) / 100;

  if (lot < ctx.minLot) return { available: true, weight, lot: 0, vetoed: true };
  return { available: true, weight, lot, vetoed: false };
}
