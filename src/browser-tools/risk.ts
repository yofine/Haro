import type { BrowserToolDefinition, BrowserToolRiskDecision } from "./types";

function textOf(input: Record<string, unknown>): string {
  return Object.values(input).map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ");
}

function scriptUsesBlockedApi(input: Record<string, unknown>): boolean {
  return /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|cookie|indexedDB|navigator\.sendBeacon)\b/i.test(textOf(input));
}

function isHighRiskAction(input: Record<string, unknown>): boolean {
  return /\b(buy|purchase|pay|submit|delete|remove|send|checkout|password|file)\b/i.test(textOf(input));
}

export function evaluateBrowserToolRisk(definition: BrowserToolDefinition, input: Record<string, unknown>): BrowserToolRiskDecision {
  if (definition.id === "page.script" && input.trustedScript === true) {
    return { status: "success" };
  }

  if (definition.id === "page.script" && scriptUsesBlockedApi(input)) {
    return { status: "blocked", reason: "Network-capable or storage-capable scripts are not allowed." };
  }

  if (definition.id === "page.script") {
    return { status: "success" };
  }

  if (definition.id === "page.act" && isHighRiskAction(input)) {
    return { status: "needs_confirmation", reason: "High-risk browser action requires explicit confirmation." };
  }

  if (definition.risk === "high") {
    return { status: "needs_confirmation", reason: "High-risk browser tool requires explicit confirmation." };
  }

  if (definition.requiresConfirmation || definition.risk === "medium") {
    return { status: "needs_confirmation", reason: "Browser page mutation requires confirmation." };
  }

  return { status: "success" };
}
