"use client";

import { useState } from "react";

import { Badge, Button, Card, CardTitle, Stat } from "@/components/ui";
import { CHART_SMA_SLOW, type ChartBar } from "@/lib/advisor/chartSeries";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  type AdvisorCard,
  type AdvisorResult,
} from "@/lib/advisor/types";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

import { AdvisorChart } from "./advisor-chart";
import { AdvisorCritique } from "./advisor-critique";

const CAP_LABEL: Record<string, string> = {
  risk: "RISK BUDGET",
  affordability: "AFFORDABILITY",
};

/**
 * The route's 200 body: the AdviceResult with the chart bars beside it.
 *
 * `chart` sits OUTSIDE the card because `advise` is pure and knows nothing
 * about drawing. It is optional and nullable on purpose — the history pull for
 * the chart fails soft, and a card with no picture is still a whole card.
 */
type AdvisorResponse = AdvisorResult & { chart?: ChartBar[] | null };

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
  const [chart, setChart] = useState<ChartBar[] | null>(null);
  /** Set when the entry field was filled by clicking a candle, cleared on submit. */
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  // Bumped by any keystroke in the form. Used as AdvisorCritique's key, so an
  // edit unmounts a critique that was argued against numbers that no longer
  // match the card. React's onChange bubbles, so one handler covers every field.
  const [formEpoch, setFormEpoch] = useState(0);

  /**
   * A clicked candle fills the Entry field and stops there.
   *
   * It deliberately does NOT re-submit: recharts fires onClick for any click
   * inside the plot area, and a request per stray click would be both a fetch
   * storm and a card that changes under the owner without them asking. The
   * note below the field is what makes the click visible instead.
   */
  function pickEntry(price: number, date: string) {
    setEntry(price.toFixed(2));
    setPickedFrom(date);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCard(null);
    setChart(null);
    setPickedFrom(null);
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
      const json = (await res.json().catch(() => null)) as AdvisorResponse | null;
      if (json && json.ok) {
        setCard(json.card);
        setChart(json.chart ?? null);
      } else if (json && !json.ok) setError(json.error);
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
        <form
          onSubmit={onSubmit}
          onChange={() => setFormEpoch((n) => n + 1)}
          className="grid gap-4 sm:grid-cols-3"
        >
          {/* Changing the ticker clears the entry.
              An entry typed — or clicked off a candle — for one name is a
              price in that name's range, and carrying it into another turns
              the card into an override nobody asked for: the entry level and
              the whole R ladder float away from the price action, and the
              chart stops showing the latest price as the entry. Blank means
              "use this ticker's last close", which is the right default for a
              ticker whose price has not been read yet. */}
          <Field
            label="Ticker"
            value={ticker}
            onChange={(v) => {
              if (v !== ticker) {
                setEntry("");
                setPickedFrom(null);
              }
              setTicker(v);
            }}
            placeholder="AAPL"
            required
          />
          <div>
            <Field
              label="Entry (blank = last close)"
              value={entry}
              onChange={(v) => {
                setEntry(v);
                setPickedFrom(null);
              }}
              placeholder="180.00"
            />
            {pickedFrom ? (
              <p className="mt-1 text-xs text-(--color-accent)">
                Taken from the {pickedFrom} candle. Read the structure again to size it.
              </p>
            ) : null}
          </div>
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
        <Card className="p-5 border-rose-500/40">
          <CardTitle className="text-rose-400">Nothing to show</CardTitle>
          <p className="text-sm mt-2">{error}</p>
        </Card>
      ) : null}

      {card ? (
        <ResultCard card={card} chart={chart} onPickEntry={pickEntry} critiqueKey={formEpoch} />
      ) : null}
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

function ResultCard({
  card,
  chart,
  onPickEntry,
  critiqueKey,
}: {
  card: AdvisorCard;
  chart: ChartBar[] | null;
  onPickEntry: (price: number, date: string) => void;
  /** Changes on any form edit; remounting AdvisorCritique is how it clears. */
  critiqueKey: number;
}) {
  return (
    <div className="space-y-4">
      {/* The already-held banner stays above the chart: it changes how every
          number AND every line below it should be read, so it cannot sit
          420px further down where it can be scrolled past. */}
      {card.alreadyHeld ? (
        <Card className="p-4 border-amber-500/40">
          <p className="text-sm">
            <Badge tone="warning">ALREADY HELD</Badge>{" "}
            You listed {card.ticker} among your current holdings. Everything below sizes a NEW position on top of it.
          </p>
        </Card>
      ) : null}

      {chart && chart.length > 0 ? (
        <Card className="p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <CardTitle>
              {card.ticker} · six months, with the levels on it
            </CardTitle>
            <span className="text-xs text-(--color-muted) font-mono">
              SMA{CHART_SMA_SLOW} computed over two years
            </span>
          </div>
          <AdvisorChart bars={chart} card={card} onPickEntry={onPickEntry} />
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
        <Card className="p-5 space-y-2 border-amber-500/40">
          <CardTitle>What went wrong but did not stop the card</CardTitle>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {card.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <AdvisorCritique key={critiqueKey} card={card} chart={chart} />

      <p className="text-xs text-(--color-muted) border-l-2 border-(--color-border) pl-4">{card.noEdgeClaim}</p>
    </div>
  );
}
