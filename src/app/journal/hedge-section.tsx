"use client";

// "เช็กประกัน put": what a protective put would cost and change for each open
// position. Fetched only on a button press. Risk display only — no row is
// marked as the pick and nothing here says to buy.
// Spec: docs/superpowers/specs/2026-11-25-journal-put-hedge-design.md

import { useState } from "react";

import { Badge, Button } from "@/components/ui";
import { earningsPhrase } from "@/lib/advisor/earningsPhrase";
import type { HedgeCard } from "@/lib/hedge/card";
import type { StrikeTarget } from "@/lib/hedge/types";
import { fmtMoney, fmtNumber } from "@/lib/utils";

const FOOTER =
  "ราคา option เป็นราคาประมาณการจาก Alpaca (indicative) ไม่ใช่ราคาจริงที่โบรกเกอร์ · 1 สัญญา = 100 หุ้น · นี่เป็นข้อมูลความเสี่ยง ไม่ใช่คำแนะนำให้ซื้อ · เช็กก่อนว่าบัญชีโบรกเกอร์ของคุณเทรด option สหรัฐฯ ได้";

const TARGET_LABEL: Record<StrikeTarget, string> = { stop: "stop", minus5: "−5%", atm: "ราคาตอนนี้" };

const pct = (f: number | null | undefined, digits = 1) =>
  f == null || !Number.isFinite(f) ? "—" : `${(f * 100).toFixed(digits)}%`;

/** A negative "loss" is a locked-in gain (price already well above entry): say so instead of "$-603". */
function lossText(n: number | null | undefined, gainWord: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n < 0 ? `${gainWord} ${fmtMoney(-n)}` : fmtMoney(n);
}

function ictTime(iso: string | null): string {
  if (!iso) return "ไม่ทราบเวลา";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "ไม่ทราบเวลา";
  return `${d.toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }).slice(0, 16)} ICT`;
}

function HedgeCardView({ card, asOf }: { card: HedgeCard; asOf: string }) {
  const n = card.contracts;
  return (
    <div className="rounded-md border border-(--color-border) p-3 space-y-2 text-xs">
      <p className="text-sm">
        <span className="font-semibold">{card.ticker}</span> · {fmtNumber(card.shares, 4)} หุ้น · ทุน {fmtMoney(card.entryPrice)} · stop{" "}
        {fmtMoney(card.stop)} ·{" "}
        {card.price == null ? (
          <span className="text-amber-400">ไม่มีราคาหุ้น</span>
        ) : card.priceSource === "lastClose" ? (
          <span className="text-amber-400">
            ราคาปิดแท่งล่าสุด {fmtMoney(card.price)} (แท่งวันที่ {card.priceAt?.slice(0, 10) ?? "?"})
          </span>
        ) : (
          <>
            ราคาตอนนี้ {fmtMoney(card.price)} ({ictTime(card.priceAt)})
          </>
        )}
      </p>
      {card.priceNote && (
        <p className="text-amber-400">
          {card.priceSource === "lastClose" ? "ใช้ราคาปิดแท่งล่าสุดเพราะดึงราคาสดไม่ได้: " : ""}
          {card.priceNote}
        </p>
      )}
      <p className="text-(--color-muted)">ประกาศงบ: {earningsPhrase(card.earnings, asOf)}</p>

      {card.price != null && (
        <>
          {card.optionsError ? (
            <p className="text-amber-400">ดึงราคา option ไม่ได้: {card.optionsError}</p>
          ) : card.expiry == null ? (
            <p className="text-amber-400">ไม่มีงวดหมดอายุที่เหมาะในช่วงนี้</p>
          ) : (
            <p>
              put หมดอายุ {card.expiry} ({card.expiryReason === "afterEarnings" ? "หมดอายุหลังประกาศงบ" : "ประมาณ 30 วัน"})
            </p>
          )}

          <p>
            ใช้ {n} สัญญา (คุม {n * 100} หุ้น) · ค่าเบี้ยรวมในตารางคิดจาก {n} สัญญา
          </p>
          {card.overHedge > 1 && (
            <Badge tone="warning">
              {n} สัญญาคุม {n * 100} หุ้น แต่ถือ {fmtNumber(card.shares, 4)} → คุมเกิน ×{fmtNumber(card.overHedge, 2)}
            </Badge>
          )}

          {card.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-(--color-muted)">
                  <tr>
                    <th className="pr-3 py-1">strike</th>
                    <th className="pr-3">bid / ask</th>
                    <th className="pr-3">ค่าเบี้ยรวม</th>
                    <th className="pr-3">% ของมูลค่าหุ้น</th>
                    <th className="pr-3">คุ้มทุน</th>
                    <th className="pr-3">ขาดทุนสูงสุดถ้ามี put</th>
                  </tr>
                </thead>
                <tbody>
                  {card.rows.map((r) => (
                    <tr key={r.strike} className="border-t border-(--color-border) align-top">
                      <td className="pr-3 py-1">
                        {fmtMoney(r.strike)} ({r.targets.map((t) => TARGET_LABEL[t]).join(", ")})
                        <div className="text-(--color-muted)">
                          {r.distancePct >= 0 ? `ต่ำกว่าราคา ${pct(r.distancePct)}` : `สูงกว่าราคา ${pct(-r.distancePct)}`}
                        </div>
                      </td>
                      <td className="pr-3">
                        {fmtMoney(r.bid)} / {r.ask == null ? "ไม่มีราคาเสนอขาย" : fmtMoney(r.ask)}
                        <div className="flex gap-1 mt-0.5">
                          {r.wideSpread && <Badge tone="warning">spread กว้าง</Badge>}
                          {r.stale && <Badge>ราคาเก่า</Badge>}
                        </div>
                      </td>
                      <td className="pr-3">{fmtMoney(r.premiumTotal)}</td>
                      <td className="pr-3">{pct(r.premiumPct)}</td>
                      <td className="pr-3">{fmtMoney(r.breakeven)}</td>
                      <td className="pr-3">{lossText(r.maxLossWithPut, "ไม่ขาดทุน · กำไรอย่างน้อย")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {card.missing.map((m) => (
            <p key={m.target} className="text-(--color-muted)">
              {m.reason === "priceBelowStop" ? "ราคาอยู่ต่ำกว่า stop แล้ว" : `ไม่มี strike ใกล้ ${TARGET_LABEL[m.target]}`}
            </p>
          ))}

          {card.stopOnly && (
            <p>
              {card.stopOnly.note === "stopNotBelowEntry" ? (
                <span className="text-(--color-muted)">stop ไม่ได้อยู่ต่ำกว่าราคาทุน</span>
              ) : (
                <>
                  stop อย่างเดียว: ขาดทุน {fmtMoney(card.stopOnly.atStop)} ถ้า fill ที่ stop ·{" "}
                  {card.stopOnly.note === "notEnoughHistory" ? (
                    <span className="text-(--color-muted)">ข้อมูลราคาย้อนหลังไม่พอคำนวณกรณีกระโดด</span>
                  ) : (
                    <>
                      {lossText(card.stopOnly.gapLoss, "ยังกำไร")} ถ้าเปิดกระโดดลงแรงเท่าครั้งที่แย่ที่สุดในรอบปี (−{pct(card.stopOnly.gapPct)})
                    </>
                  )}
                </>
              )}
            </p>
          )}

          {card.rows[0] && <p className="text-(--color-muted)">ราคา quote เมื่อ {ictTime(card.rows[0].quotedAt)}</p>}
        </>
      )}
    </div>
  );
}

export function HedgeSection({ openCount }: { openCount: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ asOf: string; cards: HedgeCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (openCount === 0) return null;

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/journal/hedges");
      const j = (await r.json()) as { ok: boolean; asOf?: string; cards?: HedgeCard[]; error?: string };
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResult({ asOf: j.asOf ?? "", cards: j.cards ?? [] });
    } catch (e) {
      setResult(null);
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <Button size="sm" variant="outline" disabled={busy} onClick={check}>
        {busy ? "กำลังดึงราคา put…" : "เช็กประกัน put"}
      </Button>
      {error && <p className="text-xs text-amber-400">เช็กประกัน put ไม่สำเร็จ: {error}</p>}
      {result && (
        <div className="space-y-3">
          {result.cards.map((c) => (
            <HedgeCardView key={c.id} card={c} asOf={result.asOf} />
          ))}
          <p className="text-xs text-(--color-muted)">{FOOTER}</p>
        </div>
      )}
    </div>
  );
}
