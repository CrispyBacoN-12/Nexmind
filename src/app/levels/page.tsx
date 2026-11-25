import { headers } from "next/headers";

import { Card, PageHeader } from "@/components/ui";
import { isDeployed, isLocalRequest } from "@/lib/portfolioRisk/localOnly";

import { LevelsPanel } from "./levels-panel";

export const metadata = { title: "แนวรับ–แนวต้าน — NEXMIND" };
export const dynamic = "force-dynamic";

/** LOCAL ONLY: a held ticker shows the owner's average cost on the chart. */
export default async function LevelsPage() {
  if (isDeployed() || !isLocalRequest(await headers())) {
    return (
      <Card>
        <p className="text-sm">ใช้ได้เฉพาะบนเครื่อง</p>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader title="แนวรับ–แนวต้าน" description="ค้นหาหุ้นทีละตัว ดูโซนที่ราคาเคยกลับตัวหรือซื้อขายหนาแน่น บนกราฟแท่งเทียนรายวัน 2 ปี" />
      <LevelsPanel />
    </div>
  );
}
