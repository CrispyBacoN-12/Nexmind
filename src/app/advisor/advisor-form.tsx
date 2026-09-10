"use client";

import { useState } from "react";

import { Badge, Button, Card, CardTitle, Stat } from "@/components/ui";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  type AdvisorCard,
  type AdvisorResult,
} from "@/lib/advisor/types";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

const CAP_LABEL: Record<string, string> = {
  risk: "RISK BUDGET",
  affordability: "AFFORDABILITY",
};

export function AdvisorForm() {
  const [ticker, setTicker] = useState("");
  const [entry, setEntry] = useState("");
  const [capital, setCapital] = useState("2500");
  const [maxSlots, setMaxSlots] = useState("5");
  const [riskPct, setRiskPct] = useState("1");
  const [holdings, setHoldings] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<AdvisorCard | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCard(null);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          entry,
          capital,
          maxSlots,
          riskPct,
          holdings: holdings.split(/[\s,]+/).filter(Boolean),
        }),
      });
      // res.ok is not enough on its own and neither is res.json(): an error
      // body that is not this route's JSON (a proxy 502 page, say) would
      // otherwise surface to the owner as a JSON parse error.
      const json = (await res.json().catch(() => null)) as AdvisorResult | null;
      if (json && json.ok) setCard(json.card);
      else if (json && !json.ok) setError(json.error);
      else setError(`The server answered HTTP ${res.status} with a response this page could not read.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
          <Field label="Ticker" value={ticker} onChange={setTicker} placeholder="AAPL" required />
          <Field label="Entry (blank = last close)" value={entry} onChange={setEntry} placeholder="180.00" />
          <Field label="Capital ($)" value={capital} onChange={setCapital} />
          <Field label="Max slots" value={maxSlots} onChange={setMaxSlots} />
          <Field label="Risk per trade (%)" value={riskPct} onChange={setRiskPct} />
          <Field
            label="Currently holding (comma separated)"
            value={holdings}
            onChange={setHoldings}
            placeholder="MSFT, NVDA"
          />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Reading…" : "Read the structure"}
            </Button>
          </div>
        </form>
      </Card>

      {error ? (
        <Card className="p-5 border-(--color-negative)/40">
          <CardTitle className="text-(--color-negative)">Nothing to show</CardTitle>
          <p className="text-sm mt-2">{error}</p>
        </Card>
      ) : null}

      {card ? <ResultCard card={card} /> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs text-(--color-muted) space-y-1">
      <span>{label}</span>
      <input
        className="w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)"
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ResultCard({ card }: { card: AdvisorCard }) {
  return (
    <div className="space-y-4">
      {card.alreadyHeld ? (
        <Card className="p-4 border-(--color-warning)/40">
          <p className="text-sm">
            <Badge tone="warning">ALREADY HELD</Badge>{" "}
            You listed {card.ticker} among your current holdings. Everything below sizes a NEW position on top of it.
          </p>
        </Card>
      ) : null}

      {/* Stat already renders its own Card, so these grids are NOT wrapped in one. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {card.ticker} · {fmtMoney(card.lastClose)}
          </h2>
          <span className="text-xs text-(--color-muted) font-mono">as of {card.asOf}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Entry" value={fmtMoney(card.entry)} sub={card.entrySource} />
          <Stat
            label={`Stop (${ADVISOR_ATR_SL_MULT} x ATR)`}
            value={fmtMoney(card.stop)}
            sub={`${fmtMoney(card.slDistance)} away`}
          />
          <Stat label={`ATR(${ADVISOR_ATR_PERIOD})`} value={fmtMoney(card.atr)} />
          <Stat
            label="Cost of the round trip"
            value={`${fmtNumber(card.costR, 3)} R`}
            sub={`${ADVISOR_COST_BPS}bps assumption`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Size</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Shares" value={fmtNumber(card.sizing.shares, 0)} />
          <Stat
            label="Capital deployed"
            value={fmtMoney(card.deployedUsd)}
            sub={`slot budget ${fmtMoney(card.sizing.slotBudget)}`}
          />
          <Stat
            label="Real risk"
            value={fmtMoney(card.sizing.actualRiskUsd)}
            sub={`${fmtPct(card.sizing.actualRiskPct)} of capital`}
          />
          <Stat label="Bound by" value={card.sizing.boundBy.map((b) => CAP_LABEL[b] ?? b).join(" + ") || "—"} />
        </div>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-(--color-muted)">{card.sizing.reason}</p>
          <p className="text-sm text-(--color-muted)">
            With the desk&apos;s correlation rule (multiplier {fmtNumber(card.corrMultiplier, 2)}):{" "}
            {fmtNumber(card.corrAdjustedShares, 0)} share(s). Reported, not applied — the number above is unadjusted.
          </p>
        </Card>
      </section>

      <Card className="p-5 space-y-3">
        <CardTitle>R ladder</CardTitle>
        <p className="text-xs text-(--color-muted)">
          The tool does not pick a target. Three exit geometries in this project disagree, and none survived a deep
          hold-out.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-muted) text-left">
              <tr>
                <th className="py-1 pr-4">R</th>
                <th className="py-1 pr-4">Price</th>
                <th className="py-1 pr-4">Gain</th>
                <th className="py-1">P/L on {fmtNumber(card.sizing.shares, 0)} share(s)</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {card.ladder.map((row) => (
                <tr key={row.r} className="border-t border-(--color-border)">
                  <td className="py-1 pr-4">{fmtNumber(row.r, 1)}R</td>
                  <td className="py-1 pr-4">{fmtMoney(row.price)}</td>
                  <td className="py-1 pr-4">{fmtPct(row.gainPct)}</td>
                  <td className="py-1">{fmtMoney(row.plUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Slots and market state</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Free slots"
            value={fmtNumber(card.freeSlots, 0)}
            sub={
              card.alreadyHeld
                ? `${card.ticker} already holds one of your slots`
                : `${card.ticker} would be one of them`
            }
          />
          <Stat
            label="Gate"
            value={card.gate.benchAbove == null ? "BLIND" : card.gate.benchAbove ? "ABOVE TREND" : "BELOW TREND"}
            sub={`${fmtNumber(card.gate.slots, 0)} slot(s) permitted`}
          />
          <Stat
            label="Avg correlation to holdings"
            value={card.avgCorrelation == null ? "—" : fmtNumber(card.avgCorrelation, 2)}
          />
        </div>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-(--color-muted)">{card.gate.note}</p>
          <p className="text-xs text-(--color-muted)">
            This is information. The tool blocks nothing — the decision is yours.
          </p>
          {card.correlations.length > 0 ? (
            <ul className="text-sm space-y-1">
              {card.correlations.map((c) => (
                <li key={c.ticker} className="font-mono">
                  {c.ticker}: {c.correlation == null ? `unknown (${c.note})` : fmtNumber(c.correlation, 2)}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>

      {card.warnings.length > 0 ? (
        <Card className="p-5 space-y-2 border-(--color-warning)/40">
          <CardTitle>What went wrong but did not stop the card</CardTitle>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {card.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-(--color-muted) border-l-2 border-(--color-border) pl-4">{card.noEdgeClaim}</p>
    </div>
  );
}
