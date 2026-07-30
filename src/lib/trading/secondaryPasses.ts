// Desks merged into one shared book: an extra scan-all pass to run alongside
// a portfolio's own stored default (strategy/cadence), so two strategies can
// generate trades into the same capital/position pool. Plain data — safe to
// import from both server routes/scripts and client components.
// Gold Desk (#8, combo-gold/1d) + Gold Trend Desk (#13, research-30/1h, now archived)
// + research-25 (DI-Cross, no ADX filter) added as a third concurrent pass.
export interface SecondaryPass {
  portfolioId: number;
  label: string;
  strategy: string;
  interval: string;
  range: string;
}

export const SECONDARY_PASSES: SecondaryPass[] = [
  { portfolioId: 8, label: "research-30 (ex-Desk #13)", strategy: "research-30", interval: "1h", range: "3mo" },
  { portfolioId: 8, label: "research-25 (DI-Cross)", strategy: "research-25", interval: "1h", range: "3mo" },
];
