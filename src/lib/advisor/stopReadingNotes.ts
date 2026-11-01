// The stop-source skip notes, split out of stopReading.ts because the card's
// client component needs them and stopReading.ts (via chartAgent/review) pulls
// in the AI backend, which spawns child processes and cannot ship to a browser.
// Pure, no imports beyond a type.

import type { AdvisorCard } from "@/lib/advisor/types";

export const SKIP_NOTE_ATR = "stop นี้ไม่ได้มาจากโครงกราฟ จึงไม่มีอะไรให้อ่าน";
export const SKIP_NOTE_GIVEN = "stop นี้กำหนดมาเอง (จากป๊อปอัป agent กราฟหรือพิมพ์เอง) จึงไม่ได้ให้ AI อ่านซ้ำ";

/** Only structural stops (swing, PDL) are read; the ATR rule and a given stop are not. */
export function skipNoteFor(source: AdvisorCard["stopSource"]): string | null {
  if (source === "atr") return SKIP_NOTE_ATR;
  if (source === "given") return SKIP_NOTE_GIVEN;
  return null;
}
