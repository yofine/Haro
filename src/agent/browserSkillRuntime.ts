import { getBrowserToolDefinition } from "../browser-tools/registry";
import { evaluateBrowserToolRisk } from "../browser-tools/risk";
import type { BrowserToolPlan } from "../browser-tools/types";
import type { AgentActionStatus, AgentSkillAction, InstalledSkill } from "../shared/types";

type BrowserSkillPlanResult =
  | {
    ok: true;
    skill: InstalledSkill;
    plan: BrowserToolPlan;
  }
  | {
    ok: false;
    status: AgentActionStatus;
    message: string;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function browserToolPlanFromAction(action: AgentSkillAction): BrowserToolPlan | undefined {
  const candidate = action.input?.browserToolPlan;
  return browserToolPlanFromValue(candidate);
}

function browserToolPlanFromValue(candidate: unknown): BrowserToolPlan | undefined {
  if (!isRecord(candidate) || !Array.isArray(candidate.calls)) return undefined;

  const calls = candidate.calls.flatMap((call) => {
    if (!isRecord(call) || typeof call.toolId !== "string" || !isRecord(call.input)) return [];
    return [{ toolId: call.toolId, input: call.input }];
  });
  if (!calls.length) return undefined;
  return { source: "skill", calls };
}

function defaultBrowserToolPlanFromSkill(skill: InstalledSkill): BrowserToolPlan | undefined {
  const body = skill.skillMarkdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, "");
  const match = body.match(/\{\s*"calls"\s*:\s*\[[\s\S]*?\]\s*\}/);
  if (!match) return undefined;

  try {
    return browserToolPlanFromValue(JSON.parse(match[0]));
  } catch {
    return undefined;
  }
}

function enrichScriptCall(skill: InstalledSkill, call: BrowserToolPlan["calls"][number]): BrowserToolPlan["calls"][number] | BrowserSkillPlanResult {
  if (call.toolId !== "page.script") return call;
  const scriptId = typeof call.input.scriptId === "string" ? call.input.scriptId : "";
  if (!scriptId) return call;

  if (!skill.scripts?.includes(scriptId)) {
    return {
      ok: false,
      status: "blocked",
      message: `Skill ${skill.id} requested undeclared script asset ${scriptId}.`
    };
  }

  const code = skill.scriptAssets?.[scriptId];
  if (typeof code !== "string" || !code.trim()) {
    return {
      ok: false,
      status: "failed",
      message: `Skill ${skill.id} script asset ${scriptId} is not available.`
    };
  }

  return { ...call, input: { ...call.input, code, trustedScript: true } };
}

function shouldStopForRisk(toolId: string, status: "needs_confirmation" | "blocked"): boolean {
  if (status === "blocked") return true;
  const definition = getBrowserToolDefinition(toolId);
  return definition.risk === "high" || definition.id === "page.act";
}

function validateBrowserSkillPlan(skill: InstalledSkill, plan: BrowserToolPlan): BrowserSkillPlanResult | undefined {
  const declaredTools = new Set(skill.tools ?? []);
  for (const call of plan.calls) {
    if (!declaredTools.has(call.toolId)) {
      return {
        ok: false,
        status: "blocked",
        message: `Skill ${skill.id} requested undeclared browser tool ${call.toolId}.`
      };
    }

    const decision = evaluateBrowserToolRisk(getBrowserToolDefinition(call.toolId), call.input);
    if (decision.status !== "success" && shouldStopForRisk(call.toolId, decision.status)) {
      return {
        ok: false,
        status: decision.status,
        message: decision.reason ?? `Skill ${skill.id} requested a gated browser tool.`
      };
    }
  }
  return undefined;
}

export function planBrowserSkillAction(action: AgentSkillAction, skills: InstalledSkill[]): BrowserSkillPlanResult {
  const skill = skills.find((entry) => entry.id === action.skillId && entry.enabled);
  if (!skill) return { ok: false, status: "failed", message: `Skill ${action.skillId} is not installed or enabled.` };

  if (skill.runtime === "browser" && skill.risk === "high") {
    return {
      ok: false,
      status: "needs_confirmation",
      message: `Browser skill ${skill.id} requires explicit confirmation before high-risk tools can run.`
    };
  }

  const inputBrowserToolPlan = browserToolPlanFromAction(action) ?? defaultBrowserToolPlanFromSkill(skill);
  if (inputBrowserToolPlan) {
    const enrichedCalls: BrowserToolPlan["calls"] = [];
    for (const call of inputBrowserToolPlan.calls) {
      const enriched = enrichScriptCall(skill, call);
      if ("ok" in enriched) return enriched;
      enrichedCalls.push(enriched);
    }
    const plan = { ...inputBrowserToolPlan, calls: enrichedCalls };
    const invalid = validateBrowserSkillPlan(skill, plan);
    if (invalid) return invalid;
    return {
      ok: true,
      skill,
      plan
    };
  }

  if (skill.runtime === "browser") {
    return { ok: false, status: "failed", message: `Skill ${action.skillId} requires a browserToolPlan.` };
  }

  return { ok: false, status: "failed", message: `Skill ${action.skillId} is not executable.` };
}
