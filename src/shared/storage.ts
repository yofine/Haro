import type {
  ExtensionSettings,
  Locale,
  LocalModelCacheBackend,
  LocalModelLoadState,
  LocalModelPrivacySettings,
  LocalModelProfile,
  LocalModelPurpose,
  LocalModelSettings,
  PrivacyPolicyMode,
  ProviderSettings
} from "./types";
import { normalizeMemories } from "./memories";

function getBrowserLanguage(): string {
  if (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage) {
    return chrome.i18n.getUILanguage();
  }
  return globalThis.navigator?.language ?? "en";
}

export function getDefaultLocale(language = getBrowserLanguage()): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export const defaultSettings: ExtensionSettings = {
  locale: getDefaultLocale(),
  providers: [],
  defaultProviderId: undefined,
  defaultModel: undefined,
  gateway: { enabled: true },
  localModels: {
    enabled: false,
    defaultProfileId: undefined,
    profiles: [],
    privacy: {
      mode: "redact",
      scanPageText: true,
      scanSelectedText: true,
      scanFormValues: false,
      blockHighConfidenceSecrets: true
    }
  },
  skills: [],
  memories: [],
  permissions: [],
  callLogs: [],
  debugLogs: []
};

const defaultBaseUrls = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1"
} as const;

const defaultModels = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest"
} as const;

function normalizeBaseUrl(baseUrl: string | undefined, provider: ProviderSettings["provider"]): string {
  return (baseUrl?.trim() || defaultBaseUrls[provider]).replace(/\/+$/, "");
}

function normalizeModels(models: string[] | undefined, fallbackModel: string): string[] {
  const normalized = [...new Set((models ?? []).map((model) => model.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : [fallbackModel];
}

function ensureProvider(provider: Partial<ProviderSettings>, index: number): ProviderSettings {
  const providerType = provider.provider ?? "openai";
  const fallbackModel = defaultModels[providerType];
  const models = normalizeModels(provider.models, fallbackModel);
  const requestedDefaultModel = provider.defaultModel?.trim();
  const defaultModel = requestedDefaultModel && models.includes(requestedDefaultModel) ? requestedDefaultModel : models[0];
  return {
    id: provider.id || `${providerType}-${index + 1}`,
    name: provider.name ?? "",
    provider: providerType,
    apiKey: provider.apiKey || "",
    baseUrl: normalizeBaseUrl(provider.baseUrl, providerType),
    models,
    defaultModel,
    enabled: Boolean(provider.enabled)
  };
}

const validLocalPurposes: LocalModelPurpose[] = ["intent", "privacy", "simple-chat", "agent-policy"];
const validLocalLoadStates: LocalModelLoadState[] = ["not-loaded", "loading", "ready", "failed"];
const validCacheBackends: LocalModelCacheBackend[] = ["cache", "indexeddb"];
const validPrivacyModes: PrivacyPolicyMode[] = ["off", "redact", "block", "ask"];

function normalizeLocalPurposes(value: unknown, fallback: LocalModelPurpose[]): LocalModelPurpose[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = [...new Set(value.filter((purpose): purpose is LocalModelPurpose => validLocalPurposes.includes(purpose as LocalModelPurpose)))];
  return normalized.length ? normalized : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, min), max) : fallback;
}

function normalizeLocalProfile(input: Partial<LocalModelProfile>, index: number): LocalModelProfile | undefined {
  const modelId = input.modelId?.trim();
  if (!modelId) return undefined;

  const purposes = normalizeLocalPurposes(input.purposes, ["intent", "privacy"]);
  const defaultForPurposes = normalizeLocalPurposes(input.defaultForPurposes, purposes)
    .filter((purpose) => purposes.includes(purpose));
  const loadState = validLocalLoadStates.includes(input.loadState as LocalModelLoadState) ? input.loadState as LocalModelLoadState : "not-loaded";
  const isReady = loadState === "ready";
  const now = new Date().toISOString();

  return {
    id: input.id?.trim() || `local-model-${index + 1}`,
    name: input.name?.trim() || modelId,
    runtime: "webllm",
    modelId,
    enabled: Boolean(input.enabled) && isReady,
    loadState,
    purposes,
    defaultForPurposes,
    cacheBackend: validCacheBackends.includes(input.cacheBackend as LocalModelCacheBackend) ? input.cacheBackend as LocalModelCacheBackend : "indexeddb",
    temperature: clampNumber(input.temperature, 0, 0, 1),
    maxTokens: Math.round(normalizePositiveNumber(input.maxTokens, 256, 16, 2048)),
    contextWindowHint: typeof input.contextWindowHint === "number" && input.contextWindowHint > 0 ? Math.round(input.contextWindowHint) : undefined,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    lastLoadedAt: input.lastLoadedAt,
    lastError: input.lastError
  };
}

function normalizePrivacySettings(input: Partial<LocalModelPrivacySettings> | undefined): LocalModelPrivacySettings {
  return {
    ...defaultSettings.localModels.privacy,
    ...input,
    mode: validPrivacyModes.includes(input?.mode as PrivacyPolicyMode) ? input?.mode as PrivacyPolicyMode : defaultSettings.localModels.privacy.mode,
    scanPageText: input?.scanPageText ?? defaultSettings.localModels.privacy.scanPageText,
    scanSelectedText: input?.scanSelectedText ?? defaultSettings.localModels.privacy.scanSelectedText,
    scanFormValues: input?.scanFormValues ?? defaultSettings.localModels.privacy.scanFormValues,
    blockHighConfidenceSecrets: input?.blockHighConfidenceSecrets ?? defaultSettings.localModels.privacy.blockHighConfidenceSecrets
  };
}

function normalizeLocalModels(input: Partial<LocalModelSettings> | undefined): LocalModelSettings {
  const profiles = (input?.profiles ?? [])
    .map(normalizeLocalProfile)
    .filter((profile): profile is LocalModelProfile => Boolean(profile));
  const defaultProfile = profiles.find((profile) => profile.id === input?.defaultProfileId)
    ?? profiles.find((profile) => profile.enabled)
    ?? profiles[0];
  const hasReadyEnabledProfile = Boolean(defaultProfile?.enabled && defaultProfile.loadState === "ready");

  return {
    enabled: Boolean(input?.enabled) && hasReadyEnabledProfile,
    defaultProfileId: defaultProfile?.id,
    profiles,
    privacy: normalizePrivacySettings(input?.privacy)
  };
}

export function normalizeSettings(input: Partial<ExtensionSettings>): ExtensionSettings {
  const providers = (input.providers ?? [])
    .filter((provider) => {
      const isLegacyPlaceholder = provider.id === "openai-default" || provider.id === "anthropic-default";
      return !isLegacyPlaceholder || Boolean(provider.apiKey?.trim());
    })
    .map(ensureProvider);
  const active = providers.find((provider) => provider.id === input.defaultProviderId) ?? providers.find((provider) => provider.enabled) ?? providers[0];
  const requestedDefaultModel = input.defaultModel?.trim();
  const defaultModel = active && requestedDefaultModel && active.models.includes(requestedDefaultModel)
    ? requestedDefaultModel
    : active?.defaultModel;
  return {
    ...defaultSettings,
    ...input,
    locale: input.locale === "zh" || input.locale === "en" ? input.locale : getDefaultLocale(),
    providers,
    localModels: normalizeLocalModels(input.localModels),
    skills: Array.isArray(input.skills) ? input.skills.filter((skill) => (
      skill
      && typeof skill.id === "string"
      && typeof skill.name === "string"
      && typeof skill.description === "string"
      && typeof skill.skillMarkdown === "string"
    )) : [],
    memories: normalizeMemories(input.memories),
    defaultProviderId: active?.id,
    defaultModel
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(null);
  return normalizeSettings(stored as Partial<ExtensionSettings>);
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set(settings);
}

export async function updateProviders(providers: ProviderSettings[]): Promise<ExtensionSettings> {
  const settings = await getSettings();
  const next = { ...settings, providers };
  await saveSettings(next);
  return next;
}

export function getActiveProvider(settings: ExtensionSettings): ProviderSettings | undefined {
  const defaultProvider = settings.providers.find((provider) => provider.id === settings.defaultProviderId);
  const selected = defaultProvider?.enabled && defaultProvider.apiKey.trim().length > 0
    ? defaultProvider
    : settings.providers.find((provider) => provider.enabled && provider.apiKey.trim().length > 0);

  if (!selected) return undefined;

  return {
    ...selected,
    defaultModel: settings.defaultProviderId === selected.id && settings.defaultModel ? settings.defaultModel : selected.defaultModel
  };
}
