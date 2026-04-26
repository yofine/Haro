import { observePage, runDomAction } from "./domTools";
import type { BrowserAgentResponse, GatewayErrorCode } from "../shared/types";

function createContentGatewayError(
  requestId: string,
  code: GatewayErrorCode,
  message: string,
  details?: unknown
): BrowserAgentResponse {
  return {
    id: requestId,
    requestId,
    source: "agenticify-extension",
    ok: false,
    code,
    error: details === undefined ? { code, message } : { code, message, details }
  };
}

function normalizeContentGatewayError(error: unknown): { code: GatewayErrorCode; message: string; details?: unknown } {
  if (error instanceof Error) {
    if (/configure an enabled openai or anthropic provider|api key is missing|provider is disabled/i.test(error.message)) {
      return { code: "model_not_configured", message: "No enabled model provider is configured." };
    }
    if (/no active tab|regular http\/https webpages|could not observe active page/i.test(error.message)) {
      return { code: "page_unavailable", message: "The current page is not available to BrowserAgent." };
    }
    if (/debugger mode requires explicit|debugger command|could not attach debugger|could not detach debugger|chrome debugger api is unavailable/i.test(error.message)) {
      return { code: "debugger_control_unavailable", message: error.message };
    }
    return { code: "internal_error", message: error.message };
  }

  return { code: "internal_error", message: "Unknown gateway error" };
}

const script = document.createElement("script");
script.src = chrome.runtime.getURL("assets/injected.js");
script.type = "module";
(document.documentElement || document.head).appendChild(script);
script.remove();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "agenticify-content") return false;

  if (message.type === "observe") {
    sendResponse({ ok: true, observation: observePage() });
    return true;
  }

  if (message.type === "dom-action") {
    sendResponse({ ok: true, result: runDomAction(message.action) });
    return true;
  }

  return false;
});

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.source !== "agenticify-page") return;
  const requestId = event.data.requestId ?? event.data.id;

  try {
    const response = await chrome.runtime.sendMessage({
      ...event.data,
      target: "agenticify-background",
      origin: location.origin
    }) as BrowserAgentResponse;
    window.postMessage({
      ...response,
      source: "agenticify-extension",
      id: requestId,
      requestId
    }, "*");
  } catch (error) {
    const normalized = normalizeContentGatewayError(error);
    window.postMessage(createContentGatewayError(requestId, normalized.code, normalized.message, normalized.details), "*");
  }
});
