import type { ModelRequest, ModelResponse, ModelUsage, ProviderSettings } from "../shared/types";

export async function callOpenAI(settings: ProviderSettings, request: ModelRequest, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<ModelResponse> {
  const baseUrl = (settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = request.model || settings.defaultModel;
  const body: Record<string, unknown> = {
    model,
    messages: request.messages
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    throw response;
  }

  const raw = await response.json();
  const usage: ModelUsage | undefined = raw.usage ? {
    inputTokens: raw.usage.prompt_tokens,
    outputTokens: raw.usage.completion_tokens,
    totalTokens: raw.usage.total_tokens
  } : undefined;

  return {
    provider: "openai",
    model,
    text: raw.choices?.[0]?.message?.content ?? "",
    usage,
    raw
  };
}
