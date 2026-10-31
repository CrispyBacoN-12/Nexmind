import { PageHeader } from "@/components/ui";

import { JournalPanel } from "./journal-panel";
import { RiskSentryHoldings } from "./risk-sentry-holdings";

export const metadata = { title: "สมุดบันทึกเทรด — NEXMIND" };

export default function JournalPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="สมุดบันทึกเทรด"
        description="การเทรดที่คุณทำเองใน Webull และมูลค่าพอร์ตรายวัน — ข้อมูลพื้นฐานของ gate ระดับพอร์ตใน Trade Advisor"
      />
      <JournalPanel />
      <RiskSentryHoldings />
    </div>
  );
}
