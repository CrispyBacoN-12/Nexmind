// RAVEN — the only AI role this project's own record supports.
//
// HAWK, a directional vote, produced 51 Counterfactual rows and 0 fills here.
// SAGE, a reviewer that may only object, produced six genuine structural
// arguments in one session. §5 of the advisory spec stands: live trading cannot
// measure an edge, so the AI's value must not depend on one — which a vote's
// value entirely does, and an objection's does not.
//
// This module is impure (it spawns a subprocess through anthropic.ts), which is
// why it sits here and not in src/lib/advisor/. It mirrors src/lib/trading/sage.ts.
//
// critiqueCard NEVER throws. The card above it is already complete and correct.

import {
  guardObjections,
  isDirectional,
  type CritiqueResult,
  type Objection,
  type Severity,
} from "@/lib/advisor/critiqueContext";
import { aiBackend, aiOutageReason, callAgentJSON } from "@/lib/anthropic";

/** Spec §1.2: 0-4. Zero is a legitimate answer. */
const MAX_OBJECTIONS = 4;

const SEVERITIES: readonly Severity[] = ["note", "concern", "serious"];

const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    objections: {
      type: "array",
      maxItems: MAX_OBJECTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          severity: { type: "string", enum: [...SEVERITIES] },
        },
        required: ["claim", "evidence", "severity"],
      },
    },
    blindSpots: { type: "array", items: { type: "string" } },
  },
  required: ["objections", "blindSpots"],
};

const SYSTEM =
  "You are RAVEN, an independent critic on a trading desk. You are shown a " +
  "structure-and-risk card for a stock the owner has ALREADY chosen. Your only job " +
  "is to name what is wrong with the structure, and what the card cannot see. " +
  "You NEVER say whether to take the trade, never say buy, sell, enter, avoid, " +
  "skip or wait, never score it and never rank it, because neither you nor this " +
  "desk has any measured edge — a recommendation from you would be a claim this " +
  "desk cannot support. Argue only against the numbers in front of you, and quote " +
  "the specific number that supports each objection. Return at most " +
  `${MAX_OBJECTIONS} objections. Returning ZERO objections is a valid and useful ` +
  "answer; do not invent one to fill space. Also list what the card is blind to " +
  "(earnings dates, news, sector-wide moves) as short phrases. " +
  'Return JSON {"objections":[{"claim","evidence","severity":"note"|"concern"|"serious"}],"blindSpots":[string]}.';

/** The unvalidated shape the model may or may not have returned. */
export interface RawCritique {
  objections?: unknown;
  blindSpots?: unknown;
}

export async function critiqueCard(facts: string): Promise<CritiqueResult> {
  if (aiBackend() === "mock") {
    return degraded(aiOutageReason() ?? "no AI backend is configured");
  }
  try {
    const r = await callAgentJSON<RawCritique>({
      tier: "sonnet", // judgment work; a cheaper tier produces the generic
      // objections that made HAWK's votes worthless.
      system: SYSTEM,
      prompt: facts,
      maxTokens: 1200,
      jsonSchema: CRITIQUE_SCHEMA,
    });
    return normalizeCritique(r.data, { model: r.model, costUsd: r.costUsd });
  } catch (err) {
    // AiUnavailableError, a CLI timeout, malformed JSON and a shape mismatch
    // all land here and all mean the same thing to the owner: no critique this
    // time, and here is why.
    const reason =
      err instanceof Error ? err.message : String(err);
    // The guard (guardObjections / isDirectional) is the one thing this module
    // must never let slip past — and parseJsonLoose's own error message is a
    // slice of the model's raw, un-guarded prose ("Agent did not return valid
    // JSON: <first 200 chars>"). That is exactly the failure mode where the
    // model broke its contract and said something directional in plain text,
    // and forwarding it verbatim to the card would bypass the guard entirely.
    // So this one failure reason is replaced with a fixed note; every other
    // backend failure (spend limit, timeout, ...) is still forwarded because
    // the owner genuinely benefits from seeing it.
    if (reason.startsWith("Agent did not return valid JSON") || isDirectional(reason)) {
      console.error("RAVEN: withholding raw model text from the card:", reason);
      return degraded(
        "อ่านคำตอบของโมเดลไม่ได้ — ข้อความดิบถูกตัดออกเพื่อไม่ให้คำชี้นำหลุดขึ้นการ์ด",
      );
    }
    return degraded(reason);
  }
}

/**
 * Turn whatever came back into a CritiqueResult, then run the guard.
 *
 * The guard runs HERE and not only in the UI: every caller of critiqueCard gets
 * the muzzled result, so a future caller cannot forget to apply it.
 *
 * Exported for the tests, which must not spawn a subprocess.
 */
export function normalizeCritique(
  raw: RawCritique,
  meta: { model: string; costUsd: number },
): CritiqueResult {
  const { kept, stripped: strippedObjections } = guardObjections(readObjections(raw.objections));
  // blindSpots is free model text too, and readStrings only type-filters — it
  // never runs the guard. Left unguarded, a directional blind spot ("worth
  // waiting for the earnings reaction") would reach the card exactly as
  // untouched as an unguarded objection would. Same guard, same visibility:
  // a dropped blind spot joins the SAME stripped list the objections use,
  // objections' entries first, so the removal is never silent.
  const blindSpots: string[] = [];
  const strippedBlindSpots: string[] = [];
  for (const b of readStrings(raw.blindSpots)) {
    if (isDirectional(b)) strippedBlindSpots.push(b);
    else blindSpots.push(b);
  }
  return {
    objections: kept.slice(0, MAX_OBJECTIONS),
    blindSpots,
    degraded: false,
    note: "",
    stripped: [...strippedObjections, ...strippedBlindSpots],
    model: meta.model,
    costUsd: meta.costUsd,
  };
}

function degraded(note: string): CritiqueResult {
  return {
    objections: [],
    blindSpots: [],
    degraded: true,
    note,
    stripped: [],
    model: "",
    costUsd: 0,
  };
}

function readObjections(value: unknown): Objection[] {
  if (!Array.isArray(value)) return [];
  const out: Objection[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const claim = typeof row.claim === "string" ? row.claim.trim() : "";
    if (claim === "") continue; // an objection with no claim is not an objection
    const severity = SEVERITIES.find((s) => s === row.severity) ?? "note";
    out.push({
      claim,
      evidence: typeof row.evidence === "string" ? row.evidence : "",
      severity,
    });
  }
  return out;
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}
