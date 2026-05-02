import type { BenchmarkToolRequest } from "../shared/types";
import type { BrowserToolPlan } from "./types";

export function benchmarkRequestToBrowserToolPlan(request: BenchmarkToolRequest): BrowserToolPlan {
  if (request.type === "screenshot") {
    return {
      source: "legacy-benchmark",
      benchmarkRequest: request,
      calls: [
        { toolId: "page.read", input: { mode: "semanticOutline" } },
        { toolId: "page.capture", input: { target: "fullPage" } }
      ]
    };
  }

  if (request.type === "report") {
    return {
      source: "legacy-benchmark",
      benchmarkRequest: request,
      calls: [
        { toolId: "page.read", input: { mode: "semanticOutline" } },
        { toolId: "page.read", input: { mode: "visibleText" } },
        { toolId: "artifacts.createHtmlReport", input: {} }
      ]
    };
  }

  if (request.type === "rewrite") {
    return {
      source: "legacy-benchmark",
      benchmarkRequest: request,
      calls: [
        { toolId: "page.read", input: { mode: "textNodes" } },
        { toolId: "page.write", input: { operation: "rewriteTextNodes", instruction: request.instruction } }
      ]
    };
  }

  if (request.type === "restore-rewrite") {
    return {
      source: "legacy-benchmark",
      benchmarkRequest: request,
      calls: [
        { toolId: "page.write", input: { operation: "restoreMutation", sessionId: request.sessionId } }
      ]
    };
  }

  return {
    source: "legacy-benchmark",
    benchmarkRequest: request,
    calls: [
      { toolId: "page.read", input: { mode: "forms" } },
      { toolId: "page.write", input: { operation: "setFormValues", instruction: request.instruction } }
    ]
  };
}
