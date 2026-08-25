import "dotenv/config";
// Every row whose status reads "approved", regardless of how it was validated.
// That is a wider set than the set the desk can actually trade: only panel-v1
// rows are activatable (adapter.getResearchStrategy), so the validation tag is
// printed on every line rather than left implicit — an "approved" legacy row
// looked identical to a survivor here. For the desk-eligible set with its
// held-out numbers, use scripts/list-survivors.mts.
import { prisma } from "../src/lib/db";
import { PANEL_VALIDATION } from "../src/lib/research/panel";

async function main() {
  const rows = await prisma.researchStrategy.findMany({
    where: { status: "approved" },
    orderBy: { id: "asc" },
    select: { id: true, label: true, validation: true },
  });
  for (const r of rows) {
    const ok = r.validation === PANEL_VALIDATION;
    console.log(`research-${r.id}\t${ok ? "DESK-ELIGIBLE" : "not eligible"}\t${r.validation}\t${r.label}`);
  }
  const eligible = rows.filter((r) => r.validation === PANEL_VALIDATION).length;
  console.log(`\n${rows.length} approved — ${eligible} desk-eligible (${PANEL_VALIDATION}), ${rows.length - eligible} legacy`);
  await prisma.$disconnect();
}
main();
