import { describe, expect, it, vi } from "vitest";
import type { ModelGateway } from "../shared/types";
import { runBenchmarkTool, runBrowserToolPlan, sanitizeReportHtml } from "./browserTools";

function model(text: string): ModelGateway {
  return {
    chat: vi.fn().mockResolvedValue({ text, provider: "openai", model: "gpt-test" })
  };
}

function tools() {
  return {
    snapshot: vi.fn().mockResolvedValue({
      ok: true,
      message: "snapshot",
      observation: {
        source: "debugger",
        title: "Example",
        url: "https://example.com",
        origin: "https://example.com",
        text: "Hello world",
        headings: ["Example"],
        links: [],
        interactiveElements: []
      }
    }),
    captureFullPageScreenshot: vi.fn().mockResolvedValue({
      ok: true,
      message: "screenshot",
      screenshot: {
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        width: 100,
        height: 200,
        filename: "example-screenshot.png"
      }
    }),
    collectTextNodes: vi.fn().mockResolvedValue([{ index: 0, text: "Hello world" }]),
    collectArticleParagraphs: vi.fn().mockResolvedValue([{ index: 0, text: "Hello world" }]),
    rewriteTextNodes: vi.fn().mockResolvedValue({ ok: true, message: "rewrite", rewrite: { sessionId: "s1", changed: 1, replacements: [] } }),
    restoreRewriteSession: vi.fn().mockResolvedValue({ ok: true, message: "Restored 1 text nodes." }),
    fillFormFields: vi.fn().mockResolvedValue({ ok: true, message: "fill", formFill: { filled: 1, skipped: [] } }),
    runPageScript: vi.fn().mockResolvedValue({ ok: true, message: "script", script: { language: "js", changed: 1 } })
  };
}

describe("browser benchmark tools", () => {
  it("sanitizes report html for chat display", () => {
    expect(sanitizeReportHtml(`<section onclick="x()"><h1>Report</h1><script>alert(1)</script><p>Safe</p></section>`))
      .toBe(`<section><h1>Report</h1><p>Safe</p></section>`);
  });

  it("removes markdown fences from report html", () => {
    expect(sanitizeReportHtml("```html\n<article><h1>Report</h1><p>Safe</p></article>\n```"))
      .toBe("<article><h1>Report</h1><p>Safe</p></article>");
  });

  it("returns full-page screenshot artifacts", async () => {
    const debuggerTools = tools();

    const result = await runBenchmarkTool({
      request: { type: "screenshot" },
      tools: debuggerTools,
      modelGateway: model("")
    });

    expect(result).toMatchObject({ type: "screenshot", screenshot: { filename: "example-screenshot.png" } });
    expect(debuggerTools.captureFullPageScreenshot).toHaveBeenCalledWith("Example");
  });

  it("exposes the browser tool plan used for legacy compatibility execution", async () => {
    const onToolPlan = vi.fn();

    await runBenchmarkTool({
      request: { type: "screenshot" },
      tools: tools(),
      modelGateway: model(""),
      onToolPlan
    });

    expect(onToolPlan).toHaveBeenCalledWith({
      source: "legacy-benchmark",
      benchmarkRequest: { type: "screenshot" },
      calls: [
        { toolId: "page.read", input: { mode: "semanticOutline" } },
        { toolId: "page.capture", input: { target: "fullPage" } }
      ]
    });
  });

  it("forwards browser tool execution events to callers", async () => {
    const onEvent = vi.fn();

    await runBenchmarkTool({
      request: { type: "screenshot" },
      tools: tools(),
      modelGateway: model(""),
      onEvent
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "action",
      action: { type: "tool", toolId: "page.read", input: { mode: "semanticOutline" } }
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "action-result",
      action: { type: "tool", toolId: "page.capture", input: { target: "fullPage" } }
    }));
  });

  it("executes browser tool plans directly without legacy benchmark remapping", async () => {
    const onToolPlan = vi.fn();
    const debuggerTools = tools();

    const result = await runBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "semanticOutline" } },
          { toolId: "page.capture", input: { target: "fullPage" } }
        ]
      },
      tools: debuggerTools,
      modelGateway: model(""),
      onToolPlan
    });

    expect(result).toMatchObject({ type: "screenshot", screenshot: { filename: "example-screenshot.png" } });
    expect(onToolPlan).toHaveBeenCalledWith({
      source: "skill",
      calls: [
        { toolId: "page.read", input: { mode: "semanticOutline" } },
        { toolId: "page.capture", input: { target: "fullPage" } }
      ]
    });
  });

  it("generates sanitized html reports from debugger snapshots", async () => {
    const result = await runBenchmarkTool({
      request: { type: "report" },
      tools: tools(),
      modelGateway: model(`<article><h1>Analysis</h1><img src=x onerror="bad()"><p>Useful.</p></article>`)
    });

    expect(result).toEqual({
      type: "report",
      title: "Page analysis report",
      html: `<article><h1>Analysis</h1><img src=x><p>Useful.</p></article>`
    });
  });

  it("rewrites page text from a model replacement plan", async () => {
    const debuggerTools = tools();

    const result = await runBenchmarkTool({
      request: { type: "rewrite", instruction: "Translate to French" },
      tools: debuggerTools,
      modelGateway: model(JSON.stringify({ replacements: [{ index: 0, replacement: "Bonjour le monde" }] }))
    });

    expect(result.type).toBe("rewrite");
    expect(debuggerTools.rewriteTextNodes).toHaveBeenCalledWith(expect.any(String), [
      { index: 0, original: "Hello world", replacement: "Bonjour le monde" }
    ]);
  });

  it("fills forms from a model field plan without submit actions", async () => {
    const debuggerTools = tools();

    await runBenchmarkTool({
      request: { type: "fill-form", instruction: "email is ada@example.com and submit the form" },
      tools: debuggerTools,
      modelGateway: model(JSON.stringify({ fields: [{ selector: "#email", value: "ada@example.com" }, { selector: "button[type=submit]", value: "submit" }] }))
    });

    expect(debuggerTools.fillFormFields).toHaveBeenCalledWith([{ selector: "#email", value: "ada@example.com" }]);
  });
});
