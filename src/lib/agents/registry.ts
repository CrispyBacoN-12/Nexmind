// The NEXMIND guild — the 20+ agents shown in the Roster and Team Graph.
// `reportsTo` (codename) defines the org tree; `modelTier` picks the Claude model.

import type { ModelTier } from "@/lib/anthropic";

export type Team =
  | "HQ"
  | "Dev"
  | "Design"
  | "Content"
  | "Intelligence"
  | "Trading"
  | "Finance"
  | "Systems";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface AgentDef {
  codename: string;
  name: string;
  role: string;
  team: Team;
  rarity: Rarity;
  modelTier: ModelTier;
  emoji: string;
  title?: string;
  motto?: string;
  artifact?: string;
  skills: string[];
  reportsTo?: string;
}

export const AGENTS: AgentDef[] = [
  // ---- HQ ----
  { codename: "TAEC", name: "Taec", role: "Founder & CEO", team: "HQ", rarity: "legendary", modelTier: "opus", emoji: "👑", title: "Command", motto: "Vision over noise.", skills: ["Strategy", "Command"] },
  { codename: "ARIA", name: "Aria", role: "Grand Secretary", team: "HQ", rarity: "legendary", modelTier: "opus", emoji: "🗝️", title: "Orchestrator", motto: "Every order, the right hands.", artifact: "routing sigil", skills: ["Routing", "Planning", "Summary"], reportsTo: "TAEC" },

  // ---- Dev ----
  { codename: "REX", name: "Rex", role: "Tech Architect", team: "Dev", rarity: "epic", modelTier: "sonnet", emoji: "🧱", motto: "Foundations first.", skills: ["Architecture", "Systems Design"], reportsTo: "ARIA" },
  { codename: "NOVA", name: "Nova", role: "Frontend Dev", team: "Dev", rarity: "rare", modelTier: "sonnet", emoji: "💻", skills: ["React", "Next.js", "UI"], reportsTo: "REX" },
  { codename: "BYTE", name: "Byte", role: "Backend Dev", team: "Dev", rarity: "rare", modelTier: "sonnet", emoji: "⚙️", skills: ["API", "Database", "Node"], reportsTo: "REX" },
  { codename: "ZETA", name: "Zeta", role: "QA Engineer", team: "Dev", rarity: "common", modelTier: "haiku", emoji: "🧪", skills: ["Testing", "QA"], reportsTo: "BYTE" },
  { codename: "FORGE", name: "Forge", role: "DevOps", team: "Dev", rarity: "rare", modelTier: "haiku", emoji: "🔧", skills: ["CI/CD", "Infra"], reportsTo: "ZETA" },

  // ---- Design ----
  { codename: "LUNA", name: "Luna", role: "UX/UI Designer", team: "Design", rarity: "epic", modelTier: "sonnet", emoji: "🌙", motto: "Clarity is kindness.", skills: ["UX", "UI", "Wireframe"], reportsTo: "ARIA" },
  { codename: "PIXEL", name: "Pixel", role: "Visual Design", team: "Design", rarity: "rare", modelTier: "sonnet", emoji: "🎨", skills: ["Visual", "Branding"], reportsTo: "LUNA" },
  { codename: "REEL", name: "Reel", role: "Video Producer", team: "Design", rarity: "common", modelTier: "haiku", emoji: "🎬", skills: ["Video", "Motion"], reportsTo: "PIXEL" },

  // ---- Content / Intelligence ----
  { codename: "SCOUT", name: "Scout", role: "Research Lead", team: "Intelligence", rarity: "epic", modelTier: "sonnet", emoji: "🛰️", motto: "Know before it moves.", artifact: "recon lens", skills: ["Research", "News", "Synthesis"], reportsTo: "ARIA" },
  { codename: "INK", name: "Ink", role: "Content Writer", team: "Content", rarity: "rare", modelTier: "sonnet", emoji: "🖋️", skills: ["Writing", "Copy"], reportsTo: "SCOUT" },
  { codename: "GRACE", name: "Grace", role: "Editor", team: "Content", rarity: "rare", modelTier: "haiku", emoji: "📝", skills: ["Editing", "Style"], reportsTo: "INK" },
  { codename: "VIBE", name: "Vibe", role: "Social Media", team: "Content", rarity: "common", modelTier: "haiku", emoji: "📣", skills: ["Social", "Trends"], reportsTo: "GRACE" },
  { codename: "ATLAS", name: "Atlas", role: "Data Analyst", team: "Intelligence", rarity: "epic", modelTier: "sonnet", emoji: "🗺️", skills: ["Data", "Stats"], reportsTo: "ARIA" },
  { codename: "MEMO", name: "Memo", role: "Memory Keeper", team: "Intelligence", rarity: "rare", modelTier: "haiku", emoji: "🧠", skills: ["Memory", "Lessons"], reportsTo: "ATLAS" },
  { codename: "CIPHER", name: "Cipher", role: "Competitive Intel", team: "Intelligence", rarity: "rare", modelTier: "haiku", emoji: "🔍", skills: ["Competitive", "OSINT"], reportsTo: "MEMO" },

  // ---- Trading ----
  { codename: "SCANNER", name: "Scanner", role: "Market Watcher", team: "Trading", rarity: "rare", modelTier: "haiku", emoji: "📡", motto: "Scans every 20s. Wakes the team only on a setup.", artifact: "indicator array", skills: ["Indicators", "Scan", "No-AI"], reportsTo: "HAWK" },
  { codename: "HAWK", name: "Hawk", role: "Market Intel", team: "Trading", rarity: "epic", modelTier: "sonnet", title: "Sky Prophet", emoji: "🦅", motto: "Three eyes, one verdict.", artifact: "gold-market spear", skills: ["Technical Analysis", "Signals", "Voting"], reportsTo: "ARIA" },
  { codename: "BLADE", name: "Blade", role: "Trade Executor", team: "Trading", rarity: "rare", modelTier: "haiku", title: "Steel Executor", emoji: "⚔️", motto: "Enter clean, exit by plan.", artifact: "candlewick katana", skills: ["Execution", "Position Sizing"], reportsTo: "HAWK" },
  { codename: "SAGE", name: "Sage", role: "Risk Manager", team: "Trading", rarity: "epic", modelTier: "opus", title: "Balance Keeper", emoji: "🛡️", motto: "The veto that saves the account.", artifact: "risk scale shield", skills: ["Risk Management", "Drawdown", "Veto"], reportsTo: "HAWK" },
  { codename: "AUTO", name: "Auto", role: "Algo Bot", team: "Trading", rarity: "rare", modelTier: "haiku", title: "Eternal Machine", emoji: "🤖", motto: "Rules without emotion.", artifact: "teal cron rings", skills: ["Automation", "Backtest"], reportsTo: "SAGE" },

  // ---- Finance ----
  { codename: "COIN", name: "Coin", role: "Finance Lead", team: "Finance", rarity: "epic", modelTier: "sonnet", emoji: "💰", skills: ["Finance", "Budget"], reportsTo: "ARIA" },
  { codename: "DEAL", name: "Deal", role: "Sales", team: "Finance", rarity: "common", modelTier: "haiku", emoji: "🤝", skills: ["Sales", "Outreach"], reportsTo: "COIN" },
  { codename: "BOOST", name: "Boost", role: "Ads Manager", team: "Finance", rarity: "common", modelTier: "haiku", emoji: "🚀", skills: ["Ads", "Growth"], reportsTo: "COIN" },

  // ---- Systems / Legal ----
  { codename: "LEX", name: "Lex", role: "Legal Advisor", team: "Systems", rarity: "epic", modelTier: "sonnet", emoji: "⚖️", skills: ["Legal", "Compliance"], reportsTo: "ARIA" },
  { codename: "NEXUS", name: "Nexus", role: "R&D Lead", team: "Systems", rarity: "rare", modelTier: "sonnet", emoji: "🔗", skills: ["R&D", "Integration"], reportsTo: "LEX" },
  { codename: "ECHO", name: "Echo", role: "Voice Interface", team: "Systems", rarity: "common", modelTier: "haiku", emoji: "🔊", skills: ["Voice", "TTS"], reportsTo: "NEXUS" },
];

/** Look up an agent definition by codename. */
export function agentByCodename(codename: string): AgentDef | undefined {
  return AGENTS.find((a) => a.codename === codename.toUpperCase());
}

/** Agents the Secretary can delegate work to (excludes HQ itself). */
export const DISPATCHABLE = AGENTS.filter((a) => a.team !== "HQ");
