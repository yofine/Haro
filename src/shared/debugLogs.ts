import type { DebugLog } from "./types";

const secretKeys = new Set([
  "apiKey",
  "api_key",
  "authorization",
  "x-api-key",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "password"
]);

function shouldRedact(key: string): boolean {
  return secretKeys.has(key) || secretKeys.has(key.toLowerCase());
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      shouldRedact(key) ? "[redacted]" : redactSecrets(nested)
    ])
  );
}

export function createDebugLog(title: string, details: unknown, callId?: string): DebugLog {
  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    callId,
    createdAt: new Date().toISOString(),
    title,
    details: redactSecrets(details)
  };
}

export function appendDebugLog(logs: DebugLog[], log: DebugLog, limit = 50): DebugLog[] {
  return [log, ...logs].slice(0, limit);
}
