// The six pre-trade gates. Pure and deterministic: same input, same output.
//
// A gate whose input is missing or stale FAILS at WARN rather than passing —
// "we could not check" must never read as "checked and fine". In /advisor the
// owner can still proceed by writing a reason; the simulator (strictMode)
// cannot.

import {
  DEFAULT_PORTFOLIO_CONFIG,
  GATE_ORDER,
  type CandidateTrade,
  type GateCheckResult,
  type GateName,
  type GateSeverity,
  type NavPoint,
  type PortfolioConfig,
  type PortfolioEvaluationInput,
  type PortfolioEvaluationOutput,
  type PortfolioSlot,
} from "./types";

const DAY_MS = 86_400_000;

/** Dollars lost if the stop fills at the stop. Zero for a stop at or above entry. */
export function riskUsd(p: { shares: number; entry: number; stop: number }): number {
  return Math.max(0, p.entry - p.stop) * Math.max(0, p.shares);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const pct = (n: number) => `${n.toFixed(1)}%`;

interface Gate {
  passed: boolean;
  severity: GateSeverity;
  currentValue: number | string;
  threshold: number | string;
  message: string;
}

interface NavState {
  nav: number | null;
  /** Why nav is null. */
  unknownReason: string | null;
  dailyDropPct: number | null;
  peakDrawdownPct: number | null;
}

/** Latest NAV, its drop from the previous log entry, and its drawdown from the high-water mark. */
export function readNav(history: NavPoint[], today: string, staleDays: number): NavState {
  const usable = history
    .filter((p) => Number.isFinite(p.nav) && p.nav > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (usable.length === 0) {
    return { nav: null, unknownReason: "no NAV has been logged", dailyDropPct: null, peakDrawdownPct: null };
  }
  const last = usable[usable.length - 1];
  const age = daysBetween(last.date, today);
  if (age > staleDays) {
    return {
      nav: null,
      unknownReason: `the latest NAV log is ${age} days old (${last.date})`,
      dailyDropPct: null,
      peakDrawdownPct: null,
    };
  }
  const prev = usable.length >= 2 ? usable[usable.length - 2] : null;
  const peak = Math.max(...usable.map((p) => p.nav));
  return {
    nav: last.nav,
    unknownReason: null,
    dailyDropPct: prev ? Math.max(0, ((prev.nav - last.nav) / prev.nav) * 100) : null,
    peakDrawdownPct: Math.max(0, ((peak - last.nav) / peak) * 100),
  };
}

function capacityGate(slots: PortfolioSlot[], c: CandidateTrade, cfg: PortfolioConfig): Gate {
  if (slots.some((s) => s.ticker === c.ticker)) {
    return { passed: false, severity: "CRITICAL", currentValue: slots.length, threshold: cfg.maxSlots, message: `${c.ticker} is already held` };
  }
  const passed = slots.length < cfg.maxSlots;
  return {
    passed,
    severity: passed ? "OK" : "CRITICAL",
    currentValue: slots.length,
    threshold: cfg.maxSlots,
    message: passed ? `${slots.length} of ${cfg.maxSlots} slots used` : `all ${cfg.maxSlots} slots are full`,
  };
}

function sectorGate(slots: PortfolioSlot[], c: CandidateTrade, cfg: PortfolioConfig): Gate {
  const unknownHeld = slots.filter((s) => s.sector === "Other").map((s) => s.ticker);
  if (c.sector === "Other") {
    return {
      passed: false,
      severity: "WARN",
      currentValue: "unknown",
      threshold: cfg.maxPerSector,
      message: `${c.ticker}'s sector is unknown, so the ${cfg.maxPerSector}-per-sector cap cannot be checked`,
    };
  }
  const same = slots.filter((s) => s.sector === c.sector).map((s) => s.ticker);
  const after = same.length + 1;
  const passed = after <= cfg.maxPerSector;
  const caveat = unknownHeld.length > 0 ? `; sector unknown for held ${unknownHeld.join(", ")}` : "";
  return {
    passed,
    severity: !passed ? "CRITICAL" : unknownHeld.length > 0 ? "WARN" : "OK",
    currentValue: after,
    threshold: cfg.maxPerSector,
    message: passed
      ? `${after} of ${cfg.maxPerSector} in ${c.sector}${caveat}`
      : `${c.sector} already holds ${same.join(", ")}${caveat}`,
  };
}

function correlationGate(slots: PortfolioSlot[], c: CandidateTrade, corr: Record<string, number | null>, cfg: PortfolioConfig): Gate {
  if (slots.length === 0) {
    return { passed: true, severity: "OK", currentValue: "n/a", threshold: cfg.maxCorrelation, message: "nothing held to correlate with" };
  }
  const known: Array<[string, number]> = [];
  const unknown: string[] = [];
  for (const s of slots) {
    const r = corr[s.ticker];
    if (r == null || !Number.isFinite(r)) unknown.push(s.ticker);
    else known.push([s.ticker, r]);
  }
  const over = known.filter(([, r]) => r > cfg.maxCorrelation);
  const max = known.length > 0 ? Math.max(...known.map(([, r]) => r)) : null;
  const currentValue = max == null ? "unknown" : Number(max.toFixed(2));
  if (over.length > 0) {
    return {
      passed: false,
      severity: "CRITICAL",
      currentValue,
      threshold: cfg.maxCorrelation,
      message: `excessive co-movement with ${over.map(([t, r]) => `${t} (${r.toFixed(2)})`).join(", ")}`,
    };
  }
  if (unknown.length > 0) {
    return {
      passed: false,
      severity: "WARN",
      currentValue,
      threshold: cfg.maxCorrelation,
      message: `correlation with ${unknown.join(", ")} could not be measured`,
    };
  }
  return { passed: true, severity: "OK", currentValue, threshold: cfg.maxCorrelation, message: `highest correlation ${max!.toFixed(2)}` };
}

function regimeGate(slots: PortfolioSlot[], regime: PortfolioEvaluationInput["regime"], cfg: PortfolioConfig): Gate {
  if (regime == null || !(regime.spyClose > 0) || !(regime.spySma200 > 0)) {
    return {
      passed: false,
      severity: "WARN",
      currentValue: "unknown",
      threshold: cfg.riskOffMaxSlots,
      message: "SPY vs its SMA200 could not be read",
    };
  }
  const below = regime.spyClose < regime.spySma200;
  const cap = below ? cfg.riskOffMaxSlots : cfg.maxSlots;
  const passed = slots.length < cap;
  const where = below ? "below" : "above";
  return {
    passed,
    severity: passed ? "OK" : "CRITICAL",
    currentValue: slots.length,
    threshold: cap,
    message: passed
      ? `SPY is ${where} its SMA200; cap ${cap} slots`
      : `SPY is ${where} its SMA200, which caps the book at ${cap} positions; ${slots.length} are open`,
  };
}

function drawdownGate(nav: NavState, cfg: PortfolioConfig): { gate: Gate; sizeMultiplier: number } {
  if (nav.nav == null) {
    return {
      gate: { passed: false, severity: "WARN", currentValue: "unknown", threshold: cfg.drawdownSafeModePct, message: `drawdown unknown: ${nav.unknownReason}` },
      sizeMultiplier: 1,
    };
  }
  const dd = nav.peakDrawdownPct ?? 0;
  if (dd >= cfg.drawdownSafeModePct) {
    return {
      gate: { passed: false, severity: "CRITICAL", currentValue: Number(dd.toFixed(2)), threshold: cfg.drawdownSafeModePct, message: `safe mode: ${pct(dd)} below the NAV high-water mark` },
      sizeMultiplier: 0.5,
    };
  }
  const sizeMultiplier = dd >= cfg.drawdownHalfSizePct ? 0.5 : 1;
  if (nav.dailyDropPct != null && nav.dailyDropPct >= cfg.dailyDrawdownStopPct) {
    return {
      gate: {
        passed: false,
        severity: "CRITICAL",
        currentValue: Number(nav.dailyDropPct.toFixed(2)),
        threshold: cfg.dailyDrawdownStopPct,
        message: `NAV fell ${pct(nav.dailyDropPct)} since the previous log: no new trades today`,
      },
      sizeMultiplier,
    };
  }
  const halfNote = sizeMultiplier < 1 ? `; size halved (past ${cfg.drawdownHalfSizePct}%)` : "";
  return {
    gate: {
      passed: true,
      severity: sizeMultiplier < 1 ? "WARN" : "OK",
      currentValue: Number(dd.toFixed(2)),
      threshold: cfg.drawdownSafeModePct,
      message: `${pct(dd)} below the high-water mark${halfNote}`,
    },
    sizeMultiplier,
  };
}

interface Heat {
  nominalPct: number | null;
  nominalPctAfter: number | null;
  gapPctAfter: number | null;
  unmeasured: string[];
}

function heat(slots: PortfolioSlot[], c: CandidateTrade, shares: number, nav: number | null): Heat {
  const positions = [...slots, { ...c, shares }];
  const unmeasured = positions.filter((p) => p.worstLossR == null || !Number.isFinite(p.worstLossR)).map((p) => p.ticker);
  if (nav == null) return { nominalPct: null, nominalPctAfter: null, gapPctAfter: null, unmeasured };
  const held = slots.reduce((a, s) => a + riskUsd(s), 0);
  const cand = riskUsd({ shares, entry: c.entry, stop: c.stop });
  const gap = positions.reduce((a, p) => a + riskUsd(p) * (p.worstLossR != null && Number.isFinite(p.worstLossR) ? p.worstLossR : 1), 0);
  return {
    nominalPct: (held / nav) * 100,
    nominalPctAfter: ((held + cand) / nav) * 100,
    gapPctAfter: (gap / nav) * 100,
    unmeasured,
  };
}

function gapHeatGate(h: Heat, navReason: string | null, cfg: PortfolioConfig): Gate {
  if (h.gapPctAfter == null) {
    return { passed: false, severity: "WARN", currentValue: "unknown", threshold: cfg.maxGapHeatPct, message: `tail heat unknown: ${navReason}` };
  }
  const passed = h.gapPctAfter <= cfg.maxGapHeatPct;
  const lowerBound = h.unmeasured.length > 0 ? ` (a lower bound: ${h.unmeasured.join(", ")} counted at 1R, gap not measured)` : "";
  return {
    passed,
    severity: !passed ? "CRITICAL" : h.unmeasured.length > 0 ? "WARN" : "OK",
    currentValue: Number(h.gapPctAfter.toFixed(2)),
    threshold: cfg.maxGapHeatPct,
    message: passed
      ? `worst-gap heat ${pct(h.gapPctAfter)} of NAV${lowerBound}`
      : `extreme tail-risk heat: ${pct(h.gapPctAfter)} of NAV if every name repeated its worst gap${lowerBound}`,
  };
}

export function evaluatePortfolio(input: PortfolioEvaluationInput): PortfolioEvaluationOutput {
  const cfg: PortfolioConfig = { ...DEFAULT_PORTFOLIO_CONFIG, ...input.config };
  const { slots, candidate: c } = input;

  const nav = readNav(input.navHistory, input.today, cfg.navStaleDays);
  const dd = drawdownGate(nav, cfg);
  const suggestedShares = Math.max(0, Math.floor(c.baseShares * dd.sizeMultiplier));
  const h = heat(slots, c, suggestedShares, nav.nav);

  const raw: Record<GateName, Gate> = {
    CAPACITY: capacityGate(slots, c, cfg),
    SECTOR: sectorGate(slots, c, cfg),
    CORRELATION: correlationGate(slots, c, input.correlations, cfg),
    REGIME: regimeGate(slots, input.regime, cfg),
    DRAWDOWN: dd.gate,
    GAP_HEAT: gapHeatGate(h, nav.unknownReason, cfg),
  };

  const gates: GateCheckResult[] = GATE_ORDER.map((name) => {
    const g = raw[name];
    const reason = input.overrides?.[name]?.trim() ?? "";
    return { gate: name, ...g, overridden: !g.passed && !input.strictMode && reason !== "" };
  });
  const blockedBy = gates.filter((g) => !g.passed && !g.overridden).map((g) => g.gate);

  const toR = (p: number | null) => (p == null ? null : p / cfg.riskPctPerTrade);
  return {
    canExecute: blockedBy.length === 0 && suggestedShares > 0,
    gates,
    blockedBy,
    nav: nav.nav,
    sizeMultiplier: dd.sizeMultiplier,
    suggestedShares,
    nominalHeatPct: h.nominalPct,
    nominalHeatPctAfter: h.nominalPctAfter,
    nominalHeatRAfter: toR(h.nominalPctAfter),
    tailRiskGapHeatPctAfter: h.gapPctAfter,
    tailRiskGapHeatRAfter: toR(h.gapPctAfter),
    gapUnmeasured: h.unmeasured,
  };
}
