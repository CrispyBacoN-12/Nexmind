import { connection } from "next/server";

import { Badge, Card, CardTitle, Empty, PageHeader } from "@/components/ui";
import { CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { prisma } from "@/lib/db";
// Types only: nightly.ts / replay.ts / control.ts reach prisma and the backtest engine.
import type { AiVerdict, LiveSnapshot, RecentTrade } from "@/lib/scorecard/nightly";
import type { ReplaySummary } from "@/lib/scorecard/replay";
import { SCORECARD_COST_MODEL, SCORECARD_MAX_HOLD_SESSIONS, SCORECARD_MIN_N, SCORECARD_VERDICT_N } from "@/lib/scorecard/types";
import { cn, fmtMoney } from "@/lib/utils";

import { CumulativeChart } from "./cumulative-chart";
import { fmtR, rTone } from "./format";
import { GroupTable, type TableRow } from "./group-table";
import { isAiVerdict, isLiveSnapshot, isReplaySummary } from "./guards";

export const metadata = { title: "Scorecard — NEXMIND" };

// Always rendered per request: the nightly job writes new snapshots, and a build-time
// render would show them stale.
export const dynamic = "force-dynamic";

const GROUP_LABEL: Record<RecentTrade["group"], string> = {
  kept: "เก็บ",
  vetoed: "ทิ้ง",
  stripped: "guard ตัด",
  unread: "ยังไม่อ่าน",
};

const RUN_STATUS_LABEL: Record<string, string> = {
  ran: "รันแล้ว",
  no_session: "ไม่มีตลาดเปิด",
  failed: "ล้มเหลว",
  none: "ไม่มีบันทึกการรัน",
};

/** A stored snapshot: not there, there but failing its shape guard (older/partial), or usable. */
type Snap<T> = { kind: "absent" } | { kind: "old" } | { kind: "ok"; value: T };

const OLD_SHAPE = "รูปแบบข้อมูลเก่า — รอรอบถัดไป";

function classify<T>(data: unknown, guard: (v: unknown) => v is T): Snap<T> {
  if (data === null || data === undefined) return { kind: "absent" };
  return guard(data) ? { kind: "ok", value: data } : { kind: "old" };
}

interface PageData {
  replay: Snap<ReplaySummary>;
  live: Snap<LiveSnapshot>;
  verdict: Snap<AiVerdict>;
  startDate: string | null;
}

async function loadData(): Promise<PageData> {
  const ruleVersion = CHART_RULE_VERSION;
  const snap = (kind: string) => prisma.scorecardSnapshot.findUnique({ where: { kind_ruleVersion: { kind, ruleVersion } } });
  const [replay, live, verdict, firstRun] = await Promise.all([
    snap("replay"),
    snap("live"),
    snap("ai-verdict"),
    prisma.scorecardRun.findFirst({ orderBy: { sessionDate: "asc" }, select: { sessionDate: true } }),
  ]);
  const liveSnap = classify(live?.data, isLiveSnapshot);
  let verdictSnap = classify(verdict?.data, isAiVerdict);
  // No stored verdict row: fall back to the one embedded in a usable live snapshot.
  if (verdictSnap.kind === "absent" && liveSnap.kind === "ok" && liveSnap.value.verdict) {
    verdictSnap = { kind: "ok", value: liveSnap.value.verdict };
  }
  return {
    replay: classify(replay?.data, isReplaySummary),
    live: liveSnap,
    verdict: verdictSnap,
    startDate: firstRun?.sessionDate ?? null,
  };
}

function ReplayCard({ snap }: { snap: Snap<ReplaySummary> }) {
  if (snap.kind !== "ok") {
    return (
      <Card>
        <CardTitle>ผลย้อนหลัง กฎในโค้ด</CardTitle>
        <div className="text-2xl font-semibold tracking-tight text-(--color-muted)">
          {snap.kind === "old" ? OLD_SHAPE : "ยังไม่ได้รันผลย้อนหลัง"}
        </div>
        {snap.kind === "absent" && (
          <p className="text-sm text-(--color-muted) mt-2">ยังไม่มีผลย้อนหลังของกฎ {CHART_RULE_VERSION} ให้แสดง</p>
        )}
      </Card>
    );
  }
  const replay = snap.value;
  const hold = replay.stats.hold;
  const sameDay = replay.stats.sameDay;
  return (
    <Card>
      <CardTitle>
        ผลย้อนหลัง กฎในโค้ด ({replay.period.from} ถึง {replay.period.to})
      </CardTitle>
      <div className={cn("text-2xl font-semibold tracking-tight", replay.pass ? "text-emerald-400" : "text-rose-400")}>
        {replay.pass ? "ผ่าน" : "ไม่ผ่าน"}
      </div>
      <div className="text-sm mt-2 tabular-nums">
        {hold.n.toLocaleString("en-US")} เทรด · เฉลี่ย <span className={rTone(hold.meanR)}>{fmtR(hold.meanR)}</span>
        {hold.n < SCORECARD_MIN_N && <span className="text-(--color-muted)"> (ยังน้อยเกินไป)</span>}
      </div>
      <div className="text-sm text-(--color-muted) mt-1 tabular-nums">
        {replay.control
          ? `ซื้อสุ่ม: มัธยฐาน ${fmtR(replay.control.median)} (p95 ${fmtR(replay.control.p95)}, ${replay.control.runs} รอบ)`
          : "ไม่มีผลตัวเทียบซื้อสุ่ม"}
      </div>
      <div className="text-xs text-(--color-muted) mt-2 tabular-nums">
        {replay.sessions} วันทำการ · หุ้น {replay.tickersWithData}/{replay.universe} ตัวมีข้อมูลครบ · เจอ setup {replay.setupsFound} ·
        เข้าได้ {replay.filled} ไม่ได้เข้า {replay.notFilled}
        {replay.open > 0 ? ` ถืออยู่ ${replay.open}` : ""} · ขายตอนปิดวันนั้น {fmtR(sameDay.meanR)} (n {sameDay.n})
        {replay.tailSessionsExcluded
          ? ` · ไม่นับ setup ใน ${replay.tailSessionsExcluded} วันทำการสุดท้าย (ถือไม่ครบ ${SCORECARD_MAX_HOLD_SESSIONS} วันในช่วง)`
          : ""}
      </div>
      <p className="text-xs text-(--color-muted) mt-2">
        &quot;ผ่าน&quot; แปลว่าเฉลี่ย R สูงกว่า p95 ของซื้อสุ่มเท่านั้น ไม่ใช่การรับรองว่ามี edge
      </p>
    </Card>
  );
}

function AiCard({ live, verdict: verdictSnap, startDate }: { live: Snap<LiveSnapshot>; verdict: Snap<AiVerdict>; startDate: string | null }) {
  const title = `ผลจริง AI${startDate ? ` (เริ่ม ${startDate})` : ""}`;
  if (verdictSnap.kind === "old" || (verdictSnap.kind === "absent" && live.kind === "old")) {
    return (
      <Card>
        <CardTitle>{title}</CardTitle>
        <div className="text-2xl font-semibold tracking-tight text-(--color-muted)">{OLD_SHAPE}</div>
      </Card>
    );
  }
  if (verdictSnap.kind === "ok") {
    const verdict = verdictSnap.value;
    return (
      <Card>
        <CardTitle>{title}</CardTitle>
        <div className={cn("text-2xl font-semibold tracking-tight", verdict.pass ? "text-emerald-400" : "text-rose-400")}>
          {verdict.pass ? "เชื่อได้" : "เชื่อไม่ได้"}
        </div>
        <div className="text-sm mt-2 tabular-nums">
          n = {verdict.n} setup ที่ AI เก็บ · เฉลี่ย R <span className={rTone(verdict.meanR)}>{fmtR(verdict.meanR)}</span>
        </div>
        <div className="text-sm text-(--color-muted) mt-1 tabular-nums">
          ซื้อสุ่ม: p95 {fmtR(verdict.controlP95)} · มัธยฐาน {fmtR(verdict.controlMedian)} ({verdict.runs} รอบ)
        </div>
        <p className="text-xs mt-2">
          {verdict.pass
            ? "หมายถึงเฉลี่ย R ของ 300 setup แรกที่ AI เก็บ สูงกว่า p95 ของการซื้อสุ่ม — ไม่ใช่การรับประกันว่ามี edge"
            : "เฉลี่ย R ของ 300 setup แรกที่ AI เก็บ ไม่ชนะ p95 ของการซื้อสุ่ม"}
        </p>
        <p className="text-xs text-(--color-muted) mt-2">
          คำตัดสินตรึงแล้วเมื่อ {verdict.computedAt.slice(0, 10)} (setup #{verdict.firstId} ถึง #{verdict.lastId}) จะไม่ถูกคำนวณใหม่
        </p>
      </Card>
    );
  }
  if (live.kind !== "ok") {
    return (
      <Card>
        <CardTitle>{title}</CardTitle>
        <div className="text-2xl font-semibold tracking-tight text-(--color-muted)">ยังไม่มีข้อมูลจากรอบอัตโนมัติ</div>
        <p className="text-sm text-(--color-muted) mt-2">รอบอัตโนมัติยังไม่ได้ให้คะแนนเทรดใดเลย</p>
      </Card>
    );
  }
  const { n, closed, target } = live.value.keptProgress;
  const pct = Math.min(100, (n / target) * 100);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="text-2xl font-semibold tracking-tight text-amber-400">
        ยังตัดสินไม่ได้ {n}/{target}
      </div>
      <div
        className="h-1.5 rounded bg-(--color-border) mt-2 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={n}
      >
        <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-sm mt-2 tabular-nums">
        {n} / {SCORECARD_VERDICT_N} setup ที่ AI เก็บและเข้าได้ · ปิดแล้ว {closed} · เฉลี่ย{" "}
        <span>{closed >= SCORECARD_MIN_N ? fmtR(live.value.keptProgress.meanR) : "ยังน้อยเกินไป"}</span>
      </div>
      <p className="text-xs text-(--color-muted) mt-2">
        {n < target
          ? `ตัดสินเมื่อ AI เก็บและเข้าได้ครบ ${target} setup และทุกตัวปิดแล้ว ก่อนหน้านั้นไม่มีคำตัดสิน`
          : "ครบ 300 แล้ว รอให้ทุกตัวปิดครบก่อนตัดสิน"}
      </p>
    </Card>
  );
}

/**
 * A fixed category for a failed run; the raw error text stays in logs and Discord. A failed
 * run with setups logged got through the scan and chart agent, so its write failed.
 */
function failureCategory(r: LiveSnapshot["lastRun"]): string {
  return r.setups > 0 ? "บันทึกไม่สำเร็จ" : "รอบล้มเหลว";
}

function RunStatus({ live }: { live: LiveSnapshot }) {
  const r = live.lastRun;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-(--color-muted)">
      <span>
        รอบอัตโนมัติล่าสุด {r.sessionDate}: {RUN_STATUS_LABEL[r.status] ?? r.status}
        {r.status === "ran" ? ` · ${r.setups} setup (เก็บ ${r.kept} ทิ้ง ${r.vetoed} ตัด ${r.stripped} ยังไม่อ่าน ${r.unread})` : ""}
      </span>
      {r.aiDown && <Badge tone="warning">AI ไม่ตอบ: ทุก setup ในรอบนี้ยังไม่ได้อ่าน</Badge>}
      {r.error && <Badge tone="negative">{failureCategory(r)}</Badge>}
      <span>· คำนวณเมื่อ {live.computedAt.slice(0, 16).replace("T", " ")} UTC</span>
    </div>
  );
}

function tableRows(live: LiveSnapshot, frozen: boolean): TableRow[] {
  const row = (key: keyof LiveSnapshot["stats"], label: string, note?: string): TableRow => ({
    key,
    label,
    note,
    stats: live.stats[key],
    counts: { open: live.counts[key].open, notFilled: live.counts[key].notFilled, noData: live.counts[key].noData },
  });
  const rows: TableRow[] = [row("kept", frozen ? `AI เก็บ (${SCORECARD_VERDICT_N} แรก)` : "AI เก็บ")];
  if (frozen) rows.push(row("afterVerdict", "หลังคำตัดสิน", "ข้อมูลประกอบเท่านั้น ไม่นับในคำตัดสิน"));
  rows.push(row("vetoed", "AI ทิ้ง"), row("unread", "ยังไม่ได้อ่าน", "AI ไม่ตอบ"), row("stripped", "guard ตัดทิ้ง", "คำอ่านมีการทำนาย ถูกตัดทั้งอัน"));
  return rows;
}

function tradeResult(t: RecentTrade): { text: string; tone: string } {
  const { status, r, reason, sessionsHeld } = t.hold;
  if (status === "closed") {
    const why = reason === "t1" ? "ถึง T1" : reason === "stop" ? "ชน stop" : "ครบเวลา";
    return { text: `${fmtR(r, 1)} ${why}`, tone: rTone(r) };
  }
  if (status === "open") {
    return t.fill === null
      ? { text: "รอเข้า", tone: "text-(--color-muted)" }
      : { text: `ถืออยู่ วันที่ ${Math.max(1, sessionsHeld)}/10`, tone: "text-amber-400" };
  }
  if (status === "not_filled") return { text: "ไม่ได้เข้า", tone: "text-(--color-muted)" };
  return { text: "ไม่มีข้อมูลราคา", tone: "text-(--color-muted)" };
}

function modelMixText(mix: Record<string, number> | undefined): string {
  const entries = Object.entries(mix ?? {}).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([m, c]) => `${m} × ${c}`).join(", ") : "ยังไม่มีข้อมูล";
}

export default async function ScorecardPage() {
  await connection();

  let data: PageData | null = null;
  try {
    data = await loadData();
  } catch (e) {
    // The raw message can carry the DB host; keep it server-side.
    console.error("[scorecard] load failed", e);
  }

  const header = (
    <PageHeader
      title="ผลงานของ chart agent"
      description="ถ้าซื้อ setup ที่ chart agent เสนอจริง ผลจะเป็นอย่างไร (หน้าอ่านอย่างเดียว ไม่เรียก AI ไม่ดึงราคา)"
    />
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <Empty title="โหลดข้อมูลไม่สำเร็จ" hint="ลองรีเฟรชอีกครั้ง" />
      </div>
    );
  }

  const { startDate } = data;
  const replay = data.replay.kind === "ok" ? data.replay.value : null;
  const live = data.live.kind === "ok" ? data.live.value : null;
  const verdict = data.verdict.kind === "ok" ? data.verdict.value : null;
  const frozen = verdict !== null;
  // No control exists before the verdict is frozen.
  const controlMedian = verdict ? (live?.keptControl?.median ?? verdict.controlMedian) : null;
  const modelMix = verdict?.modelMix ?? live?.modelMix;
  const liveFallback = data.live.kind === "old" ? OLD_SHAPE : null;
  const costs = SCORECARD_COST_MODEL;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 md:grid-cols-2">
        <ReplayCard snap={data.replay} />
        <AiCard live={data.live} verdict={data.verdict} startDate={startDate} />
      </div>
      {live && <RunStatus live={live} />}

      <Card>
        <CardTitle>AI เก็บ vs AI ทิ้ง (ผลจริง)</CardTitle>
        {live ? (
          <GroupTable rows={tableRows(live, frozen)} controlMedian={controlMedian} showTone={frozen} />
        ) : liveFallback ? (
          <Empty title={liveFallback} />
        ) : (
          <Empty title="ยังไม่มีข้อมูลจากรอบอัตโนมัติ" hint="ตารางจะขึ้นเมื่อรอบอัตโนมัติให้คะแนนเทรดชุดแรก" />
        )}
      </Card>

      <Card>
        <CardTitle>เส้นผลสะสม (R)</CardTitle>
        {live && [live.cumulativeR.kept, live.cumulativeR.vetoed, live.cumulativeR.afterVerdict].some((s) => s.length > 0) ? (
          <>
            <CumulativeChart
              kept={live.cumulativeR.kept}
              vetoed={live.cumulativeR.vetoed}
              afterVerdict={live.cumulativeR.afterVerdict}
              controlMedian={controlMedian}
            />
            <p className="text-xs text-(--color-muted) mt-2">
              นับตามวันที่ปิดเทรด เฉพาะเทรดที่ปิดแล้ว
              {controlMedian === null ? " · เส้นซื้อสุ่มจะขึ้นเมื่อมีคำตัดสิน" : " · เส้นซื้อสุ่ม = มัธยฐานต่อเทรด × จำนวนเทรดที่ AI เก็บ"}
            </p>
          </>
        ) : liveFallback ? (
          <Empty title={liveFallback} />
        ) : (
          <Empty title="ยังไม่มีเทรดที่ปิดแล้ว" hint="เส้นจะขึ้นเมื่อมีเทรดแรกที่ปิด" />
        )}
      </Card>

      <Card>
        <CardTitle>เทรดล่าสุด (30 รายการ)</CardTitle>
        {live && live.recentTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="border-b border-(--color-border) text-xs text-(--color-muted)">
                  {["วันที่", "หุ้น", "AI", "เข้า", "stop", "T1", "ผล"].map((h, i) => (
                    <th key={h} className={cn("px-3 py-2 font-medium", i >= 3 && i <= 5 ? "text-right" : "text-left")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {live.recentTrades.map((t) => {
                  const res = tradeResult(t);
                  return (
                    <tr key={t.id} className="border-b border-(--color-border)/60">
                      <td className="px-3 py-2">{t.date}</td>
                      <td className="px-3 py-2 font-medium">{t.ticker}</td>
                      <td className="px-3 py-2">{GROUP_LABEL[t.group]}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(t.fill)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(t.stop)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(t.t1)}</td>
                      <td className={cn("px-3 py-2", res.tone)}>{res.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : liveFallback ? (
          <Empty title={liveFallback} />
        ) : (
          <Empty title="ยังไม่มีเทรด" hint="รอบอัตโนมัติยังไม่ได้บันทึก setup ใดเลย" />
        )}
        <p className="text-xs text-(--color-muted) mt-2">
          ราคาเข้า = ราคาเปิดของแท่ง 5 นาทีแรกหลังรอบ 10:30 ET (ยังไม่มีราคาเข้าแสดงเป็น &quot;—&quot;)
        </p>
      </Card>

      <Card>
        <CardTitle>วันที่ไม่มีข้อมูล</CardTitle>
        {!live ? (
          <p className="text-sm text-(--color-muted)">{liveFallback ?? "ยังไม่มีข้อมูลจากรอบอัตโนมัติ"}</p>
        ) : live.missed.length === 0 ? (
          <p className="text-sm text-(--color-muted)">ไม่มีวันที่ขาดในช่วง 30 วันทำการที่ผ่านมา</p>
        ) : (
          <ul className="text-sm space-y-1">
            {live.missed.map((m) => (
              <li key={m.date} className="tabular-nums">
                <span className="font-medium">{m.date}</span>{" "}
                <span className="text-(--color-muted)">{m.failed ? "รอบล้มเหลว" : "ไม่มีบันทึกการรัน (เครื่องปิดหรือไม่ได้รัน)"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="text-xs text-(--color-muted) space-y-1.5">
        <CardTitle>ข้อควรรู้</CardTitle>
        <p>ไม่ใช่คำแนะนำซื้อ ไม่มี rule ไหนผ่าน hold-out หน้านี้วัดว่า setup ที่เสนอจะเป็นอย่างไรถ้าซื้อ ไม่ได้บอกว่ามี edge</p>
        <p>
          ผลย้อนหลังใช้รายชื่อ S&amp;P 500 แบบคงที่ชุดเดียวกับที่ /scan ใช้ (ประมาณ 490 ตัว) มีบางตัวที่หลุดดัชนีไปแล้ว และขาดตัวที่เพิ่งเข้าใหม่ หุ้นที่เลิกซื้อขายไปแล้วไม่อยู่ในตัวอย่าง (survivorship bias) ทำให้ผลดูดีกว่าจริงได้
        </p>
        <p>ผลย้อนหลังไม่มีข้อมูลงบ (earnings) และ 8-K ที่ใช้จัดอันดับหุ้นในรอบจริง — คะแนนส่วนนั้นนับเป็น 0</p>
        <p>
          เฉลี่ย R ทุกตัวหักต้นทุนแล้ว: slippage {costs.slippageBps} bps ทุกครั้งที่เข้า/ออก และคอมมิชชัน {costs.commissionBps} bp ต่อมูลค่าที่เข้า
          ตัวเทียบซื้อสุ่มหักต้นทุนเท่ากัน ต้นทุนจึงหักล้างกันเกือบหมดในส่วนต่าง
        </p>
        <p>
          model ที่อ่าน setup ของคำตัดสิน: {modelMixText(modelMix)}
          {modelMix && Object.keys(modelMix).length > 1 ? " (หลาย model ปนกันในตัวอย่างเดียว)" : ""}
        </p>
        {replay && replay.biases.length > 0 && (
          <ul className="list-disc pl-5 space-y-0.5">
            {replay.biases.map((b, i) => (
              <li key={`${i}-${b}`}>{b}</li>
            ))}
          </ul>
        )}
        {replay && replay.missingTickers.length > 0 && (
          <p>หุ้นที่ไม่มีข้อมูลครบ ไม่ถูกจัดอันดับ: {replay.missingTickers.length} ตัว</p>
        )}
      </Card>
    </div>
  );
}
