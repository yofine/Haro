import type { ModelRequest, ModelResponse, ModelUsage, ProviderSettings } from "../shared/types";

export async function callAnthropic(settings: ProviderSettings, request: ModelRequest, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<ModelResponse> {
  const baseUrl = (settings.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const model = request.model || settings.defaultModel;
  const systemMessages = request.messages.filter((message) => message.role === "system").map((message) => message.content);
  const anthropicMessages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));
  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 2048,
    messages: anthropicMessages
  };
  if (systemMessages.length > 0) body.system = systemMessages.join("\n\n");
  if (request.temperature !== undefined) body.temperature = request.temperature;

  const response = await fetchImpl(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": settings.apiKey
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    throw response;
  }

  const raw = await response.json();
  const text = raw.content?.filter((part: { type: string }) => part.type === "text")
    .map((part: { text: string }) => part.text)
    .join("\n") ?? "";
  const usage: ModelUsage | undefined = raw.usage ? {
    inputTokens: raw.usage.input_tokens,
    outputTokens: raw.usage.output_tokens,
    totalTokens: raw.usage.total_tokens
  } : undefined;

  return {
    provider: "anthropic",
    model,
    text,
    usage,
    raw
  };
}
