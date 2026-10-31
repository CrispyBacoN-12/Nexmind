import { PageHeader } from "@/components/ui";
import { ADVISOR_NO_EDGE_CLAIM } from "@/lib/advisor/types";

import { AdvisorForm } from "./advisor-form";

export const metadata = { title: "ที่ปรึกษาการเทรด — NEXMIND" };

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ticker, entry, stop } = await searchParams;
  // A repeated ?ticker=A&ticker=B arrives as an array; take the first.
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const initialTicker = first(ticker).trim().toUpperCase();
  // The chart agent's setup panel links here with ?entry=&stop=. They stay
  // strings: only POST /api/advisor parses them, so a malformed one surfaces as
  // that route's 400 rather than being quietly dropped or coerced here.
  const initialEntry = first(entry).trim();
  const initialStop = first(stop).trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="ที่ปรึกษาการเทรด"
        description="พิมพ์ชื่อหุ้น แล้วดูโครงสร้าง ความเสี่ยง และสิ่งที่เงินทุนหนึ่งช่องของคุณซื้อได้จริง"
      />
      <p className="text-sm text-(--color-muted) max-w-2xl border-l-2 border-(--color-border) pl-4">
        {ADVISOR_NO_EDGE_CLAIM}
      </p>
      <AdvisorForm initialTicker={initialTicker} initialEntry={initialEntry} initialStop={initialStop} />
    </div>
  );
}
