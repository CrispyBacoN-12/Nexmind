// Cloud capture (no AI): a stand-in for reviewSetups that returns no reviews and
// remembers exactly what the AI would have read, so the owner's PC can review it
// later. Every setup then logs as unread with aiBackend "pending".

import type { Candle } from "@/lib/indicators";
import type { ReviewItem, reviewSetups } from "@/lib/chartAgent/review";
import { PENDING_BACKEND } from "./types";

/** One setup's AI input and its index in the review call (the order the AI saw). */
export interface ReviewInput {
  order: number;
  item: ReviewItem;
}

export function makeRecorder(): { review: typeof reviewSetups; inputs(): Map<string, ReviewInput> } {
  const kept = new Map<string, ReviewInput>();
  return {
    review: async (items) => {
      items.forEach((item, order) => kept.set(item.setup.ticker, { order, item }));
      return { reviews: new Map(), backend: PENDING_BACKEND, note: null, model: null };
    },
    inputs: () => kept,
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNumOrNull = (x: unknown): boolean => x === null || isNum(x);

function isCandle(x: unknown): x is Candle {
  return isObj(x) && isNum(x.t) && isNum(x.o) && isNum(x.h) && isNum(x.l) && isNum(x.c) && isNum(x.v);
}

function isTarget(x: unknown): boolean {
  return isObj(x) && isNum(x.price) && isNum(x.r) && Array.isArray(x.names) && x.names.every(isStr);
}

/** A structural check of what JSON storage gives back; null when anything is missing. */
export function parseReviewInput(json: unknown): ReviewInput | null {
  if (!isObj(json) || !isNum(json.order) || !isObj(json.item)) return null;
  const { setup, recent } = json.item;
  if (!isObj(setup) || !Array.isArray(recent) || !recent.every(isCandle)) return null;
  if (!isStr(setup.ticker) || !isNum(setup.entry) || !isNum(setup.stop) || !isStr(setup.dataAsOf)) return null;
  if (!isTarget(setup.t1) || !(setup.t2 === null || isTarget(setup.t2))) return null;
  if (!Array.isArray(setup.sweptLevels) || !setup.sweptLevels.every(isStr)) return null;
  if (!isCandle(setup.sweepBar)) return null;
  if (!isObj(setup.levels) || !Object.values(setup.levels).every(isNumOrNull)) return null;
  return json as unknown as ReviewInput;
}
