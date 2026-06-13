// MEMO — the memory keeper. After a losing paper trade, distills a short,
// actionable lesson that future HAWK/SAGE prompts will see via
// engine.ts's latestLessons().

import { callAgentJSON, aiEnabled } from "@/lib/anthropic";
import type { Trade } from "@/generated/prisma/client";

export interface LessonInput {
  outcome: "loss";
  exit: number | null; // null = unknown (e.g. backfill couldn't recover it)
  pnl: number | null;
  rMultiple: number | null;
}

export interface LessonResult {
  text: string;
  costUsd: number;
}

const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lesson: { type: "string" },
  },
  required: ["lesson"],
};

const SYSTEM =
  "You are MEMO, the memory keeper for a trading desk. After a losing paper trade, " +
  "distill ONE actionable, specific sentence a future analyst should keep in mind. " +
  "Respond with strict JSON matching the schema only — no conversational filler, no " +
  "introductory text (e.g. 'Here is the lesson:'), no markdown code fences. The `lesson` " +
  "field must be a single, concise, actionable sentence (max ~200 chars) grounded in the " +
  "numbers given — do not invent prices or outcomes not present in the input.";

/** Distill a lesson from a losing trade. Falls back to a deterministic mock when no AI backend is available. */
export async function generateLesson(trade: Trade, close: LessonInput): Promise<LessonResult> {
  if (!aiEnabled()) return mockLesson(trade, close);

  const r = await callAgentJSON<{ lesson: string }>({
    tier: "haiku",
    system: SYSTEM,
    prompt: buildPrompt(trade, close),
    maxTokens: 200,
    jsonSchema: LESSON_SCHEMA,
  });

  return { text: r.data.lesson, costUsd: r.costUsd };
}

function buildPrompt(trade: Trade, close: LessonInput): string {
  const votes = summarizeHawkVotes(trade.hawkVotes);
  const log = summarizeDecisionLog(trade.decisionLog);
  return [
    `${trade.side.toUpperCase()} ${trade.symbol}: entry ${trade.entry.toFixed(4)}, SL ${trade.sl.toFixed(4)}, ` +
      `TP1 ${trade.tp1.toFixed(4)}${trade.tp2 != null ? `, TP2 ${trade.tp2.toFixed(4)}` : ""}.`,
    `Outcome: loss. Exit price: ${close.exit != null ? close.exit.toFixed(4) : "unknown"}.`,
    `P/L: ${close.pnl != null ? close.pnl.toFixed(2) : "unknown"}. R multiple: ${close.rMultiple != null ? close.rMultiple.toFixed(2) : "unknown"}.`,
    votes ? `Analyst votes: ${votes}` : "",
    trade.sageVerdict ? `Risk verdict: ${trade.sageVerdict}` : "",
    log ? `Decision log: ${log}` : "",
    "What should a future analyst learn from this loss?",
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeHawkVotes(raw: string): string {
  try {
    const votes = JSON.parse(raw) as { persona: string; vote: string; reason: string }[];
    if (!Array.isArray(votes) || votes.length === 0) return "";
    return votes.map((v) => `${v.persona}=${v.vote} (${v.reason})`).join("; ");
  } catch {
    return "";
  }
}

function summarizeDecisionLog(raw: string): string {
  try {
    const log = JSON.parse(raw) as { stage: string; note: string }[];
    if (!Array.isArray(log) || log.length === 0) return "";
    return log.slice(-6).map((e) => `${e.stage}: ${e.note}`).join("; ");
  } catch {
    return "";
  }
}

/** Deterministic lesson used when no AI backend is available (matches mockHawk/mockSage's "(mock)" convention). */
export function mockLesson(trade: Trade, close: LessonInput): LessonResult {
  const detail = close.rMultiple != null ? ` (R ${close.rMultiple.toFixed(2)})` : "";
  return {
    text: `Loss on ${trade.symbol} ${trade.side}${detail}: re-examine entry timing vs SL placement (mock).`,
    costUsd: 0,
  };
}
