// Seeds the guild roster + a little demo trading data so the War Room renders
// without an API key. Run with `npm run db:seed`.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { AGENTS } from "../src/lib/agents/registry";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (Postgres connection string)");
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ---- Agents ----
  for (let i = 0; i < AGENTS.length; i++) {
    const a = AGENTS[i];
    await prisma.agent.upsert({
      where: { codename: a.codename },
      update: {
        name: a.name, role: a.role, team: a.team, rarity: a.rarity,
        modelTier: a.modelTier, emoji: a.emoji, title: a.title, motto: a.motto,
        artifact: a.artifact, skills: JSON.stringify(a.skills), reportsTo: a.reportsTo, sort: i,
      },
      create: {
        codename: a.codename, name: a.name, role: a.role, team: a.team, rarity: a.rarity,
        modelTier: a.modelTier, emoji: a.emoji, title: a.title, motto: a.motto,
        artifact: a.artifact, skills: JSON.stringify(a.skills), reportsTo: a.reportsTo, sort: i,
        status: a.team === "Trading" || a.codename === "ARIA" ? "online" : "idle",
      },
    });
  }

  // ---- Demo news (SCOUT output) ----
  const news = [
    { source: "Yahoo", title: "DXY slips as yields cool", sentiment: "bullish", symbol: "XAUUSD", summary: "Dollar weakness supports gold into the US session." },
    { source: "Binance", title: "Funding flips negative on majors", sentiment: "bullish", symbol: "BTCUSDT", summary: "Crowded shorts; squeeze risk to the upside." },
    { source: "FearGreed", title: "Sentiment at 38 (Fear)", sentiment: "neutral", summary: "Market mood cautious — favor quality setups only." },
  ];
  await prisma.newsItem.deleteMany();
  for (const n of news) await prisma.newsItem.create({ data: n });

  // ---- Default portfolio (all demo trades/watchlist belong to it) ----
  const defaultPortfolio =
    (await prisma.portfolio.findFirst({ where: { name: "Default" }, orderBy: { id: "asc" } })) ??
    (await prisma.portfolio.create({ data: { name: "Default", kind: "swing", sort: 0 } }));

  // ---- Demo trades with full decision trail ----
  await prisma.trade.deleteMany();
  await prisma.signal.deleteMany();

  const demoTrades = [
    {
      symbol: "GC=F", side: "long", entry: 2348.5, sl: 2342.0, tp1: 2358.0, tp2: 2368.0, lot: 0.1,
      riskReward: 2.1, status: "closed", outcome: "win", pnl: 95.0, rMultiple: 1.5, ironRulesPassed: true,
      sageVerdict: "approve — R:R 2.1 acceptable, SL below H1 swing",
      hawkVotes: [
        { persona: "trend", vote: "long", reason: "H1 uptrend, price above 50EMA" },
        { persona: "structure", vote: "long", reason: "higher-low held at 2342" },
        { persona: "counter", vote: "skip", reason: "RSI nearing 65" },
      ],
      decisionLog: [
        { stage: "scanner", note: "MA cross + ADX 27 setup" },
        { stage: "hawk", note: "vote 2/3 long" },
        { stage: "sage", note: "approved, SL tightened" },
        { stage: "ironRules", note: "R:R ok, spread ok, daily loss ok" },
        { stage: "exec", note: "filled 2348.5, TP1 hit, runner closed +95" },
      ],
    },
    {
      symbol: "BTC-USD", side: "short", entry: 64200, sl: 64950, tp1: 62900, tp2: null, lot: 0.05,
      riskReward: 1.7, status: "open", outcome: null, pnl: null, rMultiple: null, ironRulesPassed: true,
      sageVerdict: "approve — reduced size, news risk",
      hawkVotes: [
        { persona: "trend", vote: "short", reason: "lower-highs on H1" },
        { persona: "structure", vote: "short", reason: "rejection at supply 64.9k" },
        { persona: "counter", vote: "short", reason: "funding negative, squeeze faded" },
      ],
      decisionLog: [
        { stage: "scanner", note: "MACD bear cross" },
        { stage: "hawk", note: "vote 3/3 short" },
        { stage: "sage", note: "approved with half size" },
        { stage: "ironRules", note: "all gates passed" },
        { stage: "exec", note: "filled 64200, managing" },
      ],
    },
  ];

  for (const t of demoTrades) {
    await prisma.trade.create({
      data: {
        portfolioId: defaultPortfolio.id,
        symbol: t.symbol, side: t.side, entry: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2 ?? undefined,
        lot: t.lot, riskReward: t.riskReward, status: t.status, outcome: t.outcome ?? undefined,
        pnl: t.pnl ?? undefined, rMultiple: t.rMultiple ?? undefined, ironRulesPassed: t.ironRulesPassed,
        sageVerdict: t.sageVerdict, hawkVotes: JSON.stringify(t.hawkVotes),
        decisionLog: JSON.stringify(t.decisionLog), stagedTp: JSON.stringify({ tp1Hit: t.outcome === "win" }),
        closedAt: t.status === "closed" ? new Date() : undefined,
      },
    });
  }

  // A vetoed signal — shows SAGE's veto in the feed.
  await prisma.signal.create({
    data: {
      portfolioId: defaultPortfolio.id,
      symbol: "EURUSD=X", side: "long", price: 1.0855, atr: 0.0012, status: "vetoed",
      note: "SAGE veto: R:R 1.1 below floor; spread elevated pre-news.",
      indicators: JSON.stringify({ rsi: 58, adx: 19, macd: "flat" }),
    },
  });

  const counts = await prisma.agent.count();
  console.log(`Seeded ${counts} agents, ${news.length} news items, ${demoTrades.length} trades.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
