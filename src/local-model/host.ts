import type { LocalModelHostRequest, LocalModelHostResponse } from "./messages";

const OFFSCREEN_URL = "local-model.html";

async function hasOffscreenDocument(): Promise<boolean> {
  const clientsApi = (self as unknown as { clients?: { matchAll(input?: unknown): Promise<Array<{ url: string }>> } }).clients;
  if (!clientsApi?.matchAll) return false;
  const clients = await clientsApi.matchAll();
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  return clients.some((client) => client.url === offscreenUrl);
}

export async function ensureLocalModelOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  const offscreen = chrome.offscreen;
  if (!offscreen?.createDocument) {
    throw new Error("Chrome offscreen documents are unavailable.");
  }
  await offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [offscreen.Reason.WORKERS],
    justification: "Run the user-managed on-device WebLLM model in an extension offscreen document."
  });
}

export async function sendLocalModelHostMessage(message: LocalModelHostRequest): Promise<LocalModelHostResponse> {
  await ensureLocalModelOffscreenDocument();
  return chrome.runtime.sendMessage(message) as Promise<LocalModelHostResponse>;
}
