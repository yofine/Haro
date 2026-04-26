import type { ExtensionSettings, Locale, ProviderSettings } from "./types";
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
