import type {
  AgentAction,
  AgentControlMode,
  AgentTaskIntent,
  AgentEvent,
  ChatMessage,
  ConversationMemory,
  DomActionResult,
  DomObservation,
  InstalledSkill,
  ModelGateway
} from "../shared/types";
import { buildSkillPrompt, matchSkillsForTask } from "./skills";

type RunAgentTaskInput = {
  task: string;
  observe: () => Promise<DomObservation>;
  act?: (action: AgentAction) => Promise<DomActionResult>;
  modelGateway: ModelGateway;
  maxSteps?: number;
  mode?: AgentControlMode;
  skills?: InstalledSkill[];
  skillIds?: string[];
  memory?: ConversationMemory;
};

type RunPageChatInput = {
  task: string;
  observation: DomObservation;
  modelGateway: ModelGateway;
  memory?: ConversationMemory;
};

type RunMemoryChatInput = {
  task: string;
  modelGateway: ModelGateway;
  memory?: ConversationMemory;
};

type AgentResult = {
  finalText: string;
  events: AgentEvent[];
};

type ModelDecision = {
  thought?: string;
  plan?: string;
  action?: AgentAction;
  final?: string;
  reason?: string;
  confidence?: number;
};

const MAX_STEPS = 5;

export function classifyTaskIntent(task: string): AgentTaskIntent {
  const text = task.toLowerCase();
  if (/\b(remember|memorize|note|keep in mind)\b/.test(text) || /(记住|记一下|帮我记|记得)/.test(task)) {
    return "memory";
  }
  if (/\b(click|type|fill|submit|scroll|open|select|choose|press|install|create skill|rewrite|translate|screenshot|capture|report|export|delete|buy|purchase|pay)\b/.test(text)) {
    return "run";
  }
  if (/(点击|填写|提交|滚动|打开|选择|安装|创建.*skill|创建.*技能|改写|翻译|截图|报告|导出|删除|购买|支付)/.test(task)) {
    return "run";
  }
  return "chat";
}

function extractJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;

  const start = candidate.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }

  return undefined;
}

function normalizeDecision(value: unknown, fallbackText: string): ModelDecision {
  if (!value || typeof value !== "object") return { final: fallbackText };
  const decision = value as ModelDecision;
  const hasFinal = typeof decision.final === "string";
  const hasAction = Boolean(decision.action && typeof decision.action === "object");
  if (!hasFinal && !hasAction) return { final: fallbackText };
  return decision;
}

function parseDecision(text: string): ModelDecision {
  const json = extractJsonObject(text);
  if (!json) return { final: text };

  try {
    return normalizeDecision(JSON.parse(json), text);
  } catch {
    return { final: text };
  }
}

function isHighRiskAction(task: string, action: AgentAction): boolean {
  if (action.type !== "click") return false;
  return /\b(buy|purchase|pay|submit|delete|remove|confirm|checkout)\b/i.test(`${task} ${action.selector}`);
}

function describeLongTermMemory(memory: ConversationMemory | undefined): string {
  const memories = memory?.memories?.filter((entry) => entry.enabled).slice(-12) ?? [];
  return memories.map((entry) => `- ${entry.content}${entry.scope === "site" && entry.origin ? ` (${entry.origin})` : ""}`).join("\n");
}

function buildMessages(task: string, observation: DomObservation, events: AgentEvent[], maxSteps: number, mode: AgentControlMode, skills: InstalledSkill[], memory?: ConversationMemory): ChatMessage[] {
  const skillPrompt = buildSkillPrompt(skills);
  return [
    {
      role: "system",
      content: [
        "You are BrowserAgent inside Agenticify. Use the current page context and keep actions conservative.",
        "Return strict JSON with either {\"final\",\"reason\",\"confidence\"} or {\"action\",\"reason\",\"confidence\"}.",
        "Allowed actions: click by selector, type by selector/value, scroll up/down, read, skill by skillId, or debugger request.",
        `Control mode: ${mode}. Debugger mode is gated and only available when separately authorized.`,
        skillPrompt
      ].filter(Boolean).join("\n\n")
    },
    {
      role: "user",
      content: [
        `Task: ${task}`,
        `URL: ${observation.url}`,
        `Title: ${observation.title}`,
        `Headings: ${observation.headings.join(" | ")}`,
        `Page text: ${observation.text}`,
        `Interactive elements: ${observation.interactiveElements.map((element) => `${element.label} (${element.selector})`).join(", ")}`,
        `Long-term memory:\n${describeLongTermMemory(memory) || "(none)"}`,
        `Previous events: ${JSON.stringify(events.slice(-6))}`,
        `Maximum observe-act steps: ${maxSteps}`
      ].join("\n\n")
    }
  ];
}

function selectSkillsForTask(task: string, skills: InstalledSkill[], skillIds?: string[]): InstalledSkill[] {
  const selectedIds = skillIds?.filter(Boolean) ?? [];
  if (!selectedIds.length) return matchSkillsForTask(task, skills);
  const selected = new Set(selectedIds);
  return skills.filter((skill) => skill.enabled && selected.has(skill.id));
}

function describeMemory(memory: ConversationMemory | undefined): string {
  const turns = memory?.turns?.slice(-8) ?? [];
  return turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
}

export async function runPageChat({ task, observation, modelGateway, memory }: RunPageChatInput): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are BrowserAgent inside Agenticify.",
        "Answer the user's simple page question directly using page context and recent conversation memory.",
        "Do not plan browser actions or call tools in this mode."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Task: ${task}`,
        `URL: ${observation.url}`,
        `Title: ${observation.title}`,
        `Headings: ${observation.headings.join(" | ")}`,
        `Page text: ${observation.text}`,
        `Long-term memory:\n${describeLongTermMemory(memory) || "(none)"}`,
        `Recent page conversation:\n${describeMemory(memory) || "(none)"}`
      ].join("\n\n")
    }
  ];
  const response = await modelGateway.chat(messages);
  return {
    finalText: response.text,
    events: [
      { type: "observe", observation },
      { type: "final", text: response.text }
    ]
  };
}

export async function runMemoryChat({ task, modelGateway, memory }: RunMemoryChatInput): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are BrowserAgent inside Agenticify.",
        "Handle direct conversation and memory instructions without using page context or browser tools.",
        "If the user asks you to remember something, acknowledge it briefly and rely on the recent conversation memory for future turns."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Task: ${task}`,
        `Long-term memory:\n${describeLongTermMemory(memory) || "(none)"}`,
        `Recent conversation:\n${describeMemory(memory) || "(none)"}`
      ].join("\n\n")
    }
  ];
  const response = await modelGateway.chat(messages);
  return {
    finalText: response.text,
    events: [
      { type: "final", text: response.text }
    ]
  };
}

export async function runAgentTask({
  task,
  observe,
  act,
  modelGateway,
  maxSteps = 3,
  mode = "dom",
  skills = [],
  skillIds,
  memory
}: RunAgentTaskInput): Promise<AgentResult> {
  const steps = Math.min(Math.max(maxSteps, 1), MAX_STEPS);
  const events: AgentEvent[] = [];
  const matchedSkills = selectSkillsForTask(task, skills, skillIds);

  for (let step = 0; step < steps; step += 1) {
    const observation = await observe();
    events.push({ type: "observe", observation });

    const response = await modelGateway.chat(buildMessages(task, observation, events, steps, mode, matchedSkills, memory));
    const decision = parseDecision(response.text);
    events.push({
      type: "thought",
      text: decision.reason ?? decision.thought ?? decision.plan ?? response.text,
      confidence: decision.confidence
    });

    if (decision.final || !decision.action) {
      const finalText = decision.final ?? response.text;
      events.push({ type: "final", text: finalText });
      return { finalText, events };
    }

    if (isHighRiskAction(task, decision.action)) {
      const finalText = `This action needs confirmation before Agenticify can continue: ${decision.reason ?? "high-risk page action"}`;
      events.push({ type: "blocked", reason: finalText, status: "needs_confirmation" });
      return { finalText, events };
    }

    if (!act) {
      const finalText = "No page action tool is available for this run.";
      events.push({ type: "blocked", reason: finalText, status: "blocked" });
      return { finalText, events };
    }

    events.push({
      type: "action",
      action: decision.action,
      reason: decision.reason ?? "Model requested a page action.",
      confidence: decision.confidence
    });
    const result = await act(decision.action);
    events.push({ type: "action-result", action: decision.action, result });

    if (!result.ok) {
      events.push({ type: "blocked", reason: result.message, status: result.status === "needs_confirmation" ? "needs_confirmation" : "blocked" });
      return { finalText: result.message, events };
    }
  }

  const finalText = `Stopped after ${steps} steps without a final answer.`;
  events.push({ type: "blocked", reason: finalText, status: "blocked" });
  return { finalText, events };
}
