import {
  ArrowUp,
  AtSign,
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileText,
  ListFilter,
  Loader2,
  Lock,
  PenLine,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  X,
  Wand2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { getCopy } from "../shared/i18n";
import type {
  AgentAction,
  AgentControlMode,
  AgentEvent,
  BenchmarkToolRequest,
  BenchmarkToolResult,
  ConversationMemory,
  ConversationMemoryTurn,
  DomObservation,
  ExtensionSettings,
  InstalledSkill,
  PageScreenshot,
  ProviderSettings,
  SitePermission
} from "../shared/types";
import "./styles.css";

type TimelineItem = {
  kind: "user" | "observe" | "reasoning" | "action" | "result" | "blocked" | "error" | "final" | "system" | "permission";
  title: string;
  detail: string;
  meta?: string;
  html?: string;
  image?: PageScreenshot;
  action?: "debugger-access" | "skill-install";
  skillDraft?: InstalledSkill;
};

const conversationStoragePrefix = "agenticify:sidepanel:conversation:";
const maxStoredTimelineItems = 80;
const maxStoredHtmlLength = 200_000;

type MessageBlock =
  | { type: "text"; content: string }
  | { type: "code"; language?: string; content: string };

type ObservedPage = DomObservation & {
  tabId?: number;
};

async function sendRuntimeMessage<T>(message: unknown, copy?: { backgroundDisconnected?: string }): Promise<T> {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "Request failed");
    return response.result as T;
  } catch (error) {
    throw new Error(normalizeRuntimeMessageError(error, copy?.backgroundDisconnected));
  }
}

export function normalizeRuntimeMessageError(error: unknown, backgroundDisconnected = "Haro is not connected. Reopen the side panel, or reload the extension if it was just updated."): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/receiving end does not exist|could not establish connection/i.test(message)) {
    return backgroundDisconnected;
  }
  return message || "Request failed";
}

export function parseMessageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = /```([^\n`]*)?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      blocks.push({ type: "text", content: text.slice(cursor, match.index) });
    }
    blocks.push({
      type: "code",
      language: match[1]?.trim() || undefined,
      content: match[2].replace(/\n$/, "")
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    blocks.push({ type: "text", content: text.slice(cursor) });
  }

  return blocks.length ? blocks : [{ type: "text", content: text }];
}

export function detectSkillInstallUrl(text: string): string | undefined {
  if (!/\binstall\b|安装|添加/.test(text.toLowerCase())) return undefined;
  if (!/\bskill\b|技能/.test(text.toLowerCase())) return undefined;
  return text.match(/https:\/\/skills\.sh\/[^\s]+/)?.[0];
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

export function getSiteConversationStorageKey(origin: string) {
  return `${conversationStoragePrefix}${origin}`;
}

function isTimelineItem(value: unknown): value is TimelineItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TimelineItem>;
  return typeof item.kind === "string" && typeof item.title === "string" && typeof item.detail === "string";
}

export function sanitizeTimelineItemsForStorage(items: TimelineItem[]): TimelineItem[] {
  return items.slice(-maxStoredTimelineItems).map((item) => ({
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    meta: item.meta,
    html: item.html && item.html.length <= maxStoredHtmlLength ? item.html : undefined
  }));
}

export function timelineItemsToConversationMemory(items: TimelineItem[]): ConversationMemory {
  const turns = items.flatMap<ConversationMemoryTurn>((item) => {
    if (item.kind === "user") return [{ role: "user", content: item.detail }];
    if (item.kind === "final") return [{ role: "assistant", content: item.detail }];
    return [];
  });
  return { turns: turns.slice(-12) };
}

async function loadSiteConversation(origin: string): Promise<TimelineItem[]> {
  const key = getSiteConversationStorageKey(origin);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return Array.isArray(value) ? sanitizeTimelineItemsForStorage(value.filter(isTimelineItem)) : [];
}

async function saveSiteConversation(origin: string, items: TimelineItem[]): Promise<void> {
  await chrome.storage.local.set({ [getSiteConversationStorageKey(origin)]: sanitizeTimelineItemsForStorage(items) });
}

async function clearSiteConversation(origin: string): Promise<void> {
  await chrome.storage.local.remove(getSiteConversationStorageKey(origin));
}

function MessageContent({ text }: { text: string }) {
  return (
    <div className="message-content">
      {parseMessageBlocks(text).map((block, index) => (
        block.type === "code" ? (
          <div className="code-block" key={index}>
            <div className="code-block-header">
              <span>{block.language || "code"}</span>
              <button className="copy-button" type="button" title="Copy code" onClick={() => copyText(block.content)}>
                <Copy size={12} />
              </button>
            </div>
            <pre><code>{block.content}</code></pre>
          </div>
        ) : (
          <MarkdownText content={block.content} key={index} />
        )
      ))}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code className="inline-code" key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length ? nodes : text;
}

function MarkdownText({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: ReactElement[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      elements.push(<div className={`md-heading h${level}`} key={index}>{renderInlineMarkdown(heading[2])}</div>);
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*[-*]\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      index -= 1;
      elements.push(<ul className="md-list" key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*\d+[.)]\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      index -= 1;
      elements.push(<ol className="md-list" key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    if (line.trim()) {
      elements.push(<p className="md-paragraph" key={index}>{renderInlineMarkdown(line)}</p>);
    }
  }

  return <div className="message-text">{elements}</div>;
}

function TraceContent({ detail }: { detail: string }) {
  const steps = detail.split(/\s*·\s*/).map((step) => step.trim()).filter(Boolean);
  return (
    <ol className="trace-steps">
      {steps.map((step, index) => (
        <li key={`${step}-${index}`}>
          <span className="trace-dot" aria-hidden="true" />
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function describeAction(action: AgentAction) {
  if (action.type === "click") return `Click ${action.selector}`;
  if (action.type === "type") return `Type ${action.selector}`;
  if (action.type === "scroll") return `Scroll ${action.direction}`;
  if (action.type === "debugger") return "Request debugger";
  if (action.type === "skill") return `Use skill ${action.skillId}`;
  return "Read page";
}

export function formatAgentEventsForTimeline(events: AgentEvent[]): TimelineItem[] {
  const lastFinalIndex = events.map((event) => event.type).lastIndexOf("final");
  return events.flatMap((event, index) => {
    if (event.type === "final" && index !== lastFinalIndex) return [];
    if (event.type === "observe") {
      const headingCount = event.observation.headings.length;
      const controlCount = event.observation.interactiveElements.length;
      return {
        kind: "observe",
        title: "Observe",
        detail: `Read ${event.observation.title || event.observation.origin} (${headingCount} headings, ${controlCount} controls)`,
        meta: event.observation.origin
      };
    }
    if (event.type === "thought" || event.type === "plan") {
      return {
        kind: "reasoning",
        title: "Reasoning summary",
        detail: "Planned response from current page context."
      };
    }
    if (event.type === "action") {
      return {
        kind: "action",
        title: "Action",
        detail: `${describeAction(event.action)} -> ${event.reason}`,
        meta: event.confidence === undefined ? undefined : `${Math.round(event.confidence * 100)}%`
      };
    }
    if (event.type === "action-result") {
      if (event.result.benchmarkResult) return formatBenchmarkToolResultForTimeline(event.result.benchmarkResult);
      if (event.result.skillDraft) {
        return {
          kind: "permission",
          title: "Install skill?",
          detail: `${event.result.skillDraft.name}\n\n${event.result.skillDraft.description}\n\n${event.result.skillDraft.skillMarkdown}`,
          meta: event.result.skillDraft.id,
          action: "skill-install",
          skillDraft: event.result.skillDraft
        };
      }
      return {
        kind: "result",
        title: "Action result",
        detail: `${describeAction(event.action)} -> ${event.result.message}`,
        meta: event.result.ok ? "ok" : "failed"
      };
    }
    if (event.type === "blocked") {
      return { kind: "blocked", title: "Blocked", detail: event.reason };
    }
    return { kind: "final", title: "Final", detail: event.text };
  });
}

export function formatAgentRunResultForTimeline(
  result: { finalText: string; events?: AgentEvent[] },
  finalTitle: string
): TimelineItem[] {
  const events = result.events ?? [];
  if (!events.length) {
    return [{ kind: "final", title: finalTitle, detail: result.finalText || "Done." }];
  }

  const skillInstallItems = formatAgentEventsForTimeline(events)
    .filter((item) => item.action === "skill-install");
  if (skillInstallItems.length) return skillInstallItems;

  const traceItems = formatAgentTraceForTimeline(events);
  const hasFinalEvent = events.some((event) => event.type === "final");
  if (!hasFinalEvent) return traceItems;

  return [
    ...traceItems,
    { kind: "final", title: finalTitle, detail: result.finalText || "Done." }
  ];
}

function formatAgentTraceForTimeline(events: AgentEvent[]): TimelineItem[] {
  const nonFinalEvents = events.filter((event) => event.type !== "final");
  if (!nonFinalEvents.length) return [];

  const labels = nonFinalEvents.map((event) => {
    if (event.type === "observe") return "Read page";
    if (event.type === "thought" || event.type === "plan") return "Planned";
    if (event.type === "action") return describeAction(event.action);
    if (event.type === "action-result") return event.result.ok ? "Tool completed" : "Tool failed";
    return event.status === "needs_confirmation" ? "Needs confirmation" : "Blocked";
  });

  return [{
    kind: nonFinalEvents.some((event) => event.type === "blocked") ? "blocked" : "result",
    title: "Activity",
    detail: Array.from(new Set(labels)).join(" · "),
    meta: "TRACE"
  }];
}

export function formatBenchmarkToolResultForTimeline(result: BenchmarkToolResult): TimelineItem {
  if (result.type === "screenshot") {
    return {
      kind: "result",
      title: result.title,
      detail: `${result.screenshot.width} x ${result.screenshot.height}`,
      image: result.screenshot
    };
  }
  if (result.type === "report") {
    return {
      kind: "final",
      title: result.title,
      detail: "HTML report ready.",
      html: result.html
    };
  }
  if (result.type === "rewrite") {
    return {
      kind: "result",
      title: "Activity",
      detail: `Tool completed · Changed ${result.rewrite.changed} text nodes`,
      meta: "TRACE"
    };
  }
  if (result.type === "restore-rewrite") {
    return {
      kind: "result",
      title: "Activity",
      detail: `Tool completed · Restored ${result.restored} text nodes`,
      meta: "TRACE"
    };
  }
  return {
    kind: "result",
    title: "Activity",
    detail: `Tool completed · Filled ${result.formFill.filled} fields${result.formFill.skipped.length ? ` · Skipped ${result.formFill.skipped.length}` : ""}`,
    meta: "TRACE"
  };
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

async function exportHtmlAsPng(html: string, filename: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;background:white;color:#111;padding:32px;font-size:16px;line-height:1.5;">${html}</div></foreignObject></svg>`;
  const image = new window.Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not render report image."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create export canvas.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  downloadDataUrl(canvas.toDataURL("image/png"), filename);
}

function isConfiguredProvider(provider: ProviderSettings) {
  return provider.enabled && provider.apiKey.trim().length > 0;
}

function modelSelectionValue(providerId: string, model: string) {
  return `${providerId}::${model}`;
}

function parseModelSelection(value: string) {
  const [providerId, ...modelParts] = value.split("::");
  return { providerId, model: modelParts.join("::") };
}

export function buildSidebarRunMessage({
  task,
  mode,
  providerId,
  model,
  tabId,
  memory,
  selectedSkill
}: {
  task: string;
  mode: AgentControlMode;
  providerId: string;
  model: string;
  tabId?: number;
  memory: ConversationMemory;
  selectedSkill?: Pick<InstalledSkill, "id">;
}) {
  return {
    type: "agenticify:sidebar-run",
    task,
    mode,
    providerId,
    model,
    tabId,
    memory,
    skillIds: selectedSkill ? [selectedSkill.id] : []
  };
}

export function userMessageMeta(mode: AgentControlMode, selectedSkill?: Pick<InstalledSkill, "name">): string {
  return selectedSkill ? `@${selectedSkill.name}` : mode.toUpperCase();
}

export function detectDirectBenchmarkRequest(task: string, selectedSkill?: Pick<InstalledSkill, "id">): BenchmarkToolRequest | undefined {
  if (selectedSkill?.id === "builtin/screenshot") return { type: "screenshot" };
  if (selectedSkill?.id === "builtin/page-report") return { type: "report" };
  if (/\b(screenshot|screen capture|capture screenshot|png export)\b/i.test(task) || /(截图|截屏|整页截图|全页截图|页面截图)/.test(task)) {
    return { type: "screenshot" };
  }
  if (/\b(html report|page report|analysis report|generate report|create report|export report)\b/i.test(task) || /(生成|创建|输出|导出|做|写).{0,8}(报告|页面报告|分析报告|HTML报告|html报告)/i.test(task)) {
    return { type: "report" };
  }
  return undefined;
}

export function filterComposerSkills(skills: InstalledSkill[], query: string): InstalledSkill[] {
  const normalized = query.trim().toLowerCase();
  return skills
    .filter((skill) => skill.enabled)
    .filter((skill) => {
      if (!normalized) return true;
      return `${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(normalized);
    })
    .slice(0, 8);
}

export function moveSkillPickerIndex(current: number, direction: "up" | "down", itemCount: number): number {
  if (itemCount <= 0) return -1;
  if (direction === "down") return current < 0 ? 0 : (current + 1) % itemCount;
  return current < 0 ? itemCount - 1 : (current - 1 + itemCount) % itemCount;
}

export function App() {
  const [page, setPage] = useState<ObservedPage | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [composerSkills, setComposerSkills] = useState<InstalledSkill[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [mode, setMode] = useState<AgentControlMode>("auto");
  const [showDetails, setShowDetails] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [lastRewriteSessionId, setLastRewriteSessionId] = useState("");
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [conversationOrigin, setConversationOrigin] = useState("");
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const locale = settings?.locale ?? "en";
  const t = getCopy(locale);
  const configuredProviders = settings?.providers.filter(isConfiguredProvider) ?? [];
  const selectedProvider = configuredProviders.find((provider) => provider.id === selectedProviderId) ?? configuredProviders[0];
  const modelReady = Boolean(selectedProvider);
  const availableModels = selectedProvider?.models.length ? selectedProvider.models : selectedProvider ? [selectedProvider.defaultModel] : [];
  const activeModel = selectedModel || settings?.defaultModel || selectedProvider?.defaultModel || availableModels[0] || "";
  const activeModelSelection = selectedProvider && activeModel ? modelSelectionValue(selectedProvider.id, activeModel) : "";
  const availableSkills = composerSkills.filter((skill) => skill.enabled);
  const selectedSkill = availableSkills.find((skill) => skill.id === selectedSkillId);
  const skillMatches = filterComposerSkills(availableSkills, skillQuery);
  const sitePermission: SitePermission | undefined = page?.origin ? settings?.permissions.find((permission) => permission.origin === page.origin && !permission.revokedAt) : undefined;
  const pageReadable = Boolean(page);
  const autoRunAllowed = Boolean(sitePermission?.autoRun);
  const debuggerAllowed = Boolean(sitePermission?.scopes.includes("debugger.control"));

  const refreshSettings = async () => {
    const loaded = await sendRuntimeMessage<ExtensionSettings>({ type: "agenticify:get-settings" }, t);
    setSettings(loaded);
    return loaded;
  };

  const refreshSkills = async () => {
    const loaded = await sendRuntimeMessage<InstalledSkill[]>({ type: "agenticify:skills-list" }, t);
    setComposerSkills(loaded);
    return loaded;
  };

  const refreshPage = async () => {
    try {
      const observation = await sendRuntimeMessage<ObservedPage>({ type: "agenticify:observe-active-tab" }, t);
      setPage(observation);
      return observation;
    } catch (error) {
      setItems((current) => [...current, { kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Could not read the page." }]);
      return null;
    }
  };

  useEffect(() => {
    refreshPage();
    refreshSettings()
      .catch(() => setSettings(null));
    refreshSkills()
      .catch(() => setComposerSkills([]));

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes.providers || changes.defaultProviderId || changes.defaultModel || changes.locale || changes.permissions || changes.callLogs || changes.skills) {
        refreshSettings().catch(() => undefined);
      }
      if (changes.skills) {
        refreshSkills().catch(() => undefined);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    const origin = page?.origin ?? "";
    setConversationOrigin(origin);
    setConversationLoaded(false);

    if (!origin) {
      setItems([]);
      setConversationLoaded(true);
      return;
    }

    let canceled = false;
    loadSiteConversation(origin)
      .then((storedItems) => {
        if (canceled) return;
        setItems(storedItems);
        setConversationLoaded(true);
      })
      .catch((error) => {
        if (canceled) return;
        setItems([{ kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Could not load conversation." }]);
        setConversationLoaded(true);
      });

    return () => {
      canceled = true;
    };
  }, [page?.origin, t.error]);

  useEffect(() => {
    if (!conversationOrigin || !conversationLoaded) return;
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveSiteConversation(conversationOrigin, items).catch(() => undefined);
    }, 250);
    return () => {
      if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    };
  }, [conversationOrigin, conversationLoaded, items]);

  useEffect(() => {
    if (!settings) return;
    const providers = settings.providers.filter(isConfiguredProvider);
    const fallback = providers.find((provider) => provider.id === settings.defaultProviderId) ?? providers[0];
    setSelectedProviderId((current) => providers.some((provider) => provider.id === current) ? current : fallback?.id ?? "");
  }, [settings]);

  useEffect(() => {
    if (!selectedProvider) {
      setSelectedModel("");
      return;
    }
    const models = selectedProvider.models.length ? selectedProvider.models : [selectedProvider.defaultModel];
    const preferred = selectedProvider.id === settings?.defaultProviderId && settings.defaultModel ? settings.defaultModel : selectedProvider.defaultModel;
    setSelectedModel((current) => models.includes(current) ? current : preferred || models[0] || "");
  }, [selectedProvider, settings?.defaultModel, settings?.defaultProviderId]);

  useEffect(() => {
    if (!selectedSkillId) return;
    if (!availableSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId("");
    }
  }, [availableSkills, selectedSkillId]);

  useEffect(() => {
    if (!showSkillPicker) return;
    setActiveSkillIndex(skillMatches.length > 0 ? 0 : -1);
  }, [showSkillPicker, skillQuery, skillMatches.length]);

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const clearConversation = async () => {
    const origin = conversationOrigin;
    setItems([]);
    if (!origin) return;
    await clearSiteConversation(origin).catch((error) => {
      setItems([{ kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Could not clear conversation." }]);
    });
  };

  const queueDebuggerAccessCard = () => {
    const origin = page?.origin || t.unknown;
    setItems((current) => {
      if (current.some((item) => item.action === "debugger-access")) return current;
      return [...current, {
        kind: "permission",
        title: t.authorizeDebugger,
        detail: `${origin}\n\n${t.debuggerGateCopy}\n\n${t.debuggerAccessRisk}`,
        meta: origin,
        action: "debugger-access"
      }];
    });
  };

  const runTask = async (task: string) => {
    const submittedTask = task.trim();
    if (!submittedTask || busyRef.current) return;
    const submittedSkill = selectedSkill;
    busyRef.current = true;
    setBusy(true);
    setInput("");
    setSelectedSkillId("");
    setShowSkillPicker(false);
    setSkillQuery("");
    try {
      const skillInstallUrl = detectSkillInstallUrl(submittedTask);
      if (skillInstallUrl) {
        setItems((current) => [...current, { kind: "user", title: "Skill", detail: skillInstallUrl }]);
        const skill = await sendRuntimeMessage<{ id: string; name: string; description: string }>({
          type: "agenticify:skills-install",
          url: skillInstallUrl
        }, t);
        setItems((current) => [...current, {
          kind: "result",
          title: "Skill installed",
          detail: `${skill.name}: ${skill.description}`,
          meta: skill.id
        }]);
        return;
      }
      const directBenchmarkRequest = detectDirectBenchmarkRequest(submittedTask, submittedSkill);
      if (directBenchmarkRequest) {
        if (!debuggerAllowed) {
          queueDebuggerAccessCard();
          return;
        }
        if ((directBenchmarkRequest.type === "report" || directBenchmarkRequest.type === "rewrite" || directBenchmarkRequest.type === "fill-form") && !modelReady) {
          setItems((current) => [...current, { kind: "blocked", title: t.model, detail: t.connectModel }]);
          return;
        }
        const targetPage = !page?.tabId ? await refreshPage() : page;
        setItems((current) => [...current, { kind: "user", title: t.userTask, detail: submittedTask, meta: userMessageMeta("debugger", submittedSkill) }]);
        const result = await sendRuntimeMessage<BenchmarkToolResult>({
          type: "agenticify:benchmark-tool",
          request: directBenchmarkRequest,
          tabId: targetPage?.tabId
        }, t);
        setItems((current) => [...current, formatBenchmarkToolResultForTimeline(result)]);
        return;
      }
      const latestSettings = await refreshSettings().catch(() => settings);
      const runProvider = latestSettings?.providers.find((provider) => provider.id === selectedProvider?.id && isConfiguredProvider(provider));
      if (!runProvider) {
        setItems((current) => [...current, { kind: "blocked", title: t.model, detail: t.connectModel }]);
        return;
      }
      if (mode === "debugger" && !debuggerAllowed) {
        queueDebuggerAccessCard();
        return;
      }
      const targetPage = mode === "debugger" && !page?.tabId ? await refreshPage() : page;
      const memory = timelineItemsToConversationMemory(items);
      setItems((current) => [...current, { kind: "user", title: t.userTask, detail: submittedTask, meta: userMessageMeta(mode, submittedSkill) }]);
      const result = await sendRuntimeMessage<{ finalText: string; events?: AgentEvent[] }>(buildSidebarRunMessage({
        task: submittedTask,
        mode,
        providerId: runProvider.id,
        model: activeModel || runProvider.defaultModel,
        tabId: targetPage?.tabId,
        memory,
        selectedSkill: submittedSkill
      }), t);
      const eventItems = formatAgentRunResultForTimeline(result, t.final);
      setItems((current) => [...current, ...eventItems]);
    } catch (error) {
      setItems((current) => [...current, { kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Task failed." }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runBenchmark = async (request: BenchmarkToolRequest) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    if (!debuggerAllowed) {
      queueDebuggerAccessCard();
      busyRef.current = false;
      setBusy(false);
      return;
    }
    const targetPage = !page?.tabId ? await refreshPage() : page;
    if ((request.type === "report" || request.type === "rewrite" || request.type === "fill-form") && !modelReady) {
      setItems((current) => [...current, { kind: "blocked", title: t.model, detail: t.connectModel }]);
      busyRef.current = false;
      setBusy(false);
      return;
    }
    setItems((current) => [...current, { kind: "user", title: "Tool", detail: request.type, meta: "DEBUGGER" }]);
    try {
      const result = await sendRuntimeMessage<BenchmarkToolResult>({ type: "agenticify:benchmark-tool", request, tabId: targetPage?.tabId }, t);
      if (result.type === "rewrite") setLastRewriteSessionId(result.rewrite.sessionId);
      if (result.type === "restore-rewrite") setLastRewriteSessionId("");
      setItems((current) => [...current, formatBenchmarkToolResultForTimeline(result)]);
    } catch (error) {
      setItems((current) => [...current, { kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Tool failed." }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const requestDebuggerAccess = async () => {
    if (busyRef.current || debuggerAllowed) return;
    queueDebuggerAccessCard();
  };

  const resolveDebuggerAccess = async (approved: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (!approved) {
        setItems((current) => current.map((item) => (
          item.action === "debugger-access"
            ? { kind: "blocked", title: t.debuggerMode, detail: t.debuggerAccessDenied, meta: item.meta }
            : item
        )));
        return;
      }

      const targetPage = !page?.tabId ? await refreshPage() : page;
      const result = await sendRuntimeMessage<{ origin: string }>({
        target: "agenticify-background",
        type: "agenticify:grant-current-site-debugger-access",
        tabId: targetPage?.tabId
      }, t);
      await refreshSettings();
      await refreshPage();
      setItems((current) => current.map((item) => (
        item.action === "debugger-access"
          ? { kind: "system", title: t.debuggerMode, detail: t.debuggerAccessGranted, meta: result.origin }
          : item
      )));
    } catch (error) {
      setItems((current) => [...current, { kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Could not open authorization." }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const resolveSkillInstall = async (item: TimelineItem, approved: boolean) => {
    if (busyRef.current || !item.skillDraft) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (!approved) {
        setItems((current) => current.map((candidate) => (
          candidate === item
            ? { kind: "blocked", title: "Skill discarded", detail: item.skillDraft!.name, meta: item.skillDraft!.id }
            : candidate
        )));
        return;
      }
      const skill = await sendRuntimeMessage<InstalledSkill>({
        type: "agenticify:skills-install-draft",
        skillMarkdown: item.skillDraft.skillMarkdown
      }, t);
      setItems((current) => current.map((candidate) => (
        candidate === item
          ? { kind: "system", title: "Skill installed", detail: `${skill.name}: ${skill.description}`, meta: skill.id }
          : candidate
      )));
    } catch (error) {
      setItems((current) => [...current, { kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Could not install skill." }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const chooseMode = (nextMode: AgentControlMode) => {
    setMode(nextMode);
    if (nextMode === "debugger" && !debuggerAllowed) queueDebuggerAccessCard();
  };

  const selectComposerSkill = (skill: InstalledSkill) => {
    setSelectedSkillId(skill.id);
    setShowSkillPicker(false);
    setSkillQuery("");
    setActiveSkillIndex(0);
    setInput((current) => current.replace(/(?:^|\s)@[^\s@]*$/, "").trimStart());
  };

  const actions = [
    { label: t.summarize, detail: t.summarizeDetail, icon: FileText, task: t.summarizeTask },
    { label: t.askPage, detail: t.askPageDetail, icon: Bot, task: t.askPageTask },
    { label: t.extract, detail: t.extractDetail, icon: ListFilter, task: t.extractTask },
    { label: t.write, detail: t.writeDetail, icon: PenLine, task: t.writeTask },
    { label: t.customTask, detail: t.customTaskDetail, icon: Wand2, task: input || t.customTaskFallback }
  ];

  return (
    <main className="agent-shell">
      <section className="topbar">
        <div className="mark" aria-hidden="true">
          <Sparkles size={17} />
        </div>
        <div className="brand-copy">
          <div className="brand-title">Haro</div>
          <div className="brand-subtitle">{t.browserAiTagline}</div>
        </div>
        <div className="topbar-actions">
          <Button variant="ghost" size="icon" className="icon-button" title={t.settings} onClick={openOptions}>
            <Settings size={16} />
          </Button>
        </div>
      </section>

      <section className="context-panel">
        <div className="context-summary">
          <div className="context-summary-main">
            <span className={page ? "status-dot ready" : "status-dot"} />
            <span className="page-summary-copy">
              <span className="summary-meta">
                <span>{page ? t.pageReady : t.pageWaiting}</span>
                <span className={`summary-mode summary-mode-${mode}`}>{mode.toUpperCase()}</span>
              </span>
              <strong>{page?.title || t.openPage}</strong>
              <small>{page?.url || page?.origin || t.noActivePage}</small>
            </span>
          </div>
          <button className="summary-icon-button" type="button" title={t.refresh} onClick={refreshPage}>
            <RefreshCw size={15} />
          </button>
          <button className="summary-icon-button" type="button" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails} title={showDetails ? t.collapse : t.expand}>
            <ChevronRight className={showDetails ? "summary-chevron open" : "summary-chevron"} size={15} />
          </button>
        </div>

        {showDetails && (
          <div className="context-details">
            <div className="context-grid">
              <div>
                <span>{t.readStatus}</span>
                <strong>{pageReadable ? t.available : t.unavailable}</strong>
              </div>
              <div>
                <span>{t.modelStatus}</span>
                <strong>{modelReady ? t.configured : t.notConfigured}</strong>
              </div>
            </div>
            <div className="mode-control" aria-label={t.controlMode}>
              {(["dom", "debugger", "auto"] as const).map((option) => (
                <button className={mode === option ? "mode-option active" : "mode-option"} key={option} onClick={() => chooseMode(option)}>
                  {option === "dom" ? "DOM" : option === "debugger" ? "Debugger" : "Auto"}
                </button>
              ))}
            </div>
            <div className="permission-list">
              <div className="permission-row">
                <ShieldCheck size={14} />
                <span>{t.currentSiteRead}</span>
                <strong>{pageReadable ? t.allowed : t.blocked}</strong>
              </div>
              <div className="permission-row">
                <TerminalSquare size={14} />
                <span>{t.autoRunPermission}</span>
                <strong>{autoRunAllowed ? t.allowed : t.gated}</strong>
              </div>
              <div className="permission-row">
                <Lock size={14} />
                <span>{t.debuggerMode}</span>
                <strong>{debuggerAllowed ? t.allowed : t.gated}</strong>
              </div>
              {mode === "debugger" && !debuggerAllowed && (
                <div className="debugger-gate">
                  <span>{t.debuggerGateCopy}</span>
                  <button className="debugger-authorize-button" type="button" disabled={busy} onClick={requestDebuggerAccess}>
                    <Lock size={13} />
                    {t.authorizeDebugger}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {!modelReady && (
        <section className="setup-callout">
          <div>
            <div className="setup-title">{t.connectModel}</div>
            <div className="setup-copy">{t.connectModelCopy}</div>
          </div>
          <Button className="setup-button" onClick={openOptions}>{t.configure}</Button>
        </section>
      )}

      <section className="timeline">
        <div className="timeline-header">
          <div className="section-label">{t.timeline}</div>
          <button className="timeline-clear-button" type="button" disabled={busy || items.length === 0} onClick={clearConversation} title={t.clearConversation}>
            <Trash2 size={13} />
            <span>{t.clearConversation}</span>
          </button>
        </div>
        {items.length === 0 && !busy && (
          <div className="timeline-empty">{t.emptyTimeline}</div>
        )}
        {items.map((item, index) => {
          const isChatMessage = (item.kind === "user" || item.kind === "final") && !item.image && !item.html;
          const isTrace = item.meta === "TRACE";
          const isArtifact = Boolean(item.image || item.html);
          const isPermission = item.kind === "permission";

          if (isTrace) {
            return (
              <div className={`timeline-row trace ${item.kind}`} key={index}>
                <div className="trace-rail" aria-hidden="true" />
                <details className="trace-card">
                  <summary>
                    <span className={item.kind === "blocked" ? "trace-status blocked" : "trace-status"} />
                    <span>{item.kind === "blocked" ? "Needs confirmation" : "Activity"}</span>
                    <ChevronRight className="trace-chevron" size={13} />
                  </summary>
                  <TraceContent detail={item.detail} />
                </details>
              </div>
            );
          }

          if (isChatMessage) {
            return (
              <div className={`timeline-row chat ${item.kind}`} key={index}>
                <div className="timeline-marker">{item.kind === "user" ? "U" : <CheckCircle2 size={12} />}</div>
                <div className="chat-bubble">
                  <div className="timeline-title">
                    <span>{item.title}</span>
                    {item.meta && <em>{item.meta}</em>}
                  </div>
                  <div className="timeline-detail"><MessageContent text={item.detail} /></div>
                  <div className="timeline-footer">
                    <button className="copy-message-button" type="button" title="Copy message" onClick={() => copyText(item.detail)}>
                      <Copy size={12} />
                      <span>{t.copy}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div className={`timeline-row ${isArtifact ? "artifact" : ""} ${item.kind}`} key={index}>
              <div className="timeline-marker">{item.kind === "error" || item.kind === "blocked" ? "!" : <CheckCircle2 size={12} />}</div>
              <div className={isPermission ? "permission-card" : isArtifact ? "artifact-card" : "status-card"}>
                <div className="timeline-title">
                  <span>{item.title}</span>
                  <span className="timeline-title-actions">
                    {item.meta && <em>{item.meta}</em>}
                  </span>
                </div>
                <div className="timeline-detail"><MessageContent text={item.detail} /></div>
                {item.image && (
                  <div className="artifact-preview">
                    <img src={item.image.dataUrl} alt={item.image.filename} />
                    <button className="artifact-export" type="button" onClick={() => downloadDataUrl(item.image!.dataUrl, item.image!.filename)}>
                      <Download size={13} />
                      <span>PNG</span>
                    </button>
                  </div>
                )}
                {item.action === "debugger-access" && (
                  <div className="permission-actions">
                    <button className="permission-deny-button" type="button" disabled={busy} onClick={() => resolveDebuggerAccess(false)}>
                      {t.deny}
                    </button>
                    <button className="permission-allow-button" type="button" disabled={busy} onClick={() => resolveDebuggerAccess(true)}>
                      <Lock size={13} />
                      {t.allowDebugger}
                    </button>
                  </div>
                )}
                {item.action === "skill-install" && (
                  <div className="permission-actions">
                    <button className="permission-deny-button" type="button" disabled={busy} onClick={() => resolveSkillInstall(item, false)}>
                      {t.deny}
                    </button>
                    <button className="permission-allow-button" type="button" disabled={busy} onClick={() => resolveSkillInstall(item, true)}>
                      <Sparkles size={13} />
                      Install skill
                    </button>
                  </div>
                )}
                {item.html && (
                  <div className="report-preview">
                    <div dangerouslySetInnerHTML={{ __html: item.html }} />
                    <button className="artifact-export" type="button" onClick={() => exportHtmlAsPng(item.html!, "page-analysis-report.png").catch((error) => {
                      setItems((current) => [...current, { kind: "error", title: t.error, detail: error instanceof Error ? error.message : "Export failed." }]);
                    })}>
                      <Download size={13} />
                      <span>PNG</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="timeline-row trace reasoning">
            <div className="trace-rail" aria-hidden="true" />
            <div className="trace-card working">
              <div className="trace-working-title"><Loader2 size={12} /> {t.workingTitle}</div>
              <div className="trace-working-detail">{t.working}</div>
            </div>
          </div>
        )}
      </section>

      <section className="composer">
        <div className="composer-actions" aria-label={t.quickTasks}>
          {actions.map((action) => (
            <button className="task-button" disabled={busy || !modelReady} key={action.label} onClick={() => runTask(action.task)}>
              <action.icon size={15} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
        <div className="composer-shell">
          {(selectedSkill || showSkillPicker) && (
            <div className="skill-composer-panel">
              {selectedSkill && (
                <div className="selected-skill-chip">
                  <Sparkles size={13} />
                  <span>@{selectedSkill.name}</span>
                  <button type="button" title={t.clearSkill} onClick={() => setSelectedSkillId("")}>
                    <X size={12} />
                  </button>
                </div>
              )}
              {showSkillPicker && (
                <div className="skill-picker" role="listbox" aria-label={t.chooseSkill}>
                  <div className="skill-picker-header">
                    <AtSign size={13} />
                    <span>{t.chooseSkill}</span>
                  </div>
                  {skillMatches.length > 0 ? (
                    <div className="skill-picker-list">
                      {skillMatches.map((skill, index) => (
                        <button
                          className={index === activeSkillIndex ? "skill-picker-item active" : "skill-picker-item"}
                          type="button"
                          key={skill.id}
                          role="option"
                          aria-selected={index === activeSkillIndex}
                          onMouseEnter={() => setActiveSkillIndex(index)}
                          onClick={() => selectComposerSkill(skill)}
                        >
                          <span>@{skill.name}</span>
                          <small>{skill.description}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="skill-picker-empty">{availableSkills.length ? t.noMatchingSkills : t.noSkills}</div>
                  )}
                </div>
              )}
            </div>
          )}
          <Textarea
            className="composer-input"
            placeholder={modelReady ? t.composerReady : t.composerNoModel}
            value={input}
            onChange={(event) => {
              const next = event.target.value;
              setInput(next);
              const mention = /(?:^|\s)@([^\s@]*)$/.exec(next);
              if (mention) {
                setSkillQuery(mention[1]);
                setShowSkillPicker(true);
              } else if (!next.includes("@")) {
                setSkillQuery("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && showSkillPicker) {
                event.preventDefault();
                setShowSkillPicker(false);
                return;
              }
              if (showSkillPicker && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setActiveSkillIndex((current) => moveSkillPickerIndex(current, event.key === "ArrowDown" ? "down" : "up", skillMatches.length));
                return;
              }
              if (showSkillPicker && event.key === "Enter" && !event.shiftKey && activeSkillIndex >= 0 && skillMatches[activeSkillIndex]) {
                event.preventDefault();
                selectComposerSkill(skillMatches[activeSkillIndex]);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                runTask(input);
              }
            }}
            disabled={!modelReady}
          />
          <div className="composer-footer">
            <div className="model-selector-row">
              <Select
                value={activeModelSelection}
                onValueChange={(value) => {
                  const next = parseModelSelection(value);
                  setSelectedProviderId(next.providerId);
                  setSelectedModel(next.model);
                }}
                disabled={busy || configuredProviders.length === 0}
              >
                <SelectTrigger className="model-select-trigger" aria-label={t.defaultModel}>
                  <SelectValue placeholder={t.defaultModel} />
                </SelectTrigger>
                <SelectContent className="model-select-content">
                  {configuredProviders.map((provider) => (
                    <SelectGroup key={provider.id}>
                      <div className="model-select-group">{provider.name || provider.provider}</div>
                      {(provider.models.length ? provider.models : [provider.defaultModel]).map((model) => (
                        <SelectItem key={`${provider.id}-${model}`} value={modelSelectionValue(provider.id, model)}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="send-button" disabled={busy || !modelReady || !input.trim()} onClick={() => runTask(input)} title="Run task">
              {busy ? <Loader2 className="spinner" size={16} /> : <ArrowUp size={17} />}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
