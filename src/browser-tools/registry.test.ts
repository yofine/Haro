import { describe, expect, it } from "vitest";
import { benchmarkRequestToBrowserToolPlan } from "./benchmarkAdapter";
import { getBrowserToolDefinition, listBrowserToolDefinitions } from "./registry";
import { evaluateBrowserToolRisk } from "./risk";

describe("browser tool registry", () => {
  it("registers browser-native core tools with executor and risk metadata", () => {
    expect(listBrowserToolDefinitions().map((tool) => tool.id)).toEqual([
      "page.read",
      "page.write",
      "page.capture",
      "artifacts.createHtmlReport",
      "page.act",
      "page.script"
    ]);

    expect(getBrowserToolDefinition("page.capture")).toMatchObject({
      id: "page.capture",
      executor: "debugger",
      risk: "low",
      requiresDebugger: true
    });
  });

  it("gates high-risk browser tool calls before execution", () => {
    expect(evaluateBrowserToolRisk(
      getBrowserToolDefinition("page.act"),
      { action: "click", selector: "#buy-now" }
    )).toEqual({
      status: "needs_confirmation",
      reason: "High-risk browser action requires explicit confirmation."
    });

    expect(evaluateBrowserToolRisk(
      getBrowserToolDefinition("page.script"),
      { language: "js", code: "fetch('https://example.com')" }
    )).toEqual({
      status: "blocked",
      reason: "Network-capable or storage-capable scripts are not allowed."
    });
  });
});

describe("legacy benchmark tool adapter", () => {
  it("maps current benchmark requests to browser tool plans", () => {
    expect(benchmarkRequestToBrowserToolPlan({ type: "screenshot" })).toMatchObject({
      source: "legacy-benchmark",
      calls: [
        { toolId: "page.read", input: { mode: "semanticOutline" } },
        { toolId: "page.capture", input: { target: "fullPage" } }
      ]
    });

    expect(benchmarkRequestToBrowserToolPlan({ type: "rewrite", instruction: "Translate" })).toMatchObject({
      calls: [
        { toolId: "page.read", input: { mode: "textNodes" } },
        { toolId: "page.write", input: { operation: "rewriteTextNodes", instruction: "Translate" } }
      ]
    });
  });
});
