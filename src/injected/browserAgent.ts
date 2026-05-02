import type {
  AccessRequestPayload,
  BrowserAgentResponse,
  ChatPayload,
  GatewayMethod,
  LocalChatPayload,
  RunPayload
} from "../shared/types";

declare global {
  interface Window {
    browserAgent?: {
      requestAccess(payload: AccessRequestPayload): Promise<BrowserAgentResponse>;
      getStatus(): Promise<BrowserAgentResponse>;
      chat(payload: ChatPayload): Promise<BrowserAgentResponse>;
      run(payload: RunPayload): Promise<BrowserAgentResponse>;
      models: {
        list(): Promise<BrowserAgentResponse>;
      };
      local: {
        status(): Promise<BrowserAgentResponse>;
        classify(payload: { text: string }): Promise<BrowserAgentResponse>;
        chat(payload: LocalChatPayload): Promise<BrowserAgentResponse>;
      };
    };
  }
}

function request(method: GatewayMethod, payload?: unknown): Promise<BrowserAgentResponse> {
  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<BrowserAgentResponse>) => {
      if (event.source !== window || event.data?.source !== "agenticify-extension" || event.data.requestId !== id) return;
      window.removeEventListener("message", onMessage);
      resolve(event.data);
    };

    window.addEventListener("message", onMessage);
    window.postMessage({ id, requestId: id, source: "agenticify-page", version: "1", method, payload }, "*");
  });
}

window.browserAgent = Object.freeze({
  requestAccess: (payload: AccessRequestPayload) => request("requestAccess", payload),
  getStatus: () => request("getStatus"),
  chat: (payload: ChatPayload) => request("chat", payload),
  run: (payload: RunPayload) => request("run", payload),
  models: Object.freeze({
    list: () => request("models.list")
  }),
  local: Object.freeze({
    status: () => request("local.status"),
    classify: (payload: { text: string }) => request("local.classify", payload),
    chat: (payload: LocalChatPayload) => request("local.chat", payload)
  })
});
