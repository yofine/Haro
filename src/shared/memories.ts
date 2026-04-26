import type { AgentMemory, AgentMemoryLayer, AgentMemoryScope, AgentMemorySource } from "./types";

type CreateMemoryInput = {
  content: string;
  scope?: AgentMemoryScope;
  layer?: AgentMemoryLayer;
  origin?: string;
  source?: AgentMemorySource;
  now?: string;
};

function compact(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeLayer(layer: unknown, scope: AgentMemoryScope): AgentMemoryLayer {
  if (layer === "profile" || layer === "site" || layer === "interaction") return layer;
  return scope === "site" ? "site" : "profile";
}

function normalizeSource(source: unknown): AgentMemorySource {
  if (source === "explicit" || source === "manual" || source === "auto" || source === "summary") return source;
  return "manual";
}

export function extractExplicitMemoryContent(task: string): string | undefined {
  const text = task.trim();
  const zh = /^(?:请)?(?:帮我)?(?:记住|记一下|记得)[：:\s]*(.+)$/u.exec(text);
  if (zh?.[1]) return compact(zh[1]);

  const en = /^(?:please\s+)?(?:remember|memorize|note|keep in mind)(?:\s+that)?[：:\s]*(.+)$/iu.exec(text);
  if (en?.[1]) return compact(en[1]);

  return undefined;
}

export function createMemory({
  content,
  scope = "global",
  layer,
  origin,
  source = "explicit",
  now = new Date().toISOString()
}: CreateMemoryInput): AgentMemory {
  const normalizedLayer = normalizeLayer(layer, scope);
  return {
    id: createId(),
    content: compact(content),
    scope,
    layer: normalizedLayer,
    origin: scope === "site" ? compact(origin) || undefined : undefined,
    source,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeMemories(input: unknown): AgentMemory[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Partial<AgentMemory>;
    const content = compact(item.content);
    if (!content) return [];
    const scope: AgentMemoryScope = item.scope === "site" ? "site" : "global";
    const layer = normalizeLayer(item.layer, scope);
    const now = new Date().toISOString();
    return [{
      id: compact(item.id) || createId(),
      content,
      scope,
      layer,
      origin: scope === "site" ? compact(item.origin) || undefined : undefined,
      source: normalizeSource(item.source),
      enabled: item.enabled !== false,
      createdAt: compact(item.createdAt) || now,
      updatedAt: compact(item.updatedAt) || compact(item.createdAt) || now,
      lastUsedAt: compact(item.lastUsedAt) || undefined
    }];
  });
}

export function parseAutoMemoryResponse(text: string, origin?: string): AgentMemory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return normalizeMemories(parsed.map((entry) => {
    const candidate = entry as Partial<AgentMemory>;
    const layer = normalizeLayer(candidate.layer, candidate.scope === "site" ? "site" : "global");
    const scope: AgentMemoryScope = candidate.scope === "site" || layer === "site" ? "site" : "global";
    return {
      ...candidate,
      scope,
      layer,
      origin: scope === "site" ? candidate.origin || origin : undefined,
      source: "auto",
      enabled: true
    };
  })).slice(0, 3);
}

export function getRelevantMemories(memories: AgentMemory[], origin?: string, limit = 12): AgentMemory[] {
  const normalizedOrigin = compact(origin);
  return memories
    .filter((memory) => memory.enabled)
    .filter((memory) => memory.scope === "global" || (normalizedOrigin && memory.origin === normalizedOrigin))
    .slice(-limit);
}
