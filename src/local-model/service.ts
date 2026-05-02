import { classifyTaskIntent } from "../agent/runtime";
import type { AgentTaskIntent, ChatMessage, ExtensionSettings, LocalModelProfile, LocalModelPurpose } from "../shared/types";
import { scanSensitiveText } from "./privacy";

export type LocalModelStatus = {
  enabled: boolean;
  ready: boolean;
  activeProfileId?: string;
  modelId?: string;
  runtime?: "webllm";
  purposes: LocalModelPurpose[];
};

export type LocalClassification = {
  available: boolean;
  intent: AgentTaskIntent;
  sensitivity: ReturnType<typeof scanSensitiveText>;
  modelId?: string;
  confidence?: number;
  reason?: string;
  fallbackReason?: string;
};

type LocalClassificationModelOutput = {
  intent?: AgentTaskIntent;
  confidence?: number;
  reason?: string;
};

export function getActiveLocalProfile(settings: ExtensionSettings): LocalModelProfile | undefined {
  return settings.localModels.profiles.find((profile) => (
    profile.id === settings.localModels.defaultProfileId
    && profile.enabled
    && profile.loadState === "ready"
  )) ?? settings.localModels.profiles.find((profile) => profile.enabled && profile.loadState === "ready");
}

export function getLocalModelStatus(settings: ExtensionSettings): LocalModelStatus {
  const profile = getActiveLocalProfile(settings);
  return {
    enabled: settings.localModels.enabled,
    ready: Boolean(settings.localModels.enabled && profile),
    activeProfileId: settings.localModels.enabled ? profile?.id : undefined,
    modelId: settings.localModels.enabled ? profile?.modelId : undefined,
    runtime: settings.localModels.enabled && profile ? profile.runtime : undefined,
    purposes: settings.localModels.enabled && profile ? profile.purposes : []
  };
}

export function buildLocalClassificationMessages(text: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Classify the user text for a browser AI agent.",
        "Return only JSON with keys: intent, confidence, reason.",
        "intent must be one of: memory, chat, run.",
        "Use run for page actions or browser operations, memory for explicit remember requests, chat for simple Q&A."
      ].join(" ")
    },
    { role: "user", content: text }
  ];
}

function extractJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

export function parseLocalClassificationOutput(text: string): LocalClassificationModelOutput | undefined {
  const json = extractJsonObject(text);
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as { intent?: unknown; confidence?: unknown; reason?: unknown };
    if (!["memory", "chat", "run"].includes(String(parsed.intent))) return undefined;
    return {
      intent: parsed.intent as AgentTaskIntent,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 240) : undefined
    };
  } catch {
    return undefined;
  }
}

export function classifyLocalText(settings: ExtensionSettings, text: string): LocalClassification {
  const status = getLocalModelStatus(settings);
  return {
    available: status.ready,
    intent: classifyTaskIntent(text),
    sensitivity: scanSensitiveText(text),
    modelId: status.modelId,
    fallbackReason: status.ready ? undefined : "No ready local model is enabled; used local rules only."
  };
}

export function mergeLocalClassification(
  settings: ExtensionSettings,
  text: string,
  modelText: string | undefined,
  fallbackReason?: string
): LocalClassification {
  const base = classifyLocalText(settings, text);
  const parsed = modelText ? parseLocalClassificationOutput(modelText) : undefined;
  if (!parsed) {
    return {
      ...base,
      fallbackReason: fallbackReason ?? (modelText ? "Local model returned an invalid classification; used local rules only." : base.fallbackReason)
    };
  }
  return {
    ...base,
    intent: parsed.intent ?? base.intent,
    confidence: parsed.confidence,
    reason: parsed.reason,
    fallbackReason: undefined
  };
}
