import type { CallLog, CallSource, CallStatus, CallType } from "./types";

type CreateCallLogInput = {
  source: CallSource;
  origin?: string;
  type: CallType;
  model?: string;
  status: CallStatus;
  createdAt?: string;
  summary?: string;
  prompt?: string;
};

export function createCallLog(input: CreateCallLogInput): CallLog {
  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    source: input.source,
    origin: input.origin,
    type: input.type,
    model: input.model,
    status: input.status,
    createdAt: input.createdAt ?? new Date().toISOString(),
    summary: input.summary
  };
}

export function appendCallLog(logs: CallLog[], log: CallLog, limit = 100): CallLog[] {
  return [log, ...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
