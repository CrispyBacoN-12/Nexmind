// Number formatting for /scorecard. Pure; safe to import from server and client.
//
// GroupStats.winPct and .t1Pct are FRACTIONS (0..1), not percent units, so they are
// not passed through utils.fmtPct (which divides by 100).

const MINUS = "−";

/** "+0.06R" / "−0.11R"; "—" for null or non-finite. */
export function fmtR(r: number | null | undefined, digits = 2): string {
  if (r == null || !Number.isFinite(r)) return "—";
  const s = Math.abs(r).toFixed(digits);
  if (Number(s) === 0) return `${s}R`;
  return `${r < 0 ? MINUS : "+"}${s}R`;
}

/** A 0..1 fraction as "41%". */
export function fmtFraction(f: number | null | undefined): string {
  if (f == null || !Number.isFinite(f)) return "—";
  return `${(f * 100).toFixed(0)}%`;
}

/** Text colour class for a mean R. */
export function rTone(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r) || r === 0) return "text-(--color-muted)";
  return r > 0 ? "text-emerald-400" : "text-rose-400";
}
