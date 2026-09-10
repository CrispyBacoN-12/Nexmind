import { PageHeader } from "@/components/ui";
import { ADVISOR_NO_EDGE_CLAIM } from "@/lib/advisor/types";

import { AdvisorForm } from "./advisor-form";

export const metadata = { title: "Trade Advisor — NEXMIND" };

export default function AdvisorPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Advisor"
        description="Name a ticker. Get its structure, its risk, and what one slot of your capital can actually buy."
      />
      <p className="text-sm text-(--color-muted) max-w-2xl border-l-2 border-(--color-border) pl-4">
        {ADVISOR_NO_EDGE_CLAIM}
      </p>
      <AdvisorForm />
    </div>
  );
}
