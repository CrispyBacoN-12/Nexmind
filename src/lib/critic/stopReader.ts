// The AI's reading of the chart stop on an /advisor card.
//
// Impure (it spawns a subprocess through anthropic.ts), which is why it sits
// here and not in src/lib/advisor/. It mirrors chartAgent/review.ts's
// reviewSetups and critic/advisorCritic.ts: the prompt and the guard live in the
// pure advisor/stopReading.ts, this file only decides whether to call the model.
//
// readStop NEVER throws. The card above it is already complete and correct; the
// reading is a description of a number the code chose, not an input to it.

import type { StopContext } from "@/lib/advisor/chartStop";
import {
  STOP_READING_SCHEMA,
  STOP_READING_SYSTEM,
  buildStopReadingPrompt,
  normalizeStopReading,
  skipNoteFor,
  type StopReading,
} from "@/lib/advisor/stopReading";
import type { AdvisorCard } from "@/lib/advisor/types";
import { aiBackend, aiOutageReason, callAgentJSON } from "@/lib/anthropic";
import { mockBackendNote } from "@/lib/chartAgent/review";
import { RAW_WITHHELD_REASON, safeFailureReason } from "@/lib/scanAgent/annotate";

const NO_BARS_NOTE = "ไม่มีแท่ง 5 นาทีให้ AI อ่าน";

export async function readStop(card: AdvisorCard, ctx: StopContext | null): Promise<StopReading> {
  const backend = aiBackend();
  const skip = (note: string): StopReading => ({ status: "skipped", reading: null, concern: null, note, backend });
  const unread = (note: string): StopReading => ({ status: "unread", reading: null, concern: null, note, backend });

  const skipNote = skipNoteFor(card.stopSource);
  if (skipNote !== null) return skip(skipNote);
  if (ctx === null) return skip(NO_BARS_NOTE);
  if (backend === "mock") return unread(mockBackendNote(aiOutageReason()));

  try {
    const r = await callAgentJSON<unknown>({
      tier: "sonnet",
      label: "advisor-stop-reading",
      system: STOP_READING_SYSTEM,
      prompt: buildStopReadingPrompt(card, ctx),
      maxTokens: 2000,
      jsonSchema: STOP_READING_SCHEMA,
    });
    return normalizeStopReading(r.data, backend);
  } catch (err) {
    const safe = safeFailureReason(err);
    if (safe === RAW_WITHHELD_REASON) {
      console.error("advisor-stop-reading: withholding raw model text from the page:", err instanceof Error ? err.message : String(err));
    }
    return unread(safe);
  }
}
