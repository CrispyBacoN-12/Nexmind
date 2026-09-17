"use client";

// RAVEN's block on the advisor card.
//
// It is decoration on a card that is already complete: if the fetch below
// fails, or the backend is down, everything above this block is unchanged and
// still correct. It runs automatically once per card (a mount-only effect) —
// the parent remounts this component (key={critiqueKey}) on every new
// submission or field edit, so a fresh card always gets a fresh critique
// without a separate click. The wait is 10-40s behind a 3-way subprocess
// queue; the card itself has already rendered by the time this starts.

import { useEffect, useState } from "react";

import { Badge, Button, Card, CardTitle } from "@/components/ui";
import type { ChartBar } from "@/lib/advisor/chartSeries";
import type { CritiqueResult, Severity } from "@/lib/advisor/critiqueContext";
import type { AdvisorCard } from "@/lib/advisor/types";

/** `serious` is a stronger argument, not an alarm. No red. */
const SEVERITY_TONE: Record<Severity, "neutral" | "info" | "warning"> = {
  note: "neutral",
  concern: "info",
  serious: "warning",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  note: "ข้อสังเกต",
  concern: "ข้อกังวล",
  serious: "ข้อกังวลร้ายแรง",
};

export function AdvisorCritique({ card, chart }: { card: AdvisorCard; chart: ChartBar[] | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CritiqueResult | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/advisor/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card, chart }),
      });
      // res.ok is not enough on its own and neither is res.json(): an error
      // body that is not this route's JSON (a proxy 502 page, say) would
      // otherwise surface to the owner as a JSON parse error.
      const json = (await res.json().catch(() => null)) as CritiqueResult | { ok: false; error: string } | null;
      if (json === null) {
        setError(`เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status} ด้วยข้อมูลที่หน้านี้อ่านไม่ได้`);
      } else if ("ok" in json && json.ok === false) {
        setError(json.error);
      } else {
        setResult(json as CritiqueResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Once per mount — i.e. once per new card, since the parent remounts this
  // component on every submission or field edit. No dependency on card/chart:
  // a change to either already produces a new mount via the key prop, so
  // re-running from a dependency array would fire this twice for the same card.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-5 space-y-3">
      <CardTitle>RAVEN</CardTitle>
      <p className="text-xs text-(--color-muted)">
        RAVEN โต้แย้งได้อย่างเดียว — ไม่บอกให้ซื้อ ไม่บอกให้ขาย ไม่ให้คะแนน
      </p>

      {loading ? (
        <p className="text-xs text-(--color-muted)">กำลังหาข้อโต้แย้ง… อาจใช้เวลา 10-40 วินาที</p>
      ) : null}

      {error ? (
        <div className="space-y-2">
          <p className="text-sm text-rose-400">{error}</p>
          <Button type="button" onClick={run} disabled={loading}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : null}

      {result ? <CritiqueBody result={result} /> : null}
    </Card>
  );
}

function CritiqueBody({ result }: { result: CritiqueResult }) {
  if (result.degraded) {
    return (
      <p className="text-sm text-(--color-muted)">
        RAVEN ไม่ได้ทำงานรอบนี้ — {result.note}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {result.objections.length === 0 ? (
        result.stripped.length === 0 ? (
          <p className="text-sm">RAVEN ไม่พบข้อโต้แย้งจากตัวเลขชุดนี้ — ไม่ได้แปลว่าน่าเข้า</p>
        ) : (
          // stripped is one list for both objections and blind spots, so this
          // branch cannot tell which kind was muzzled. It says only what is
          // true either way; the <details> below carries the actual text.
          <p className="text-sm">
            RAVEN ไม่เหลือข้อโต้แย้งที่ใช้ได้ — มีข้อความที่เป็นคำชี้นำซื้อ/ขายถูกตัดออก ดูด้านล่าง
          </p>
        )
      ) : (
        <ul className="space-y-3">
          {result.objections.map((o, i) => (
            <li key={`${o.claim}-${i}`} className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge tone={SEVERITY_TONE[o.severity]}>{SEVERITY_LABEL[o.severity]}</Badge>
                <span className="text-sm">{o.claim}</span>
              </div>
              <p className="text-xs text-(--color-muted) font-mono pl-1">{o.evidence}</p>
            </li>
          ))}
        </ul>
      )}

      {result.blindSpots.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-(--color-muted)">สิ่งที่การ์ดใบนี้มองไม่เห็นเลย</p>
          <ul className="text-xs text-(--color-muted) list-disc pl-5 space-y-1">
            {result.blindSpots.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* A model that had to be muzzled is a fact about the model, so the count
          and the text are both shown rather than quietly dropped. */}
      {result.stripped.length > 0 ? (
        <details className="text-xs text-(--color-muted)">
          <summary>
            RAVEN พยายามให้คำแนะนำซื้อ/ขาย {result.stripped.length} ครั้ง — ตัดออกแล้ว
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {result.stripped.map((s, i) => (
              <li key={`${s}-${i}`}>{s}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* costUsd is 0 on the subscription backend. A printed "$0.00" reads as a
          bug, so the word is printed instead. */}
      <p className="text-xs text-(--color-muted)">
        {result.model ? `${result.model} · ` : ""}subscription
      </p>
    </div>
  );
}
