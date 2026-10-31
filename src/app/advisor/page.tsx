import { PageHeader } from "@/components/ui";
import { ADVISOR_NO_EDGE_CLAIM } from "@/lib/advisor/types";

import { AdvisorForm } from "./advisor-form";

export const metadata = { title: "ที่ปรึกษาการเทรด — NEXMIND" };

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ticker } = await searchParams;
  // A repeated ?ticker=A&ticker=B arrives as an array; take the first.
  const raw = Array.isArray(ticker) ? ticker[0] : ticker;
  const initialTicker = (raw ?? "").trim().toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        title="ที่ปรึกษาการเทรด"
        description="พิมพ์ชื่อหุ้น แล้วดูโครงสร้าง ความเสี่ยง และสิ่งที่เงินทุนหนึ่งช่องของคุณซื้อได้จริง"
      />
      <p className="text-sm text-(--color-muted) max-w-2xl border-l-2 border-(--color-border) pl-4">
        {ADVISOR_NO_EDGE_CLAIM}
      </p>
      <AdvisorForm initialTicker={initialTicker} />
    </div>
  );
}
