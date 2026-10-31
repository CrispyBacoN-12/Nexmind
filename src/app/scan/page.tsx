import { PageHeader } from "@/components/ui";

import { ScanPanel } from "./scan-panel";

export const metadata = { title: "สแกนเนอร์ — NEXMIND" };

export default function ScanPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="สแกนเนอร์"
        description="หุ้นใน S&P 500 ที่วันนี้มีเรื่องเกิดขึ้น เรียงตามความคึกคัก กดสแกนเมื่อต้องการดูเท่านั้น"
      />
      <ScanPanel />
    </div>
  );
}
