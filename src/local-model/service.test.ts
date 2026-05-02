import { describe, expect, it } from "vitest";
import { classifyLocalText, getLocalModelStatus, mergeLocalClassification, parseLocalClassificationOutput } from "./service";
import { defaultSettings } from "../shared/storage";
import type { ExtensionSettings } from "../shared/types";

describe("local model service facade", () => {
  it("reports inactive status when no ready profile is enabled", () => {
    expect(getLocalModelStatus(defaultSettings)).toMatchObject({
      enabled: false,
      ready: false,
      activeProfileId: undefined,
      purposes: []
    });
  });

  it("classifies intent and sensitivity with local rules", () => {
    const settings: ExtensionSettings = {
      ...defaultSettings,
      localModels: {
        ...defaultSettings.localModels,
        enabled: true,
        defaultProfileId: "local-1",
        profiles: [{
          id: "local-1",
          name: "Local",
          runtime: "webllm",
          modelId: "Qwen2-0.5B-Instruct-q4f16_1-MLC",
          enabled: true,
          loadState: "ready",
          purposes: ["intent", "privacy"],
          defaultForPurposes: ["intent", "privacy"],
          cacheBackend: "indexeddb",
          temperature: 0,
          maxTokens: 256,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z"
        }],
        privacy: defaultSettings.localModels.privacy
      }
    };

    expect(getLocalModelStatus(settings)).toMatchObject({
      enabled: true,
      ready: true,
      activeProfileId: "local-1",
      modelId: "Qwen2-0.5B-Instruct-q4f16_1-MLC",
      purposes: ["intent", "privacy"]
    });

    expect(classifyLocalText(settings, "Summarize this page for ada@example.com")).toMatchObject({
      available: true,
      intent: "chat",
      sensitivity: { hasSensitiveData: true, maxRisk: "medium" }
    });

    expect(parseLocalClassificationOutput('{"intent":"run","confidence":0.91,"reason":"browser action"}')).toEqual({
      intent: "run",
      confidence: 0.91,
      reason: "browser action"
    });
    expect(mergeLocalClassification(settings, "Click the submit button", '{"intent":"run","confidence":0.8}')).toMatchObject({
      available: true,
      intent: "run",
      confidence: 0.8,
      fallbackReason: undefined
    });
  });
});
