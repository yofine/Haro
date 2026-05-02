import type { BenchmarkToolRequest } from "../shared/types";

export type BrowserToolExecutor = "dom" | "debugger" | "hybrid";
export type BrowserToolRisk = "low" | "medium" | "high";
export type BrowserToolStatus = "success" | "failed" | "needs_confirmation" | "blocked";

export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean;
};

export type BrowserToolDefinition = {
  id: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  executor: BrowserToolExecutor;
  risk: BrowserToolRisk;
  requiresDebugger?: boolean;
  requiresConfirmation?: boolean;
  reversible?: boolean;
};

export type BrowserToolCall = {
  toolId: string;
  input: Record<string, unknown>;
};

export type BrowserToolPlan = {
  source: "legacy-benchmark" | "skill" | "agent";
  benchmarkRequest?: BenchmarkToolRequest;
  calls: BrowserToolCall[];
};

export type BrowserToolRiskDecision = {
  status: Extract<BrowserToolStatus, "success" | "needs_confirmation" | "blocked">;
  reason?: string;
};

export type BrowserToolResult<T = unknown> = {
  ok: boolean;
  status: BrowserToolStatus;
  message: string;
  data?: T;
  artifacts?: unknown[];
  mutations?: unknown[];
  preview?: unknown;
};
