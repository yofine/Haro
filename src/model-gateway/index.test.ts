import { describe, expect, it, vi } from "vitest";
import { ModelGatewayError, callModel } from "./index";
import type { ProviderSettings } from "../shared/types";

describe("model gateway", () => {
  const openAISettings: ProviderSettings = {
    id: "openai-main",
    name: "OpenAI Main",
    provider: "openai",
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4.1"],
    defaultModel: "gpt-4.1-mini",
    enabled: true
  };

  const anthropicSettings: ProviderSettings = {
    id: "anthropic-main",
    name: "Anthropic Main",
    provider: "anthropic",
    apiKey: "sk-ant-test",
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-3-5-sonnet-latest"],
    defaultModel: "claude-3-5-sonnet-latest",
    enabled: true
  };

  it("rejects disabled providers with a standard gateway error", async () => {
    await expect(callModel({
      settings: { ...openAISettings, enabled: false },
      request: { messages: [{ role: "user", content: "Hi" }] }
    })).rejects.toMatchObject({
      name: "ModelGatewayError",
      code: "provider_disabled",
      provider: "openai",
      retryable: false
    });
  });

  it("rejects providers without an API key before fetching", async () => {
    const fetchMock = vi.fn();

    await expect(callModel({
      settings: { ...openAISettings, apiKey: "   " },
      request: { messages: [{ role: "user", content: "Hi" }] },
      fetchImpl: fetchMock
    })).rejects.toBeInstanceOf(ModelGatewayError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes OpenAI settings to the chat completions API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } })
    });

    const response = await callModel({
      settings: openAISettings,
      request: {
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-4.1",
        maxTokens: 300,
        temperature: 0.2
      },
      fetchImpl: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" })
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 300,
      temperature: 0.2
    });
    expect(response.text).toBe("hello");
    expect(response.usage?.inputTokens).toBe(5);
    expect(response.usage?.outputTokens).toBe(7);
    expect(response.usage?.totalTokens).toBe(12);
  });

  it("routes Anthropic settings to the messages API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hello from claude" }], usage: { input_tokens: 4, output_tokens: 7 } })
    });

    const response = await callModel({
      settings: anthropicSettings,
      request: {
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "Hi" }
        ],
        maxTokens: 512
      },
      fetchImpl: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "sk-ant-test" })
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 512,
      system: "Be concise",
      messages: [{ role: "user", content: "Hi" }]
    });
    expect(response.text).toBe("hello from claude");
    expect(response.usage?.inputTokens).toBe(4);
    expect(response.usage?.outputTokens).toBe(7);
    expect(response.usage?.totalTokens).toBeUndefined();
  });

  it("uses custom baseUrl without forcing provider presets", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "custom" } }] })
    });

    await callModel({
      settings: { ...openAISettings, baseUrl: "https://models.example.com/custom/v1/" },
      request: { messages: [{ role: "user", content: "Hi" }] },
      fetchImpl: fetchMock
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://models.example.com/custom/v1/chat/completions");
  });

  it("passes AbortSignal through to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hello" } }] })
    });
    const controller = new AbortController();

    await callModel({
      settings: openAISettings,
      request: { messages: [{ role: "user", content: "Hi" }] },
      signal: controller.signal,
      fetchImpl: fetchMock
    });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
