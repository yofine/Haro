import { classifyTaskIntent, runAgentTask, runMemoryChat, runPageChat } from "../agent/runtime";
import { builtInSkills, installSkillFromUrl, mergeSkills, parseSkillMarkdown, skillActionToBenchmarkRequest } from "../agent/skills";
import { runBenchmarkTool, sanitizeReportHtml } from "./browserTools";
import { createDebuggerTools, type DebuggerTarget } from "./debuggerTools";
import { callModel } from "../model-gateway";
import { appendCallLog, createCallLog } from "../shared/callLogs";
import { appendDebugLog, createDebugLog } from "../shared/debugLogs";
import { createMemory, extractExplicitMemoryContent, getRelevantMemories, parseAutoMemoryResponse } from "../shared/memories";
import {
  buildGatewayStatus,
  createGatewayError,
  createGatewaySuccess,
  debuggerAccessScopes,
  GatewayProtocolError,
  ensureGatewayAccess,
  listGatewayModels,
  normalizeGatewayError,
  normalizeRequestedScopes,
  resolveApprovedScopes,
  requiredRunScopes
} from "../shared/gateway";
import { canUseDebuggerControl, grantSitePermission, revokeSitePermission, touchSitePermission } from "../shared/permissions";
import { getActiveProvider, getSettings, normalizeSettings, saveSettings } from "../shared/storage";
import type {
  BrowserAgentRequest,
  BrowserAgentResponse,
  BenchmarkToolRequest,
  BenchmarkToolResult,
  ChatMessage,
  ConversationMemory,
  AgentAction,
  AgentControlMode,
  DebuggerAction,
  DebuggerActionResult,
  DomAction,
  DomActionResult,
  DomObservation,
  ExtensionSettings,
  PendingAccessRequest,
  ProviderSettings,
  Scope
} from "../shared/types";

type PendingAccessResolver = (result: { granted: boolean; origin: string; scopes: Scope[]; autoRun: boolean }) => void;
type ChromeDebuggerTargetInfo = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  tabId?: number;
  attached?: boolean;
  extensionId?: string;
  faviconUrl?: string;
};
type ResolvedDebuggerTarget = {
  target: DebuggerTarget;
  url?: string;
  label: string;
};
type ExtensionFrameDiagnostic = {
  tagName: string;
  src: string;
  extensionId: string;
  ownedByThisExtension: boolean;
};

const pendingAccessRequests = new Map<string, {
  request: PendingAccessRequest;
  resolve: PendingAccessResolver;
}>();
let lastRegularTabId: number | undefined;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

function isHttpUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\//.test(url));
}

function tabUrlForDiagnostics(tab: chrome.tabs.Tab): string {
  const pending = tab.pendingUrl ? ` pending=${tab.pendingUrl}` : "";
  return `${tab.url || "unknown URL"}${pending}`;
}

function canInjectIntoTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.id && isHttpUrl(tab.url) && (!tab.pendingUrl || isHttpUrl(tab.pendingUrl)));
}

async function getTabIfRegular(tabId: number | undefined): Promise<chrome.tabs.Tab | undefined> {
  if (!tabId) return undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    return canInjectIntoTab(tab) ? tab : undefined;
  } catch {
    return undefined;
  }
}

async function findActiveRegularTabInNormalWindows(): Promise<chrome.tabs.Tab | undefined> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  for (const window of windows) {
    const tab = window.tabs?.find((entry) => entry.active && canInjectIntoTab(entry));
    if (tab) return tab;
  }
  return undefined;
}

function rememberRegularTab(tab: chrome.tabs.Tab): chrome.tabs.Tab {
  if (tab.id && canInjectIntoTab(tab)) lastRegularTabId = tab.id;
  return tab;
}

function isMissingReceiverError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}

async function sendContentMessage(tabId: number, message: unknown) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function ensureContentScript(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) throw new Error("No active tab");
  if (!canInjectIntoTab(tab)) {
    throw new Error("Agenticify can only read regular http/https webpages. Open a webpage and try again.");
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["assets/content.js"]
  });
}

async function observeTab(tab: chrome.tabs.Tab): Promise<DomObservation> {
  if (!tab.id) throw new Error("No active tab");

  let response: { ok?: boolean; observation?: DomObservation } | undefined;
  try {
    response = await sendContentMessage(tab.id, { target: "agenticify-content", type: "observe" });
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await ensureContentScript(tab);
    response = await sendContentMessage(tab.id, { target: "agenticify-content", type: "observe" });
  }

  if (!response?.ok || !response.observation) throw new Error("Could not observe active page");
  return response.observation;
}

function isDomAction(action: DomAction | { type: string }): action is DomAction {
  return action.type === "click" || action.type === "type" || action.type === "scroll";
}

async function actTab(tab: chrome.tabs.Tab, action: DomAction | { type: string }): Promise<DomActionResult> {
  if (!isDomAction(action)) {
    return {
      ok: false,
      status: action.type === "debugger" ? "blocked" : "failed",
      message: action.type === "debugger"
        ? "Advanced control is gated in BrowserAgent Gateway v1."
        : "This page action is not operable through DOM control."
    };
  }

  if (!tab.id) throw new Error("No active tab");

  let response: { ok?: boolean; result?: DomActionResult } | undefined;
  try {
    response = await sendContentMessage(tab.id, { target: "agenticify-content", type: "dom-action", action });
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await ensureContentScript(tab);
    response = await sendContentMessage(tab.id, { target: "agenticify-content", type: "dom-action", action });
  }

  if (!response?.ok || !response.result) {
    return { ok: false, status: "failed", message: "Could not execute DOM action on the active page" };
  }
  return response.result;
}

async function actAgentTab(tab: chrome.tabs.Tab, action: AgentAction): Promise<DomActionResult> {
  if (action.type === "read") {
    await observeTab(tab);
    return { ok: true, status: "success", message: "Page context refreshed" };
  }
  if (action.type === "debugger") {
    return { ok: false, status: "needs_confirmation", message: action.reason || "Debugger mode requires explicit permission" };
  }
  if (action.type === "skill") {
    if (action.skillId === "builtin/skill-creator") {
      const markdown = typeof action.input?.skillMarkdown === "string" ? action.input.skillMarkdown : "";
      const draft = parseSkillMarkdown(markdown, { source: "manual" });
      return {
        ok: false,
        status: "needs_confirmation",
        message: "Review and install this skill.",
        skillDraft: draft
      };
    }
    const request = skillActionToBenchmarkRequest(action);
    if (!request) return { ok: false, status: "failed", message: `Skill ${action.skillId} is not executable.` };
    const result = await runBenchmarkToolForActiveTab(request, tab.id);
    return { ok: true, status: "success", message: `Skill ${action.skillId} completed: ${result.title}`, benchmarkResult: result };
  }
  return actTab(tab, action);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const normalWindowTab = await findActiveRegularTabInNormalWindows();
  if (normalWindowTab) return rememberRegularTab(normalWindowTab);

  const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focusedTab?.id && canInjectIntoTab(focusedTab)) return rememberRegularTab(focusedTab);

  const pageTab = await getTabIfRegular(lastRegularTabId);
  if (!pageTab?.id) {
    throw new Error("No active regular http/https tab. Select a webpage and try again.");
  }
  return rememberRegularTab(pageTab);
}

async function getTargetTab(tabId?: number): Promise<chrome.tabs.Tab> {
  const tab = await getTabIfRegular(tabId);
  if (tab) return rememberRegularTab(tab);
  return getActiveTab();
}

async function persistLog(settings: ExtensionSettings, logInput: Parameters<typeof createCallLog>[0], debugTitle?: string, debugDetails?: unknown) {
  const log = createCallLog(logInput);
  const next = {
    ...settings,
    callLogs: appendCallLog(settings.callLogs, log),
    debugLogs: debugTitle ? appendDebugLog(settings.debugLogs, createDebugLog(debugTitle, debugDetails, log.id)) : settings.debugLogs
  };
  await saveSettings(next);
  return { settings: next, log };
}

async function persistDebugLog(title: string, details: unknown) {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    debugLogs: appendDebugLog(settings.debugLogs, createDebugLog(title, details))
  });
}

function tabOrigin(tab: chrome.tabs.Tab): string {
  const url = tab.url;
  if (!url || !isHttpUrl(url) || (tab.pendingUrl && !isHttpUrl(tab.pendingUrl))) {
    throw new Error("Debugger mode can only control regular http/https webpages in the active tab.");
  }
  return new URL(url).origin;
}

function tabOriginSafe(tab: chrome.tabs.Tab): string | undefined {
  return tab.url && isHttpUrl(tab.url) ? new URL(tab.url).origin : undefined;
}

async function assertDebuggerTargetTab(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (!tab.id) throw new Error("No active tab");
  const latest = await chrome.tabs.get(tab.id);
  if (!canInjectIntoTab(latest)) {
    throw new Error(`Debugger target is not a regular webpage: ${tabUrlForDiagnostics(latest)}`);
  }
  return latest;
}

function requireDebuggerPermission(settings: ExtensionSettings, tab: chrome.tabs.Tab): string {
  const origin = tabOrigin(tab);
  if (!canUseDebuggerControl(settings.permissions, origin)) {
    throw new Error(`Debugger mode requires explicit debugger.control authorization for ${origin}.`);
  }
  return origin;
}

async function getDebuggerTargets(): Promise<ChromeDebuggerTargetInfo[]> {
  return new Promise((resolve) => {
    if (!chrome.debugger?.getTargets) {
      resolve([]);
      return;
    }
    chrome.debugger.getTargets((targets) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve((targets ?? []) as ChromeDebuggerTargetInfo[]);
    });
  });
}

function debuggerTargetMatchesTab(target: ChromeDebuggerTargetInfo, tab: chrome.tabs.Tab): boolean {
  if (!tab.id || target.tabId !== tab.id || !target.id) return false;
  return isHttpUrl(target.url);
}

async function resolveDebuggerPageTarget(tab: chrome.tabs.Tab): Promise<ResolvedDebuggerTarget> {
  if (!tab.id) throw new Error("No active tab");
  const targets = await getDebuggerTargets();
  const pageTarget = targets.find((target) => debuggerTargetMatchesTab(target, tab) && target.type === "page")
    ?? targets.find((target) => debuggerTargetMatchesTab(target, tab));

  if (pageTarget?.id) {
    const url = pageTarget.url ?? tab.url;
    return {
      target: { targetId: pageTarget.id },
      url,
      label: `${url ?? tabUrlForDiagnostics(tab)} target=${pageTarget.id}`
    };
  }

  return {
    target: { tabId: tab.id },
    url: tab.url,
    label: tabUrlForDiagnostics(tab)
  };
}

function canUseDebuggerForTab(settings: ExtensionSettings, tab: chrome.tabs.Tab): boolean {
  if (!tab.url || !/^https?:\/\//.test(tab.url)) return false;
  return canUseDebuggerControl(settings.permissions, new URL(tab.url).origin);
}

async function runDebuggerAction(action: DebuggerAction, tabId?: number): Promise<DebuggerActionResult> {
  const tab = await assertDebuggerTargetTab(await getTargetTab(tabId));
  if (!tab.id) throw new Error("No active tab");
  const settings = await getSettings();
  const origin = requireDebuggerPermission(settings, tab);
  const debuggee = await resolveDebuggerPageTarget(tab);
  const tools = createDebuggerTools(debuggee.target, undefined, debuggee.url, debuggee.label);

  if (action.type === "attach" || action.type === "detach") {
    try {
      const result = await tools.run(action);
      await persistDebugLog(`Debugger ${action.type}`, { origin, tabId: tab.id, status: "success" });
      return result;
    } catch (error) {
      const diagnostics = await createDebuggerAttachDiagnostics(tab, debuggee, error);
      const attachError = createDebuggerAttachError(error, diagnostics.suspectedBlockingExtensionTargets);
      await persistDebugLog(`Debugger ${action.type}`, {
        origin,
        tabId: tab.id,
        status: "failed",
        error: attachError.message,
        originalError: error instanceof Error ? error.message : "Unknown debugger error",
        diagnostics
      });
      throw attachError;
    }
  }

  return tools.run(action);
}

function benchmarkNeedsModel(request: BenchmarkToolRequest): boolean {
  return request.type === "report" || request.type === "rewrite" || request.type === "fill-form";
}

function extensionIdFromUrl(url: string | undefined): string | undefined {
  return url?.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
}

function isExternalExtensionTarget(target: ChromeDebuggerTargetInfo): boolean {
  const extensionId = target.extensionId ?? extensionIdFromUrl(target.url);
  return Boolean(extensionId && extensionId !== chrome.runtime.id);
}

function extensionTargets(targets: ChromeDebuggerTargetInfo[]): ChromeDebuggerTargetInfo[] {
  return targets.filter((target) => target.url?.startsWith("chrome-extension://"));
}

function suspectedBlockingExtensionTargets(tab: chrome.tabs.Tab, targets: ChromeDebuggerTargetInfo[]): ChromeDebuggerTargetInfo[] {
  const externalTargets = extensionTargets(targets).filter(isExternalExtensionTarget);
  const tabFavicon = tab.favIconUrl;
  const faviconMatches = tabFavicon
    ? externalTargets.filter((target) => target.faviconUrl === tabFavicon)
    : [];
  return faviconMatches.length ? faviconMatches : externalTargets;
}

function createDebuggerAttachError(error: unknown, suspectedTargets: ChromeDebuggerTargetInfo[]): Error {
  const original = error instanceof Error ? error.message : "Unknown debugger error";
  if (!/Cannot access a chrome-extension:\/\/ URL of different extension/i.test(original) || !suspectedTargets.length) {
    return error instanceof Error ? error : new Error(original);
  }

  const extensionIds = Array.from(new Set(suspectedTargets.map((target) => target.extensionId ?? extensionIdFromUrl(target.url)).filter(Boolean)));
  const suffix = extensionIds.length ? ` Suspected extension id(s): ${extensionIds.join(", ")}.` : "";
  return new Error(`Chrome blocked CDP attach to the connected tab because another extension exposes chrome-extension:// debugger targets in this browser context.${suffix} Disable the conflicting extension and retry. Original error: ${original}`);
}

async function findExtensionFramesInPage(tab: chrome.tabs.Tab): Promise<ExtensionFrameDiagnostic[]> {
  if (!tab.id) return [];
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [chrome.runtime.id],
      func: (ownExtensionId: string) => {
        const extensionUrlPattern = /^chrome-extension:\/\/([^/]+)/;
        return Array.from(document.querySelectorAll("iframe[src], frame[src], embed[src], object[data]")).flatMap((element) => {
          const source = element.getAttribute("src") || element.getAttribute("data") || "";
          const match = extensionUrlPattern.exec(source);
          if (!match) return [];
          return [{
            tagName: element.tagName.toLowerCase(),
            src: source,
            extensionId: match[1],
            ownedByThisExtension: match[1] === ownExtensionId
          }];
        });
      }
    });
    return Array.isArray(result) ? result as ExtensionFrameDiagnostic[] : [];
  } catch {
    return [];
  }
}

async function createDebuggerAttachDiagnostics(tab: chrome.tabs.Tab, debuggee?: ResolvedDebuggerTarget, error?: unknown) {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const targets = await getDebuggerTargets();
  const extensionFramesInPage = await findExtensionFramesInPage(tab);
  const allExtensionTargets = extensionTargets(targets);
  const suspectedTargets = suspectedBlockingExtensionTargets(tab, targets);
  return {
    connectedTab: {
      id: tab.id,
      url: tab.url,
      pendingUrl: tab.pendingUrl,
      favIconUrl: tab.favIconUrl,
      active: tab.active,
      windowId: tab.windowId
    },
    activeTab: activeTab ? {
      id: activeTab.id,
      url: activeTab.url,
      pendingUrl: activeTab.pendingUrl,
      active: activeTab.active,
      windowId: activeTab.windowId
    } : undefined,
    resolvedDebuggee: debuggee,
    matchingTargets: targets.filter((target) => target.tabId === tab.id),
    extensionTargets: allExtensionTargets,
    suspectedBlockingExtensionTargets: suspectedTargets,
    extensionFramesInPage,
    error: error instanceof Error ? error.message : error
  };
}

async function runBenchmarkToolForActiveTab(request: BenchmarkToolRequest, tabId?: number): Promise<BenchmarkToolResult> {
  const tab = await assertDebuggerTargetTab(await getTargetTab(tabId));
  if (!tab.id) throw new Error("No active tab");
  const settings = await getSettings();
  const origin = requireDebuggerPermission(settings, tab);
  const provider = benchmarkNeedsModel(request) ? getActiveProvider(settings) : undefined;
  if (benchmarkNeedsModel(request) && !provider) {
    throw new Error("Configure an enabled OpenAI or Anthropic provider first.");
  }

  const debuggee = await resolveDebuggerPageTarget(tab);
  const tools = createDebuggerTools(debuggee.target, undefined, debuggee.url, debuggee.label);
  let attached = false;
  try {
    await tools.attach();
    attached = true;
    const result = await runBenchmarkTool({
      request,
      tools,
      modelGateway: {
        chat: (messages) => {
          if (!provider) throw new Error("This benchmark tool does not use a model.");
          return callModel({ settings: provider, request: { messages, timeoutMs: 60_000 } });
        }
      }
    });
    await persistDebugLog("Benchmark tool", { origin, tabId: tab.id, request, resultType: result.type, status: "success" });
    return result;
  } catch (error) {
    const diagnostics = await createDebuggerAttachDiagnostics(tab, debuggee, error);
    const attachError = createDebuggerAttachError(error, diagnostics.suspectedBlockingExtensionTargets);
    await persistDebugLog("Benchmark tool", {
      origin,
      tabId: tab.id,
      request,
      status: "failed",
      error: attachError.message,
      originalError: error instanceof Error ? error.message : "Unknown benchmark tool error",
      diagnostics
    });
    throw attachError;
  } finally {
    if (attached) {
      await tools.detach().catch(() => undefined);
    }
  }
}

async function observeDebuggerTab(tab: chrome.tabs.Tab): Promise<DomObservation> {
  tab = await assertDebuggerTargetTab(tab);
  if (!tab.id) throw new Error("No active tab");
  const settings = await getSettings();
  const origin = requireDebuggerPermission(settings, tab);
  const debuggee = await resolveDebuggerPageTarget(tab);
  const tools = createDebuggerTools(debuggee.target, undefined, debuggee.url, debuggee.label);
  let attached = false;

  try {
    await tools.attach();
    attached = true;
    await persistDebugLog("Debugger attach", { origin, tabId: tab.id, status: "success", purpose: "snapshot" });
    const result = await tools.snapshot();
    if (!result.observation) throw new Error("Debugger snapshot did not return page data.");
    return result.observation;
  } catch (error) {
    const diagnostics = await createDebuggerAttachDiagnostics(tab, debuggee, error);
    const attachError = createDebuggerAttachError(error, diagnostics.suspectedBlockingExtensionTargets);
    if (!attached) {
      await persistDebugLog("Debugger attach", {
        origin,
        tabId: tab.id,
        status: "failed",
        purpose: "snapshot",
        error: attachError.message,
        originalError: error instanceof Error ? error.message : "Unknown debugger error",
        diagnostics
      });
    }
    throw attachError;
  } finally {
    if (attached) {
      try {
        await tools.detach();
        await persistDebugLog("Debugger detach", { origin, tabId: tab.id, status: "success", purpose: "snapshot" });
      } catch (error) {
        await persistDebugLog("Debugger detach", {
          origin,
          tabId: tab.id,
          status: "failed",
          purpose: "snapshot",
          error: error instanceof Error ? error.message : "Unknown debugger error"
        });
      }
    }
  }
}

async function persistAccessLog(
  origin: string,
  status: "success" | "denied" | "revoked",
  summary: string,
  settingsInput?: ExtensionSettings
) {
  const settings = settingsInput ?? await getSettings();
  const log = createCallLog({
    source: "gateway",
    origin,
    type: "access",
    status,
    summary
  });
  const next = { ...settings, callLogs: appendCallLog(settings.callLogs, log) };
  await saveSettings(next);
  return next;
}

async function runChat(messages: ChatMessage[], source: "sidebar" | "gateway", origin?: string) {
  const settings = await getSettings();
  const provider = getActiveProvider(settings);
  if (!provider) throw new Error("Configure an enabled OpenAI or Anthropic provider first.");
  const result = await callModel({ settings: provider, request: { messages, timeoutMs: 60_000 } });
  await persistLog(settings, {
    source,
    origin,
    type: "chat",
    model: result.model,
    status: "success",
    summary: messages.at(-1)?.content.slice(0, 120)
  }, "Model chat", { origin, provider: provider.provider, model: result.model, usage: result.usage });
  return result;
}

function getRunProvider(settings: ExtensionSettings, providerId?: string, model?: string): ProviderSettings | undefined {
  const selected = providerId
    ? settings.providers.find((provider) => provider.id === providerId && provider.enabled && provider.apiKey.trim())
    : getActiveProvider(settings);
  if (!selected) return undefined;
  return model ? { ...selected, defaultModel: model } : selected;
}

function normalizeSkillIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function enrichConversationMemory(memory: ConversationMemory | undefined, settings: ExtensionSettings, origin?: string): ConversationMemory {
  return {
    turns: memory?.turns ?? [],
    memories: getRelevantMemories(settings.memories, origin)
  };
}

async function persistAutomaticMemories(settings: ExtensionSettings, provider: ProviderSettings, task: string, finalText: string, origin?: string): Promise<ExtensionSettings> {
  if (!finalText.trim()) return settings;
  const response = await callModel({
    settings: provider,
    request: {
      timeoutMs: 30_000,
      messages: [
        {
          role: "system",
          content: [
            "Extract durable memory candidates for BrowserAgent.",
            "Return strict JSON array only. Each item: {\"content\":\"...\",\"layer\":\"profile|site|interaction\",\"scope\":\"global|site\"}.",
            "Only include stable user preferences, durable user facts, site-specific facts, or reusable interaction context.",
            "Return [] for one-off requests, transient page content, secrets, passwords, tokens, payment data, or uncertain facts.",
            "Limit to 3 concise items."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Origin: ${origin || "(none)"}`,
            `User task: ${task}`,
            `Assistant final answer: ${finalText}`
          ].join("\n\n")
        }
      ]
    }
  }).catch(() => undefined);
  if (!response?.text) return settings;
  const candidates = parseAutoMemoryResponse(response.text, origin);
  if (!candidates.length) return settings;
  const existingKeys = new Set(settings.memories.map((memory) => `${memory.layer}\n${memory.origin || ""}\n${memory.content.toLowerCase()}`));
  const fresh = candidates.filter((memory) => {
    const key = `${memory.layer}\n${memory.origin || ""}\n${memory.content.toLowerCase()}`;
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  if (!fresh.length) return settings;
  const next = { ...settings, memories: [...fresh, ...settings.memories] };
  await saveSettings(next);
  return next;
}

async function runTask(
  task: string,
  source: "sidebar" | "gateway",
  origin?: string,
  mode: AgentControlMode = "dom",
  providerId?: string,
  model?: string,
  tabId?: number,
  memory?: ConversationMemory,
  skillIds: string[] = []
) {
  const settings = await getSettings();
  const provider = getRunProvider(settings, providerId, model);
  if (!provider) throw new Error("Configure an enabled OpenAI or Anthropic provider first.");
  const selectedSkillIds = normalizeSkillIds(skillIds);
  const intent = mode === "debugger" || selectedSkillIds.length ? "run" : classifyTaskIntent(task);
  if (intent === "memory") {
    const explicitMemory = extractExplicitMemoryContent(task);
    const memoryEntry = explicitMemory ? createMemory({ content: explicitMemory, scope: origin ? "site" : "global", origin }) : undefined;
    const nextSettings = memoryEntry
      ? { ...settings, memories: [memoryEntry, ...settings.memories.filter((entry) => entry.content !== memoryEntry.content || entry.origin !== memoryEntry.origin)] }
      : settings;
    if (memoryEntry) await saveSettings(nextSettings);
    const result = await runMemoryChat({
      task,
      memory: enrichConversationMemory(memory, nextSettings, origin),
      modelGateway: {
        chat: (messages) => callModel({ settings: provider, request: { messages, timeoutMs: 60_000 } })
      }
    });
    await persistLog(nextSettings, {
      source,
      origin,
      type: "chat",
      model: provider.defaultModel,
      status: "success",
      summary: task.slice(0, 120)
    }, "Agent memory chat", { origin, task, intent, events: result.events });
    return result;
  }

  const tab = await getTargetTab(tabId);
  if (intent === "chat") {
    const observation = await observeTab(tab);
    const result = await runPageChat({
      task,
      observation,
      memory: enrichConversationMemory(memory, settings, observation.origin),
      modelGateway: {
        chat: (messages) => callModel({ settings: provider, request: { messages, timeoutMs: 60_000 } })
      }
    });
    const nextSettings = await persistAutomaticMemories(settings, provider, task, result.finalText, observation.origin);
    await persistLog(nextSettings, {
      source,
      origin: origin ?? observation.origin,
      type: "chat",
      model: provider.defaultModel,
      status: "success",
      summary: task.slice(0, 120)
    }, "Agent page chat", { origin: origin ?? observation.origin, task, intent, events: result.events });
    return result;
  }

  const observe = mode === "debugger"
    ? () => observeDebuggerTab(tab)
    : () => observeTab(tab);
  const result = await runAgentTask({
    task,
    mode,
    observe,
    act: (action) => actAgentTab(tab, action),
    modelGateway: {
      chat: (messages) => callModel({ settings: provider, request: { messages, timeoutMs: 60_000 } })
    },
    skills: mergeSkills(settings.skills),
    skillIds: selectedSkillIds,
    memory: enrichConversationMemory(memory, settings, origin ?? tabOriginSafe(tab)),
    maxSteps: 3
  });
  const runOrigin = origin ?? tabOriginSafe(tab);
  const nextSettings = await persistAutomaticMemories(settings, provider, task, result.finalText, runOrigin);
  await persistLog(nextSettings, {
    source,
    origin: runOrigin,
    type: "run",
    model: provider.defaultModel,
    status: "success",
    summary: task.slice(0, 120)
  }, "Agent run", { origin: runOrigin, task, mode, intent, events: result.events });
  return result;
}

async function authorizeGateway(origin: string | undefined, scopes: Scope[], requireAutoRun: boolean) {
  const settings = await getSettings();
  try {
    ensureGatewayAccess(settings, origin, scopes, requireAutoRun);
  } catch (error) {
    if (origin) {
      await persistLog(settings, { source: "gateway", origin, type: scopes.includes("agent.run") ? "run" : "chat", status: "denied" });
    }
    throw error;
  }
  if (!origin) return;
  await saveSettings({ ...settings, permissions: touchSitePermission(settings.permissions, origin) });
}

function assertChatPayload(payload: unknown): asserts payload is { messages: ChatMessage[] } {
  const messages = (payload as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.some((message) => (
    !message
    || typeof message !== "object"
    || !["system", "user", "assistant"].includes((message as ChatMessage).role)
    || typeof (message as ChatMessage).content !== "string"
  ))) {
    throw new GatewayProtocolError("invalid_request", "Invalid chat payload.");
  }
}

function assertRunPayload(payload: unknown): asserts payload is { task: string; mode?: "dom" | "debugger" | "auto" } {
  const candidate = payload as { task?: unknown; mode?: unknown };
  if (typeof candidate?.task !== "string" || !candidate.task.trim()) {
    throw new GatewayProtocolError("invalid_request", "Invalid run payload.");
  }
  if (candidate.mode !== undefined && !["dom", "debugger", "auto"].includes(String(candidate.mode))) {
    throw new GatewayProtocolError("invalid_request", "Invalid run mode.");
  }
}

function openAccessRequestPage(requestId: string) {
  const url = chrome.runtime.getURL(`options.html?accessRequest=${encodeURIComponent(requestId)}`);
  if (!chrome.windows?.create) {
    return chrome.tabs.create({ url });
  }
  return chrome.windows.create({
    url,
    type: "popup",
    width: 560,
    height: 680,
    focused: true
  }).catch(() => chrome.tabs.create({ url }));
}

async function requestSiteAccess(
  requestId: string,
  origin: string,
  payload: BrowserAgentRequest["payload"]
) {
  const accessPayload = payload as { appName?: string; scopes?: unknown; reason?: string; autoRun?: boolean } | undefined;
  const scopes = normalizeRequestedScopes(accessPayload?.scopes ?? ["model.chat"]);
  const request: PendingAccessRequest = {
    id: requestId,
    origin,
    appName: accessPayload?.appName,
    scopes,
    reason: accessPayload?.reason,
    requestedAutoRun: Boolean(accessPayload?.autoRun),
    createdAt: new Date().toISOString()
  };

  const result = new Promise<{ granted: boolean; origin: string; scopes: Scope[]; autoRun: boolean }>((resolve) => {
    pendingAccessRequests.set(requestId, { request, resolve });
  });

  await openAccessRequestPage(requestId);
  return result;
}

async function openSidebarDebuggerAccessRequest() {
  const tab = await getActiveTab();
  const origin = tabOrigin(tab);
  const requestId = crypto.randomUUID();
  const request: PendingAccessRequest = {
    id: requestId,
    origin,
    appName: "Agenticify Sidebar",
    scopes: debuggerAccessScopes(),
    reason: "Enable debugger mode for the current active tab.",
    requestedAutoRun: true,
    createdAt: new Date().toISOString()
  };

  pendingAccessRequests.set(requestId, { request, resolve: () => undefined });
  await openAccessRequestPage(requestId);
  return request;
}

async function grantCurrentSiteDebuggerAccess(tabId?: number) {
  const tab = await getTargetTab(tabId);
  const origin = tabOrigin(tab);
  const settings = await getSettings();
  const permissions = grantSitePermission(settings.permissions, {
    origin,
    appName: "Agenticify Sidebar",
    scopes: debuggerAccessScopes(),
    autoRun: true
  });
  await persistAccessLog(origin, "success", "Site Access granted with auto-run and debugger control", { ...settings, permissions });
  return { granted: true, origin, scopes: debuggerAccessScopes(), autoRun: true };
}

async function resolveSiteAccessRequest(id: string, approved: boolean, allowAutoRun: boolean, allowDebuggerControl: boolean) {
  const pending = pendingAccessRequests.get(id);
  if (!pending) throw new Error("Access request expired");

  pendingAccessRequests.delete(id);
  const { request, resolve } = pending;
  const settings = await getSettings();

  if (!approved) {
    await persistAccessLog(request.origin, "denied", "Site Access denied", settings);
    const result = { granted: false, origin: request.origin, scopes: request.scopes, autoRun: false };
    resolve(result);
    return result;
  }

  const autoRun = request.requestedAutoRun && allowAutoRun;
  const scopes = resolveApprovedScopes(request.scopes, allowDebuggerControl);
  const permissions = grantSitePermission(settings.permissions, {
    origin: request.origin,
    appName: request.appName,
    scopes,
    autoRun
  });
  await persistAccessLog(
    request.origin,
    "success",
    `Site Access granted${autoRun ? " with auto-run" : ""}${scopes.includes("debugger.control") ? " and debugger control" : ""}`,
    { ...settings, permissions }
  );

  const result = { granted: true, origin: request.origin, scopes, autoRun };
  resolve(result);
  return result;
}

async function revokeSiteAccess(origin: string) {
  const settings = await getSettings();
  const permissions = revokeSitePermission(settings.permissions, origin);
  await persistAccessLog(origin, "revoked", "Site Access revoked", { ...settings, permissions });
  return { ok: true };
}

async function installSkill(url: string) {
  const settings = await getSettings();
  const skill = await installSkillFromUrl(url);
  const skills = [skill, ...settings.skills.filter((entry) => entry.id !== skill.id)];
  await saveSettings({ ...settings, skills });
  await persistDebugLog("Skill install", { sourceUrl: url, skillId: skill.id, source: skill.source, status: "success" });
  return skill;
}

async function installSkillDraft(skillMarkdown: string) {
  const settings = await getSettings();
  const skill = parseSkillMarkdown(skillMarkdown, { source: "manual" });
  const skills = [skill, ...settings.skills.filter((entry) => entry.id !== skill.id)];
  await saveSettings({ ...settings, skills });
  await persistDebugLog("Skill install", { skillId: skill.id, source: skill.source, status: "success", mode: "draft" });
  return skill;
}

async function listSkills() {
  const settings = await getSettings();
  return mergeSkills(settings.skills);
}

async function listMemories() {
  const settings = await getSettings();
  return settings.memories;
}

async function addMemory(content: string, scope: "global" | "site" = "global", origin?: string) {
  const settings = await getSettings();
  const normalizedContent = content.trim();
  if (!normalizedContent) throw new Error("Memory content is required.");
  const memory = createMemory({ content: normalizedContent, scope, origin, source: "manual" });
  const memories = [memory, ...settings.memories];
  await saveSettings({ ...settings, memories });
  return memory;
}

async function updateMemory(id: string, patch: Partial<{ content: string; enabled: boolean; scope: "global" | "site"; origin: string }>) {
  const settings = await getSettings();
  const memories = settings.memories.map((memory) => {
    if (memory.id !== id) return memory;
    const scope = patch.scope ?? memory.scope;
    return {
      ...memory,
      content: patch.content?.trim() || memory.content,
      enabled: patch.enabled ?? memory.enabled,
      scope,
      origin: scope === "site" ? patch.origin ?? memory.origin : undefined,
      updatedAt: new Date().toISOString()
    };
  });
  await saveSettings({ ...settings, memories });
  return memories.find((memory) => memory.id === id);
}

async function removeMemory(id: string) {
  const settings = await getSettings();
  await saveSettings({ ...settings, memories: settings.memories.filter((memory) => memory.id !== id) });
  return { ok: true };
}

async function removeSkill(id: string) {
  const settings = await getSettings();
  if (builtInSkills.some((skill) => skill.id === id)) {
    throw new Error("Built-in skills cannot be removed.");
  }
  const skills = settings.skills.filter((skill) => skill.id !== id);
  await saveSettings({ ...settings, skills });
  return { ok: true };
}

async function handleGatewayRequest(message: BrowserAgentRequest & { origin?: string }): Promise<BrowserAgentResponse> {
  const requestId = message.requestId ?? message.id;

  try {
    const settings = await getSettings();

    if (message.method === "getStatus") {
      return createGatewaySuccess(requestId, buildGatewayStatus(settings, message.origin));
    }

    if (message.method === "requestAccess") {
      if (!settings.gateway.enabled) {
        return createGatewayError(requestId, "gateway_disabled", "BrowserAgent Gateway is turned off.");
      }
      if (!message.origin) {
        throw new GatewayProtocolError("invalid_request", "Missing request origin.");
      }
      const accessResult = await requestSiteAccess(requestId, message.origin, message.payload);
      if (!accessResult.granted) {
        throw new GatewayProtocolError("user_rejected", "The user rejected this Site Access request.", {
          origin: accessResult.origin,
          scopes: accessResult.scopes
        });
      }
      return createGatewaySuccess(requestId, accessResult);
    }

    if (message.method === "models.list") {
      ensureGatewayAccess(settings, message.origin, ["model.chat"], false);
      return createGatewaySuccess(requestId, { models: listGatewayModels(settings) });
    }

    if (message.method === "chat") {
      assertChatPayload(message.payload);
      await authorizeGateway(message.origin, ["model.chat"], false);
      return createGatewaySuccess(requestId, await runChat(message.payload.messages, "gateway", message.origin));
    }

    if (message.method === "run") {
      assertRunPayload(message.payload);
      await authorizeGateway(message.origin, requiredRunScopes(message.payload.mode), true);
      return createGatewaySuccess(requestId, await runTask(message.payload.task, "gateway", message.origin, message.payload.mode ?? "dom"));
    }

    return createGatewayError(requestId, "invalid_request", "Unknown BrowserAgent Gateway method.");
  } catch (error) {
    const normalized = normalizeGatewayError(error);
    return createGatewayError(requestId, normalized.code, normalized.message, normalized.details);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source === "agenticify-page") {
    handleGatewayRequest(message).then(sendResponse);
    return true;
  }

  (async () => {
    if (message?.target !== "agenticify-background" && !message?.type?.startsWith?.("agenticify:")) return undefined;

    if (message.type === "agenticify:get-settings") return getSettings();
    if (message.type === "agenticify:save-settings") {
      await saveSettings(normalizeSettings(message.settings));
      return { ok: true };
    }
    if (message.type === "agenticify:test-provider") {
      const provider = message.provider as ProviderSettings;
      const result = await callModel({
        settings: provider,
        request: {
          timeoutMs: 30_000,
          messages: [
          { role: "system", content: "You are testing a model connection. Reply with a short confirmation." },
          { role: "user", content: "Reply with: Connection OK" }
          ]
        }
      });
      return { ok: true, text: result.text, model: result.model, provider: result.provider };
    }
    if (message.type === "agenticify:observe-active-tab") {
      const tab = await getActiveTab();
      const observation = await observeTab(tab);
      return { ...observation, tabId: tab.id };
    }
    if (message.type === "agenticify:sidebar-chat") return runChat(message.messages, "sidebar");
    if (message.type === "agenticify:sidebar-run") {
      return runTask(message.task, "sidebar", undefined, message.mode ?? "dom", message.providerId, message.model, message.tabId, message.memory, message.skillIds);
    }
    if (
      message.type === "agenticify:request-debugger-access"
      || message.type === "agenticify:request-debugger-permission"
      || message.type === "agenticify:authorize-debugger"
    ) return openSidebarDebuggerAccessRequest();
    if (message.type === "agenticify:grant-current-site-debugger-access") return grantCurrentSiteDebuggerAccess(message.tabId);
    if (message.type === "agenticify:debugger-action") return runDebuggerAction(message.action as DebuggerAction, message.tabId);
    if (message.type === "agenticify:benchmark-tool") return runBenchmarkToolForActiveTab(message.request as BenchmarkToolRequest, message.tabId);
    if (message.type === "agenticify:skills-list") return listSkills();
    if (message.type === "agenticify:skills-install") return installSkill(String(message.url || ""));
    if (message.type === "agenticify:skills-install-draft") return installSkillDraft(String(message.skillMarkdown || ""));
    if (message.type === "agenticify:skills-remove") return removeSkill(String(message.id || ""));
    if (message.type === "agenticify:memories-list") return listMemories();
    if (message.type === "agenticify:memories-add") return addMemory(String(message.content || ""), message.scope === "site" ? "site" : "global", message.origin);
    if (message.type === "agenticify:memories-update") return updateMemory(String(message.id || ""), message.patch ?? {});
    if (message.type === "agenticify:memories-remove") return removeMemory(String(message.id || ""));
    if (message.type === "agenticify:get-access-request") {
      const pending = pendingAccessRequests.get(message.id);
      if (!pending) throw new Error("Access request expired");
      return pending.request;
    }
    if (message.type === "agenticify:resolve-access-request") {
      return resolveSiteAccessRequest(message.id, Boolean(message.approved), Boolean(message.autoRun), Boolean(message.debuggerControl));
    }
    if (message.type === "agenticify:revoke-site-access") return revokeSiteAccess(message.origin);

    throw new Error("Unknown message");
  })().then((result) => sendResponse({ ok: true, result })).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown background error" });
  });
  return true;
});
