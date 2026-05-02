import { describe, expect, it, vi } from "vitest";
import { createDebuggerTools, DebuggerToolError } from "./debuggerTools";

function createChromeMock() {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const api = {
    runtime: {
      lastError: undefined as { message?: string } | undefined
    },
    debugger: {
      attach: vi.fn((_target, _version, callback?: () => void) => callback?.()),
      detach: vi.fn((_target, callback?: () => void) => callback?.()),
      sendCommand: vi.fn((_target, method: string, params?: Record<string, unknown>, callback?: (result?: unknown) => void) => {
        calls.push({ method, params });
        if (method === "DOM.getDocument") {
          callback?.({ root: { nodeId: 1 } });
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback?.({ nodes: [{ role: { value: "button" } }] });
          return;
        }
        if (method === "Page.getLayoutMetrics") {
          callback?.({ cssContentSize: { width: 1280, height: 2400 } });
          return;
        }
        if (method === "Page.captureScreenshot") {
          callback?.({ data: "png-base64" });
          return;
        }
        if (method === "Runtime.evaluate") {
          const expression = String(params?.expression);
          if (expression.includes("agenticifyParagraphIndex")) {
            callback?.({ result: { value: [{ index: 0, text: "Readable paragraph text for testing the collector." }] } });
            return;
          }
          if (expression.includes("const element = document.querySelector")) {
            callback?.({ result: { value: { x: 33, y: 44 } } });
            return;
          }
          callback?.({
            result: {
              value: {
                source: "debugger",
                title: "Example",
                url: "https://example.com/",
                origin: "https://example.com",
                text: "Page text",
                headings: ["Example"],
                links: [],
                interactiveElements: []
              }
            }
          });
          return;
        }
        callback?.({});
      })
    }
  };

  return { api, calls };
}

describe("Debugger tools", () => {
  it("attaches and detaches the active tab through chrome.debugger", async () => {
    const { api } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.attach()).resolves.toMatchObject({ ok: true });
    await expect(tools.detach()).resolves.toMatchObject({ ok: true });

    expect(api.debugger.attach).toHaveBeenCalledWith({ tabId: 12 }, "1.3", expect.any(Function));
    expect(api.debugger.detach).toHaveBeenCalledWith({ tabId: 12 }, expect.any(Function));
  });

  it("can attach to a specific page target id", async () => {
    const { api } = createChromeMock();
    const tools = createDebuggerTools({ targetId: "page-target-1" }, api, "https://example.com/");

    await expect(tools.attach()).resolves.toMatchObject({ ok: true });
    await expect(tools.detach()).resolves.toMatchObject({ ok: true });

    expect(api.debugger.attach).toHaveBeenCalledWith({ targetId: "page-target-1" }, "1.3", expect.any(Function));
    expect(api.debugger.detach).toHaveBeenCalledWith({ targetId: "page-target-1" }, expect.any(Function));
  });

  it("captures DOM and accessibility snapshot data", async () => {
    const { api } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    const result = await tools.snapshot();

    expect(result.ok).toBe(true);
    expect(result.observation).toMatchObject({
      source: "debugger",
      title: "Example",
      accessibilityTree: [{ role: { value: "button" } }]
    });
  });

  it("captures full-page screenshots beyond the viewport", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    const result = await tools.captureFullPageScreenshot("Example");

    expect(result.screenshot).toMatchObject({
      dataUrl: "data:image/png;base64,png-base64",
      width: 1280,
      height: 2400,
      mimeType: "image/png"
    });
    expect(calls.find((call) => call.method === "Page.captureScreenshot")?.params).toMatchObject({
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1280, height: 2400, scale: 1 }
    });
  });

  it("warms lazy page content before measuring full-page screenshots", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await tools.captureFullPageScreenshot("Example");

    const methods = calls.map((call) => call.method);
    const prepareCallIndex = calls.findIndex((call) => (
      call.method === "Runtime.evaluate" && String(call.params?.expression).includes("__agenticifyPrepareScreenshot")
    ));
    expect(prepareCallIndex).toBeGreaterThan(-1);
    expect(prepareCallIndex).toBeLessThan(methods.indexOf("Page.getLayoutMetrics"));
  });

  it("primes the compositor before returning the final full-page screenshot", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await tools.captureFullPageScreenshot("Example");

    const screenshotCalls = calls.filter((call) => call.method === "Page.captureScreenshot");
    expect(screenshotCalls).toHaveLength(2);
    expect(screenshotCalls[0].params).toEqual(screenshotCalls[1].params);
  });

  it("rewrites and restores text through page scripts", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.rewriteTextNodes("session-1", [
      { index: 0, original: "Hello", replacement: "Bonjour" }
    ])).resolves.toMatchObject({ rewrite: { sessionId: "session-1", changed: 1 } });
    await expect(tools.restoreRewriteSession("session-1")).resolves.toMatchObject({ message: "Restored 1 text nodes." });

    const expressions = calls.filter((call) => call.method === "Runtime.evaluate").map((call) => String(call.params?.expression));
    expect(expressions.some((expression) => expression.includes("__agenticifyRewriteSessions"))).toBe(true);
    expect(expressions.some((expression) => expression.includes("Bonjour"))).toBe(true);
  });

  it("fills form fields without submitting the page", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.fillFormFields([
      { selector: "#email", value: "ada@example.com" }
    ])).resolves.toMatchObject({ formFill: { filled: 1 } });

    const expression = String(calls.find((call) => call.method === "Runtime.evaluate" && String(call.params?.expression).includes("ada@example.com"))?.params?.expression);
    expect(expression).toContain("dispatchEvent");
    expect(expression).not.toContain(".submit(");
    expect(calls.map((call) => call.method)).not.toContain("Input.dispatchKeyEvent");
  });

  it("runs CSS skill scripts by injecting a managed style element", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.runPageScript({
      language: "css",
      scriptId: "styles/highlight.css",
      code: ".agenticify-highlight { outline: 2px solid #2563eb; }"
    })).resolves.toMatchObject({
      ok: true,
      script: { language: "css", scriptId: "styles/highlight.css", changed: 1 }
    });

    const expression = String(calls.find((call) => call.method === "Runtime.evaluate" && String(call.params?.expression).includes("agenticify-skill-script"))?.params?.expression);
    expect(expression).toContain("document.createElement");
    expect(expression).toContain("styles/highlight.css");
    expect(expression).toContain(".agenticify-highlight");
  });

  it("runs JS skill scripts through Runtime.evaluate", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.runPageScript({
      language: "js",
      scriptId: "scripts/mark-headings.js",
      code: "return { changed: document.querySelectorAll('h1,h2,h3').length };"
    })).resolves.toMatchObject({
      ok: true,
      script: { language: "js", scriptId: "scripts/mark-headings.js" }
    });

    const expression = String(calls.find((call) => call.method === "Runtime.evaluate" && String(call.params?.expression).includes("mark-headings"))?.params?.expression);
    expect(expression).toContain("\"use strict\"");
    expect(expression).toContain("document.querySelectorAll");
  });

  it("passes data into JS skill scripts", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await tools.runPageScript({
      language: "js",
      scriptId: "scripts/immersive-translate.js",
      code: "return { changed: data.items.length };",
      data: { items: [{ index: 0, text: "Bonjour" }] }
    });

    const expression = String(calls.find((call) => call.method === "Runtime.evaluate" && String(call.params?.expression).includes("immersive-translate"))?.params?.expression);
    expect(expression).toContain("const data =");
    expect(expression).toContain("Bonjour");
  });

  it("collects readable article paragraphs for model-assisted scripts", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.collectArticleParagraphs()).resolves.toEqual(expect.any(Array));

    const expression = String(calls.find((call) => call.method === "Runtime.evaluate" && String(call.params?.expression).includes("agenticifyParagraphIndex"))?.params?.expression);
    expect(expression).toContain("querySelectorAll");
    expect(expression).toContain("p,li,blockquote");
    expect(expression).toContain("navigator.language");
    expect(expression).toContain("language");
  });

  it("clicks selector-derived coordinates", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.click({ type: "click", selector: "#buy" })).resolves.toMatchObject({ ok: true });

    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent").map((call) => call.params)).toEqual([
      expect.objectContaining({ type: "mousePressed", x: 33, y: 44 }),
      expect.objectContaining({ type: "mouseReleased", x: 33, y: 44 })
    ]);
  });

  it("types text through debugger input and can focus a selector first", async () => {
    const { api, calls } = createChromeMock();
    const tools = createDebuggerTools(12, api);

    await expect(tools.typeText("Ada", "#name")).resolves.toMatchObject({ ok: true });

    expect(calls.map((call) => call.method)).toContain("Input.insertText");
    expect(calls.find((call) => call.method === "Input.insertText")?.params).toEqual({ text: "Ada" });
  });

  it("returns explicit attach errors", async () => {
    const { api } = createChromeMock();
    api.debugger.attach.mockImplementation((_target, _version, callback?: () => void) => {
      api.runtime.lastError = { message: "Cannot access chrome:// pages" };
      callback?.();
    });
    const tools = createDebuggerTools(12, api);

    await expect(tools.attach()).rejects.toThrow(DebuggerToolError);
    await expect(tools.attach()).rejects.toThrow("Could not attach debugger to tab 12");
  });

  it("rejects non-web debugger targets before attach", async () => {
    const { api } = createChromeMock();

    expect(() => createDebuggerTools(12, api, "chrome-extension://other/panel.html"))
      .toThrow("Debugger target is not a regular webpage");
  });
});
