import { headers } from "next/headers";

import { Card, PageHeader } from "@/components/ui";
import { isDeployed, isLocalRequest } from "@/lib/portfolioRisk/localOnly";

import { PortfolioPanel } from "./portfolio-panel";

export const metadata = { title: "พอร์ตของฉัน — NEXMIND" };
export const dynamic = "force-dynamic";

/** LOCAL ONLY: the owner's real holdings never render on the public site. */
export default async function PortfolioPage() {
  if (isDeployed() || !isLocalRequest(await headers())) {
    return (
      <Card>
        <p className="text-sm">ใช้ได้เฉพาะบนเครื่อง</p>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="พอร์ตของฉัน"
        description="หุ้นที่ถืออยู่จริง (เก็บในไฟล์บนเครื่องนี้เท่านั้น ไม่ขึ้นเว็บ) และการวิเคราะห์ความเสี่ยงของพอร์ต"
      />
      <PortfolioPanel />
    </div>
  );
}
