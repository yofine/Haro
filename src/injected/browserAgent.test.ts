import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserAgentResponse } from "../shared/types";

describe("window.browserAgent v1 requests", () => {
  const originalPostMessage = window.postMessage;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000123");
    window.postMessage = vi.fn();
    delete window.browserAgent;
    await import("./browserAgent");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.postMessage = originalPostMessage;
    delete window.browserAgent;
  });

  it("posts a v1 chat request with request id, method, and payload", () => {
    void window.browserAgent?.chat({ messages: [{ role: "user", content: "Hello" }] });

    expect(window.postMessage).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000123",
      requestId: "00000000-0000-4000-8000-000000000123",
      source: "agenticify-page",
      version: "1",
      method: "chat",
      payload: { messages: [{ role: "user", content: "Hello" }] }
    }, "*");
  });

  it("posts a v1 run request with the agent.run intent in payload", () => {
    void window.browserAgent?.run({ task: "Summarize", mode: "auto" });

    expect(window.postMessage).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000123",
      requestId: "00000000-0000-4000-8000-000000000123",
      source: "agenticify-page",
      version: "1",
      method: "run",
      payload: { task: "Summarize", mode: "auto" }
    }, "*");
  });

  it("posts local model status, classify, and chat requests", () => {
    void window.browserAgent?.local.status();
    void window.browserAgent?.local.classify({ text: "Summarize this page" });
    void window.browserAgent?.local.chat({ messages: [{ role: "user", content: "Answer locally" }], maxTokens: 64 });

    expect(window.postMessage).toHaveBeenNthCalledWith(1, {
      id: "00000000-0000-4000-8000-000000000123",
      requestId: "00000000-0000-4000-8000-000000000123",
      source: "agenticify-page",
      version: "1",
      method: "local.status",
      payload: undefined
    }, "*");
    expect(window.postMessage).toHaveBeenNthCalledWith(2, {
      id: "00000000-0000-4000-8000-000000000123",
      requestId: "00000000-0000-4000-8000-000000000123",
      source: "agenticify-page",
      version: "1",
      method: "local.classify",
      payload: { text: "Summarize this page" }
    }, "*");
    expect(window.postMessage).toHaveBeenNthCalledWith(3, {
      id: "00000000-0000-4000-8000-000000000123",
      requestId: "00000000-0000-4000-8000-000000000123",
      source: "agenticify-page",
      version: "1",
      method: "local.chat",
      payload: { messages: [{ role: "user", content: "Answer locally" }], maxTokens: 64 }
    }, "*");
  });

  it("resolves structured gateway responses without throwing on protocol errors", async () => {
    const promise = window.browserAgent?.getStatus();
    const response: BrowserAgentResponse = {
      id: "00000000-0000-4000-8000-000000000123",
      requestId: "00000000-0000-4000-8000-000000000123",
      source: "agenticify-extension",
      ok: false,
      code: "gateway_disabled",
      error: { code: "gateway_disabled", message: "BrowserAgent Gateway is turned off." }
    };

    window.dispatchEvent(new MessageEvent("message", { source: window, data: response }));

    await expect(promise).resolves.toEqual(response);
  });
});
