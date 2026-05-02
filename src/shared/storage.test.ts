import { describe, expect, it } from "vitest";
import { getActiveProvider, getDefaultLocale, normalizeSettings } from "./storage";
import type { LocalModelCacheBackend, LocalModelPurpose } from "./types";

describe("settings normalization", () => {
  it("uses the browser language as the default locale for new installs", () => {
    expect(getDefaultLocale("zh-CN")).toBe("zh");
    expect(getDefaultLocale("zh-Hant-TW")).toBe("zh");
    expect(getDefaultLocale("en-US")).toBe("en");
    expect(normalizeSettings({ locale: "zh" }).locale).toBe("zh");
  });

  it("does not create default provider profiles for a new install", () => {
    const settings = normalizeSettings({});

    expect(settings.providers).toEqual([]);
    expect(settings.localModels.enabled).toBe(false);
    expect(settings.localModels.profiles).toEqual([]);
    expect(settings.localModels.privacy.mode).toBe("redact");
    expect(settings.skills).toEqual([]);
    expect(settings.memories).toEqual([]);
    expect(settings.defaultProviderId).toBeUndefined();
    expect(settings.defaultModel).toBeUndefined();
  });

  it("normalizes stored agent memories", () => {
    const settings = normalizeSettings({
      memories: [
        { id: "m1", content: "Remember this", scope: "global", layer: "profile", enabled: true, source: "explicit", createdAt: "x", updatedAt: "x" },
        { id: "bad", content: "", scope: "global", layer: "profile", enabled: true, source: "manual", createdAt: "x", updatedAt: "x" }
      ]
    });

    expect(settings.memories).toEqual([
      expect.objectContaining({ id: "m1", content: "Remember this", scope: "global", source: "explicit" })
    ]);
  });

  it("preserves installed skills in standard SKILL.md format", () => {
    const settings = normalizeSettings({
      skills: [{
        id: "page-translator",
        name: "page-translator",
        description: "Translate visible page copy.",
        skillMarkdown: "---\nname: page-translator\ndescription: Translate visible page copy.\n---\nTranslate the page.",
        enabled: true,
        source: "skills.sh",
        sourceUrl: "https://skills.sh/acme/browser/page-translator"
      }]
    });

    expect(settings.skills[0]).toMatchObject({
      id: "page-translator",
      source: "skills.sh",
      skillMarkdown: expect.stringContaining("name: page-translator")
    });
  });

  it("selects the configured default provider and default model", () => {
    const settings = normalizeSettings({
      providers: [
        {
          id: "provider-a",
          name: "Primary",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          models: ["model-a", "model-b"],
          defaultModel: "model-a",
          enabled: true
        }
      ],
      defaultProviderId: "provider-a",
      defaultModel: "model-b"
    });

    expect(getActiveProvider(settings)?.defaultModel).toBe("model-b");
  });

  it("drops empty legacy default provider placeholders", () => {
    const settings = normalizeSettings({
      providers: [
        {
          id: "openai-default",
          name: "OpenAI",
          provider: "openai",
          apiKey: "",
          baseUrl: "https://api.openai.com/v1",
          models: ["gpt-4.1-mini"],
          defaultModel: "gpt-4.1-mini",
          enabled: false
        },
        {
          id: "custom",
          name: "My Provider",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          models: ["custom-model"],
          defaultModel: "custom-model",
          enabled: true
        }
      ]
    });

    expect(settings.providers.map((provider) => provider.id)).toEqual(["custom"]);
  });

  it("preserves blank provider names so users can name profiles themselves", () => {
    const settings = normalizeSettings({
      providers: [
        {
          id: "provider-blank",
          name: "",
          provider: "anthropic",
          apiKey: "",
          baseUrl: "https://api.anthropic.com/v1",
          models: ["claude-3-5-sonnet-latest"],
          defaultModel: "claude-3-5-sonnet-latest",
          enabled: true
        }
      ]
    });

    expect(settings.providers[0].name).toBe("");
  });

  it("normalizes provider profiles and keeps the default model inside the selected provider models", () => {
    const settings = normalizeSettings({
      providers: [
        {
          id: "provider-a",
          name: "Primary",
          provider: "openai",
          apiKey: " sk-test ",
          baseUrl: "https://models.example.com/v1/",
          models: ["", "model-a", "model-a", "model-b"],
          defaultModel: "missing-model",
          enabled: true
        },
        {
          id: "provider-b",
          name: "Backup",
          provider: "anthropic",
          apiKey: "sk-ant-test",
          baseUrl: "",
          models: [],
          defaultModel: "",
          enabled: true
        }
      ],
      defaultProviderId: "provider-a",
      defaultModel: "missing-model"
    });

    expect(settings.providers[0]).toMatchObject({
      baseUrl: "https://models.example.com/v1",
      models: ["model-a", "model-b"],
      defaultModel: "model-a"
    });
    expect(settings.providers[1]).toMatchObject({
      baseUrl: "https://api.anthropic.com/v1",
      models: ["claude-3-5-sonnet-latest"],
      defaultModel: "claude-3-5-sonnet-latest"
    });
    expect(settings.defaultProviderId).toBe("provider-a");
    expect(settings.defaultModel).toBe("model-a");
  });

  it("normalizes local model settings without enabling unloaded models", () => {
    const settings = normalizeSettings({
      localModels: {
        enabled: true,
        defaultProfileId: "local-a",
        profiles: [
          {
            id: "local-a",
            name: "  Local policy ",
            runtime: "webllm",
            modelId: "  Qwen2-0.5B-Instruct-q4f16_1-MLC ",
            enabled: true,
            loadState: "not-loaded",
            purposes: ["intent", "privacy", "privacy", "unknown" as LocalModelPurpose],
            defaultForPurposes: ["privacy", "simple-chat"],
            cacheBackend: "bad-cache" as LocalModelCacheBackend,
            temperature: 2,
            maxTokens: -10,
            createdAt: "",
            updatedAt: ""
          }
        ],
        privacy: {
          mode: "block",
          scanPageText: true,
          scanSelectedText: false,
          scanFormValues: true,
          blockHighConfidenceSecrets: true
        }
      }
    });

    expect(settings.localModels.enabled).toBe(false);
    expect(settings.localModels.defaultProfileId).toBe("local-a");
    expect(settings.localModels.profiles[0]).toMatchObject({
      id: "local-a",
      name: "Local policy",
      runtime: "webllm",
      modelId: "Qwen2-0.5B-Instruct-q4f16_1-MLC",
      enabled: false,
      loadState: "not-loaded",
      purposes: ["intent", "privacy"],
      defaultForPurposes: ["privacy"],
      cacheBackend: "indexeddb",
      temperature: 1,
      maxTokens: 256
    });
    expect(settings.localModels.privacy).toMatchObject({
      mode: "block",
      scanPageText: true,
      scanSelectedText: false,
      scanFormValues: true,
      blockHighConfidenceSecrets: true
    });
  });
});
