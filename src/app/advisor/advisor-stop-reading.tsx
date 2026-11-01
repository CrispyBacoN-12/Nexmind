"use client";

// The AI's short Thai reading of the chart stop, under the stop line.
//
// Decoration on a card that is already complete: it never changes a number, and
// if the call fails or the backend is down the card above is unchanged. Same
// shape as AdvisorCritique: it fires itself once on mount (the form remounts it
// per card via `key`), behind a firedRef guard against Strict Mode's dev-only
// double invoke, and the button stays for a manual re-run.
//
// Only a swing or PDL stop is read. For a given or ATR stop there is nothing to
// read, so it shows the reason and never calls the route.

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import type { StopContext } from "@/lib/advisor/chartStop";
// Type-only: stopReading.ts reaches the AI backend, which cannot ship to a browser.
import type { StopReading } from "@/lib/advisor/stopReading";
import { skipNoteFor } from "@/lib/advisor/stopReadingNotes";
import type { AdvisorCard } from "@/lib/advisor/types";

export function AdvisorStopReading({ card, context }: { card: AdvisorCard; context: StopContext | null }) {
  const skipNote = skipNoteFor(card.stopSource);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StopReading | null>(null);
  const firedRef = useRef(false);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/advisor/stop-reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card, context }),
      });
      // An error body that is not this route's JSON (a proxy 502 page, say)
      // must not surface as a JSON parse error.
      const json = (await res.json().catch(() => null)) as StopReading | { ok: false; error: string } | null;
      if (json === null) {
        setError(`เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status} ด้วยข้อมูลที่หน้านี้อ่านไม่ได้`);
      } else if ("ok" in json && json.ok === false) {
        setError(json.error);
      } else {
        setResult(json as StopReading);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Remounted (key = formEpoch) on every new card, so "on mount" is once per card.
  useEffect(() => {
    if (skipNote !== null || firedRef.current) return;
    firedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (skipNote !== null) {
    return <p className="text-xs text-(--color-muted)">{skipNote}</p>;
  }

  return (
    <div className="space-y-2 rounded-md border border-(--color-border) p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-(--color-muted)">AI อ่านโครงสร้างของ stop</span>
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={loading}>
          {loading ? "กำลังอ่าน…" : "อ่านอีกครั้ง"}
        </Button>
        {loading ? <span className="text-xs text-(--color-muted)">อาจใช้เวลา 10-40 วินาที</span> : null}
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {result?.status === "read" && result.reading ? (
        <div className="space-y-1">
          <p className="text-sm">{result.reading}</p>
          {result.concern ? <p className="text-xs text-(--color-muted)">ข้อกังวล: {result.concern}</p> : null}
          <p className="text-xs text-(--color-muted)">
            AI อ่านอย่างเดียว ไม่ได้เปลี่ยนตัวเลขใดบนการ์ด · {result.backend}
          </p>
        </div>
      ) : null}
      {result && result.status !== "read" ? (
        <p className="text-sm text-(--color-muted)">{result.note ?? "ไม่มีคำอ่านรอบนี้"}</p>
      ) : null}
    </div>
  );
}
