import { describe, expect, it, vi } from "vitest";
import type { ModelGateway } from "../shared/types";
import { browserToolPlanNeedsModel, executeBrowserToolPlan } from "./planExecutor";

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
        interactiveElements: [{ selector: "#email", tagName: "input", label: "Email" }]
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
    collectArticleParagraphs: vi.fn().mockResolvedValue([
      { index: 0, text: "The market expanded in 2025.", language: "zh-CN" },
      { index: 1, text: "Revenue improved across regions.", language: "zh-CN" }
    ]),
    rewriteTextNodes: vi.fn().mockResolvedValue({ ok: true, message: "rewrite", rewrite: { sessionId: "s1", changed: 1, replacements: [] } }),
    restoreRewriteSession: vi.fn().mockResolvedValue({ ok: true, message: "Restored 1 text nodes." }),
    fillFormFields: vi.fn().mockResolvedValue({ ok: true, message: "fill", formFill: { filled: 1, skipped: [] } }),
    runPageScript: vi.fn().mockImplementation(async (script: { language: "js" | "css"; scriptId?: string; data?: unknown }) => ({
      ok: true,
      message: script.language === "css" ? "Injected CSS script." : "Ran JS script.",
      script: { scriptId: script.scriptId, language: script.language, changed: Array.isArray((script.data as { items?: unknown[] } | undefined)?.items) ? (script.data as { items: unknown[] }).items.length : 1 }
    }))
  };
}

describe("browser tool plan executor", () => {
  it("executes screenshot plans through page.read and page.capture tools", async () => {
    const debuggerTools = tools();

    const result = await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "semanticOutline" } },
          { toolId: "page.capture", input: { target: "fullPage" } }
        ]
      },
      tools: debuggerTools,
      modelGateway: model("")
    });

    expect(result).toMatchObject({ type: "screenshot", screenshot: { filename: "example-screenshot.png" } });
    expect(debuggerTools.snapshot).toHaveBeenCalled();
    expect(debuggerTools.captureFullPageScreenshot).toHaveBeenCalledWith("Example");
  });

  it("executes rewrite plans through text-node read and page.write", async () => {
    const debuggerTools = tools();

    const result = await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "textNodes" } },
          { toolId: "page.write", input: { operation: "rewriteTextNodes", instruction: "Translate" } }
        ]
      },
      tools: debuggerTools,
      modelGateway: model(JSON.stringify({ replacements: [{ index: 0, replacement: "Bonjour" }] }))
    });

    expect(result.type).toBe("rewrite");
    expect(debuggerTools.rewriteTextNodes).toHaveBeenCalledWith(expect.any(String), [
      { index: 0, original: "Hello world", replacement: "Bonjour" }
    ]);
  });

  it("emits action timeline events for browser tool calls", async () => {
    const events = vi.fn();

    await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "semanticOutline" } },
          { toolId: "page.capture", input: { target: "fullPage" } }
        ]
      },
      tools: tools(),
      modelGateway: model(""),
      onEvent: events
    });

    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      type: "action",
      action: { type: "tool", toolId: "page.read", input: { mode: "semanticOutline" } }
    }));
    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      type: "action-result",
      action: { type: "tool", toolId: "page.capture", input: { target: "fullPage" } },
      result: expect.objectContaining({ ok: true, status: "success" })
    }));
  });

  it("blocks unsafe browser script plans before page access", async () => {
    const debuggerTools = tools();
    const events = vi.fn();

    await expect(executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.script", input: { language: "js", code: "fetch('https://example.com')" } }
        ]
      },
      tools: debuggerTools,
      modelGateway: model(""),
      onEvent: events
    })).rejects.toMatchObject({
      status: "blocked",
      message: "Network-capable or storage-capable scripts are not allowed."
    });

    expect(debuggerTools.snapshot).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledWith({
      type: "blocked",
      status: "blocked",
      reason: "Network-capable or storage-capable scripts are not allowed."
    });
  });

  it("executes safe page.script calls from skill script assets", async () => {
    const debuggerTools = tools();
    const events = vi.fn();

    const result = await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          {
            toolId: "page.script",
            input: {
              language: "css",
              scriptId: "styles/highlight.css",
              code: ".agenticify-highlight { outline: 2px solid #2563eb; }"
            }
          }
        ]
      },
      tools: debuggerTools,
      modelGateway: model(""),
      onEvent: events
    });

    expect(result).toEqual({
      type: "script",
      title: "Page script",
      script: { scriptId: "styles/highlight.css", language: "css", changed: 1 }
    });
    expect(debuggerTools.snapshot).not.toHaveBeenCalled();
    expect(debuggerTools.runPageScript).toHaveBeenCalledWith({
      language: "css",
      scriptId: "styles/highlight.css",
      code: ".agenticify-highlight { outline: 2px solid #2563eb; }"
    });
    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      type: "action-result",
      action: { type: "tool", toolId: "page.script", input: expect.objectContaining({ scriptId: "styles/highlight.css" }) }
    }));
  });

  it("executes read plus multiple built-in page.script calls", async () => {
    const debuggerTools = tools();

    const result = await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "semanticOutline" } },
          { toolId: "page.script", input: { language: "css", scriptId: "styles/mark-page.css", code: ".agenticify-marked-heading {}", trustedScript: true } },
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/mark-page.js", code: "return { changed: 3 };", trustedScript: true } }
        ]
      },
      tools: debuggerTools,
      modelGateway: model("")
    });

    expect(result).toEqual({
      type: "script",
      title: "Page script",
      script: { language: "js", scriptId: "scripts/mark-page.js", changed: 1 }
    });
    expect(debuggerTools.snapshot).toHaveBeenCalled();
    expect(debuggerTools.runPageScript).toHaveBeenCalledTimes(2);
  });

  it("generates paragraph translations before running immersive script", async () => {
    const debuggerTools = tools();
    const modelGateway = model(JSON.stringify({
      items: [
        { index: 0, text: "市场在 2025 年扩大。" },
        { index: 1, text: "各地区收入都有改善。" }
      ]
    }));

    const result = await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/immersive-translate.js", code: "return { changed: 2 };", generate: "paragraphTranslations", trustedScript: true } }
        ]
      },
      tools: debuggerTools,
      modelGateway
    });

    expect(result).toMatchObject({ type: "script", script: { changed: 2 } });
    expect(debuggerTools.collectArticleParagraphs).toHaveBeenCalledWith(12);
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringContaining("Translate each paragraph") })
    ]));
    expect(debuggerTools.runPageScript).toHaveBeenCalledWith(expect.objectContaining({
      scriptId: "scripts/immersive-translate.js",
      data: {
        locale: "zh-CN",
        items: [
          { index: 0, text: "市场在 2025 年扩大。" },
          { index: 1, text: "各地区收入都有改善。" }
        ]
      }
    }));
  });

  it("uses the browser language from collected paragraphs for generated notes", async () => {
    const debuggerTools = tools();
    const modelGateway = model(JSON.stringify({ items: [{ index: 0, text: "这是核心观点。" }] }));

    await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/paragraph-notes.js", code: "return { changed: 1 };", generate: "generateParagraphNotes", targetLanguage: "system", trustedScript: true } }
        ]
      },
      tools: debuggerTools,
      modelGateway
    });

    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringContaining("Chinese (zh-CN), the browser language") })
    ]));
    expect(debuggerTools.runPageScript).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ locale: "zh-CN", label: "注释" })
    }));
  });

  it("batches generated paragraph script data to keep model requests small", async () => {
    const debuggerTools = tools();
    debuggerTools.collectArticleParagraphs.mockResolvedValue(Array.from({ length: 13 }, (_, index) => ({
      index,
      text: `Paragraph ${index} ${"x".repeat(index === 0 ? 1300 : 20)}`
    })));
    const modelGateway: ModelGateway = {
      chat: vi.fn().mockImplementation(async (messages) => {
        const payload = JSON.parse(messages[1].content);
        return {
          text: JSON.stringify({ items: payload.paragraphs.map((paragraph: { index: number }) => ({ index: paragraph.index, text: `T${paragraph.index}` })) }),
          provider: "openai",
          model: "gpt-test"
        };
      })
    };

    await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/immersive-translate.js", code: "return { changed: 13 };", generate: "generateParagraphTranslations", maxParagraphs: 12, batchSize: 3, trustedScript: true } }
        ]
      },
      tools: debuggerTools,
      modelGateway
    });

    expect(modelGateway.chat).toHaveBeenCalledTimes(5);
    expect(JSON.parse(vi.mocked(modelGateway.chat).mock.calls[0][0][1].content).paragraphs).toHaveLength(3);
    expect(JSON.parse(vi.mocked(modelGateway.chat).mock.calls[0][0][1].content).paragraphs[0].text.length).toBeLessThanOrEqual(803);
    expect(debuggerTools.runPageScript).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        items: Array.from({ length: 13 }, (_, index) => ({ index, text: `T${index}` }))
      }
    }));
  });

  it("falls back to single paragraphs and skips timed-out generated script items", async () => {
    const debuggerTools = tools();
    debuggerTools.collectArticleParagraphs.mockResolvedValue([
      { index: 0, text: "First paragraph.", language: "zh-CN" },
      { index: 1, text: "Second paragraph.", language: "zh-CN" },
      { index: 2, text: "Third paragraph.", language: "zh-CN" }
    ]);
    const timeout = Object.assign(new Error("openai request timed out."), { code: "request_timeout" });
    const modelGateway: ModelGateway = {
      chat: vi.fn()
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ text: JSON.stringify({ items: [{ index: 0, text: "T0" }] }), provider: "openai", model: "gpt-test" })
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ text: JSON.stringify({ items: [{ index: 2, text: "T2" }] }), provider: "openai", model: "gpt-test" })
    };

    await executeBrowserToolPlan({
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/immersive-translate.js", code: "return { changed: 2 };", generate: "generateParagraphTranslations", maxParagraphs: 12, batchSize: 3, trustedScript: true } }
        ]
      },
      tools: debuggerTools,
      modelGateway
    });

    expect(modelGateway.chat).toHaveBeenCalledTimes(4);
    expect(debuggerTools.runPageScript).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        items: [{ index: 0, text: "T0" }, { index: 2, text: "T2" }],
        locale: "zh-CN",
        skipped: [1]
      }
    }));
  });

  it("detects model-backed script generation in browser tool plans", () => {
    expect(browserToolPlanNeedsModel({
      source: "skill",
      calls: [
        { toolId: "page.script", input: { language: "css", scriptId: "styles/immersive-reading.css", code: ".x{}" } },
        { toolId: "page.script", input: { language: "js", scriptId: "scripts/immersive-translate.js", code: "return {}", generate: "generateParagraphTranslations" } }
      ]
    })).toBe(true);

    expect(browserToolPlanNeedsModel({
      source: "skill",
      calls: [
        { toolId: "page.script", input: { language: "js", scriptId: "scripts/mark-page.js", code: "return {}" } }
      ]
    })).toBe(false);
  });
});
