import {
  CreateWebWorkerMLCEngine,
  prebuiltAppConfig,
  type MLCEngineInterface,
  type InitProgressReport
} from "@mlc-ai/web-llm";
import type { LocalModelHostRequest, LocalModelHostResponse, LocalModelHostStatus } from "./messages";

let engine: MLCEngineInterface | undefined;
let loadedProfileId: string | undefined;
let loadedModelId: string | undefined;
let loading = false;
let progress: LocalModelHostStatus["progress"];
let lastError: string | undefined;

function status(): LocalModelHostStatus {
  return {
    loaded: Boolean(engine && loadedProfileId && loadedModelId),
    loading,
    profileId: loadedProfileId,
    modelId: loadedModelId,
    progress,
    error: lastError
  };
}

function progressCallback(report: InitProgressReport) {
  progress = {
    text: report.text,
    progress: report.progress,
    timeElapsed: report.timeElapsed
  };
}

async function loadModel(message: Extract<LocalModelHostRequest, { type: "local-model:load" }>): Promise<LocalModelHostResponse> {
  loading = true;
  lastError = undefined;
  progress = undefined;
  try {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    engine = await CreateWebWorkerMLCEngine(
      worker,
      message.profile.modelId,
      {
        initProgressCallback: progressCallback,
        appConfig: {
          ...prebuiltAppConfig,
          cacheBackend: message.profile.cacheBackend
        }
      },
      {
        temperature: message.profile.temperature
      }
    );
    loadedProfileId = message.profile.id;
    loadedModelId = message.profile.modelId;
    loading = false;
    return { ok: true, status: status() };
  } catch (error) {
    loading = false;
    lastError = error instanceof Error ? error.message : "Could not load local model";
    return { ok: false, status: status(), error: lastError };
  }
}

async function classify(message: Extract<LocalModelHostRequest, { type: "local-model:classify" }>): Promise<LocalModelHostResponse> {
  if (!engine) {
    return { ok: false, status: status(), error: "Local model is not loaded." };
  }
  try {
    const raw = await engine.chat.completions.create({
      messages: message.messages,
      max_tokens: message.maxTokens,
      temperature: message.temperature
    });
    const text = raw.choices?.[0]?.message?.content ?? "";
    return { ok: true, status: status(), text, raw };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Local model inference failed";
    return { ok: false, status: status(), error: lastError };
  }
}

chrome.runtime.onMessage.addListener((message: LocalModelHostRequest, _sender, sendResponse) => {
  if (message?.target !== "haro-local-model-host") return undefined;

  (async (): Promise<LocalModelHostResponse> => {
    if (message.type === "local-model:status") return { ok: true, status: status() };
    if (message.type === "local-model:load") return loadModel(message);
    if (message.type === "local-model:classify") return classify(message);
    return { ok: false, status: status(), error: "Unknown local model host request." };
  })().then(sendResponse);

  return true;
});
