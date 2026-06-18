// The Secretary (ARIA) pipeline: take a free-text command, plan an ordered set
// of steps across the right agents, run each, then summarize back to the user.

import { prisma } from "@/lib/db";
import { callAgent, callAgentJSON, aiEnabled } from "@/lib/anthropic";
import { agentByCodename, DISPATCHABLE, type AgentDef } from "@/lib/agents/registry";

export interface PlannedStep { agent: string; task: string }

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { agent: { type: "string" }, task: { type: "string" } },
        required: ["agent", "task"],
      },
    },
  },
  required: ["steps"],
};

function rosterBlurb(): string {
  return DISPATCHABLE.map((a) => `${a.codename} (${a.team}, ${a.role}): ${a.skills.join("/")}`).join("\n");
}

/** Ask ARIA to break the command into ordered {agent, task} steps. */
async function planSteps(command: string): Promise<{ steps: PlannedStep[]; costUsd: number }> {
  if (!aiEnabled()) return { steps: mockPlan(command), costUsd: 0 };

  const r = await callAgentJSON<{ steps: PlannedStep[] }>({
    tier: "opus",
    system:
      "You are ARIA, the Grand Secretary of an AI guild. Given the user's command, produce an ordered " +
      "pipeline of 1–4 steps, each assigned to the single best-suited agent by codename. Pick agents only " +
      "from the roster. Order matters (e.g. design before frontend). Keep each task instruction one sentence.\n\n" +
      `ROSTER:\n${rosterBlurb()}`,
    prompt: `Command: "${command}"\nReturn JSON {steps:[{agent, task}]}.`,
    maxTokens: 600,
    jsonSchema: PLAN_SCHEMA,
  });
  const steps = r.data.steps.filter((s) => agentByCodename(s.agent)).slice(0, 4);
  return { steps: steps.length ? steps : mockPlan(command), costUsd: r.costUsd };
}

/** Run one agent step. */
async function runStep(agent: AgentDef, task: string, context: string): Promise<{ output: string; costUsd: number; model: string }> {
  if (!aiEnabled()) {
    return { output: `[mock] ${agent.codename} completed: ${task}`, costUsd: 0, model: "mock" };
  }
  const r = await callAgent({
    tier: agent.modelTier,
    system: `You are ${agent.codename} (${agent.name}), ${agent.role} on the ${agent.team} team.${agent.motto ? " Motto: " + agent.motto : ""} Execute the task concisely and concretely; output only your work product.`,
    prompt: context ? `${task}\n\nContext from earlier steps:\n${context}` : task,
    maxTokens: 1200,
  });
  return { output: r.text, costUsd: r.costUsd, model: r.model };
}

/** Full pipeline: plan → execute steps → summarize. Persists everything. */
export async function runPipeline(command: string): Promise<{ pipelineId: number }> {
  const pipeline = await prisma.pipeline.create({ data: { command, status: "running" } });

  try {
    const { steps, costUsd: planCost } = await planSteps(command);
    let totalCost = planCost;
    let context = "";

    for (let i = 0; i < steps.length; i++) {
      const def = agentByCodename(steps[i].agent);
      if (!def) continue;
      const step = await prisma.pipelineStep.create({
        data: { pipelineId: pipeline.id, order: i, agent: def.codename, task: steps[i].task, status: "running", model: def.modelTier },
      });
      try {
        const res = await runStep(def, steps[i].task, context);
        totalCost += res.costUsd;
        context += `\n[${def.codename}] ${res.output}`.slice(0, 4000);
        await prisma.pipelineStep.update({
          where: { id: step.id },
          data: { status: "done", output: res.output, costUsd: res.costUsd, model: res.model, finishedAt: new Date() },
        });
      } catch (e) {
        await prisma.pipelineStep.update({
          where: { id: step.id },
          data: { status: "failed", output: String(e), finishedAt: new Date() },
        });
      }
    }

    const summary = await summarize(command, context);
    totalCost += summary.costUsd;

    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { status: "done", summary: summary.text, costUsd: totalCost, finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.pipeline.update({ where: { id: pipeline.id }, data: { status: "failed", summary: String(e), finishedAt: new Date() } });
  }

  return { pipelineId: pipeline.id };
}

async function summarize(command: string, context: string): Promise<{ text: string; costUsd: number }> {
  if (!aiEnabled()) return { text: `[mock] ARIA summary: ran the pipeline for "${command}". All steps completed.`, costUsd: 0 };
  const r = await callAgent({
    tier: "sonnet",
    system: "You are ARIA, the Grand Secretary. Summarize what the team accomplished for the user in 3-5 sentences, plainly.",
    prompt: `User command: "${command}"\n\nWork produced:\n${context}\n\nWrite the summary.`,
    maxTokens: 500,
  });
  return { text: r.text, costUsd: r.costUsd };
}

// Keyword-based fallback so the Command Bridge works without an API key.
function mockPlan(command: string): PlannedStep[] {
  const c = command.toLowerCase();
  const steps: PlannedStep[] = [];
  if (/design|ui|ux|หน้า|สวย|dashboard|layout/.test(c)) {
    steps.push({ agent: "LUNA", task: "Design the UX/UI for the request" });
    steps.push({ agent: "NOVA", task: "Build the frontend from the design" });
  } else if (/backend|api|database|server/.test(c)) {
    steps.push({ agent: "REX", task: "Design the architecture" });
    steps.push({ agent: "BYTE", task: "Implement the backend" });
  } else if (/content|write|article|post|copy/.test(c)) {
    steps.push({ agent: "INK", task: "Write the content" });
    steps.push({ agent: "GRACE", task: "Edit and polish" });
  } else if (/research|news|market|trade|analy/.test(c)) {
    steps.push({ agent: "SCOUT", task: "Research the topic" });
    steps.push({ agent: "HAWK", task: "Analyze market implications" });
  } else {
    steps.push({ agent: "SCOUT", task: "Research and scope the request" });
  }
  return steps;
}
