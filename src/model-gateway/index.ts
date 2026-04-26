import type { ChatMessage, ModelRequest, ModelResponse, Provider, ProviderSettings } from "../shared/types";
import { callAnthropic } from "./anthropic";
import { callOpenAI } from "./openai";

export type ModelGatewayErrorCode =
  | "provider_disabled"
  | "missing_api_key"
  | "missing_model"
  | "invalid_request"
  | "request_aborted"
  | "request_timeout"
  | "provider_http_error"
  | "provider_response_error";

export class ModelGatewayError extends Error {
  code: ModelGatewayErrorCode;
  provider?: Provider;
  model?: string;
  status?: number;
  retryable: boolean;

  constructor(input: {
    code: ModelGatewayErrorCode;
    message: string;
    provider?: Provider;
    model?: string;
    status?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ModelGatewayError";
    this.code = input.code;
    this.provider = input.provider;
    this.model = input.model;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

type CallModelInput = {
  settings: ProviderSettings;
  request?: ModelRequest;
  messages?: ChatMessage[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function normalizeRequest(input: CallModelInput): ModelRequest {
  const request = input.request ?? (input.messages ? { messages: input.messages } : undefined);
  if (!request?.messages?.length) {
    throw new ModelGatewayError({
      code: "invalid_request",
      message: "Model request must include at least one message.",
      provider: input.settings.provider
    });
  }
  return request;
}

function signalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number | undefined): { signal?: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  if (!timeoutMs || timeoutMs <= 0) return { signal, cleanup: () => undefined, timedOut: () => false };

  const controller = new AbortController();
  let timeoutReached = false;
  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
    timedOut: () => timeoutReached
  };
}

async function readProviderError(response: Response): Promise<string> {
  try {
    const raw = await response.clone().json();
    const message = raw?.error?.message || raw?.message || raw?.error;
    return typeof message === "string" ? message : "";
  } catch {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function callModel(input: CallModelInput): Promise<ModelResponse> {
  const { settings, fetchImpl = fetch } = input;
  const request = normalizeRequest(input);
  const model = request.model || settings.defaultModel;

  if (!settings.enabled) {
    throw new ModelGatewayError({
      code: "provider_disabled",
      message: `${settings.provider} provider is disabled.`,
      provider: settings.provider,
      model
    });
  }
  if (!settings.apiKey.trim()) {
    throw new ModelGatewayError({
      code: "missing_api_key",
      message: `${settings.provider} API key is missing.`,
      provider: settings.provider,
      model
    });
  }
  if (!model.trim()) {
    throw new ModelGatewayError({
      code: "missing_model",
      message: `${settings.provider} model is missing.`,
      provider: settings.provider
    });
  }

  const abort = signalWithTimeout(input.signal, request.timeoutMs);
  try {
    if (settings.provider === "openai") {
      return await callOpenAI(settings, request, fetchImpl, abort.signal);
    }

    return await callAnthropic(settings, request, fetchImpl, abort.signal);
  } catch (error) {
    if (error instanceof ModelGatewayError) throw error;

    if (error instanceof Response) {
      const detail = await readProviderError(error);
      throw new ModelGatewayError({
        code: "provider_http_error",
        message: `${settings.provider} request failed with HTTP ${error.status}${detail ? `: ${detail}` : "."}`,
        provider: settings.provider,
        model,
        status: error.status,
        retryable: error.status === 429 || error.status >= 500,
        cause: error
      });
    }

    if (isAbortError(error) || abort.signal?.aborted) {
      throw new ModelGatewayError({
        code: abort.timedOut() ? "request_timeout" : "request_aborted",
        message: abort.timedOut() ? `${settings.provider} request timed out.` : `${settings.provider} request was aborted.`,
        provider: settings.provider,
        model,
        retryable: abort.timedOut(),
        cause: error
      });
    }

    throw new ModelGatewayError({
      code: "provider_response_error",
      message: error instanceof Error ? error.message : `${settings.provider} request failed.`,
      provider: settings.provider,
      model,
      retryable: false,
      cause: error
    });
  } finally {
    abort.cleanup();
  }
}
