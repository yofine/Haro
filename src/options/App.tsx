import {
  Activity,
  Brain,
  Bug,
  CheckCircle2,
  Globe2,
  KeyRound,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { getCopy } from "../shared/i18n";
import { defaultSettings, normalizeSettings } from "../shared/storage";
import type { AgentMemory, ExtensionSettings, InstalledSkill, PendingAccessRequest, Provider, ProviderSettings, Scope } from "../shared/types";
import "./styles.css";

type Tab = "models" | "skills" | "memory" | "gateway" | "sites" | "history" | "advanced" | "system";
type GatewayExampleTab = "access" | "debugger" | "status" | "models" | "chat" | "run";

const navItems: Array<{
  id: Tab;
  labelKey: "models" | "skills" | "memory" | "gateway" | "siteAccess" | "callHistory" | "debugLogs" | "system";
  detailKey: "modelsDetail" | "skillsDetail" | "memoryDetail" | "gatewayDetail" | "siteAccessDetail" | "callHistoryDetail" | "debugLogsDetail" | "systemDetail";
  icon: typeof KeyRound;
}> = [
  { id: "models", labelKey: "models", detailKey: "modelsDetail", icon: KeyRound },
  { id: "skills", labelKey: "skills", detailKey: "skillsDetail", icon: Sparkles },
  { id: "memory", labelKey: "memory", detailKey: "memoryDetail", icon: Brain },
  { id: "gateway", labelKey: "gateway", detailKey: "gatewayDetail", icon: Globe2 },
  { id: "sites", labelKey: "siteAccess", detailKey: "siteAccessDetail", icon: ShieldCheck },
  { id: "history", labelKey: "callHistory", detailKey: "callHistoryDetail", icon: Activity },
  { id: "advanced", labelKey: "debugLogs", detailKey: "debugLogsDetail", icon: Bug },
  { id: "system", labelKey: "system", detailKey: "systemDetail", icon: Settings2 }
];

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Request failed");
  return response.result as T;
}

function providerDefaults(provider: Provider): Pick<ProviderSettings, "baseUrl" | "models" | "defaultModel"> {
  if (provider === "anthropic") {
    return {
      baseUrl: "https://api.anthropic.com/v1",
      models: ["claude-3-5-sonnet-latest"],
      defaultModel: "claude-3-5-sonnet-latest"
    };
  }

  return {
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini"
  };
}

function createProvider(provider: Provider = "openai"): ProviderSettings {
  const defaults = providerDefaults(provider);
  return {
    id: crypto.randomUUID(),
    name: "",
    provider,
    apiKey: "",
    enabled: true,
    ...defaults
  };
}

function providerFormatLabel(provider: Provider): string {
  return provider === "openai" ? "OpenAI-compatible" : "Anthropic-compatible";
}

function scopeLabel(scope: Scope): string {
  const labels: Record<Scope, string> = {
    "model.chat": "Use the configured model",
    "page.read": "Read page content",
    "page.act": "Operate page controls",
    "agent.run": "Run browser tasks",
    "debugger.control": "Use debugger mode for advanced page inspection and control"
  };
  return labels[scope];
}

export function isBuiltInSkillId(id: string): boolean {
  return id.startsWith("builtin/");
}

export function skillSourceLabel(source: InstalledSkill["source"]): string {
  if (source === "builtin") return "Built-in";
  if (source === "skills.sh") return "skills.sh";
  return "Manual";
}

export function memoryScopeLabel(scope: AgentMemory["scope"]): string {
  return scope === "site" ? "Site" : "Global";
}

export function memorySourceLabel(source: AgentMemory["source"]): string {
  if (source === "explicit") return "Remembered";
  if (source === "auto") return "Auto";
  if (source === "summary") return "Summary";
  return "Manual";
}

export function memoryLayerLabel(layer: AgentMemory["layer"]): string {
  if (layer === "site") return "Site layer";
  if (layer === "interaction") return "Interaction layer";
  return "Profile layer";
}

export function memoryStats(memories: AgentMemory[]) {
  return {
    total: memories.length,
    enabled: memories.filter((memory) => memory.enabled).length,
    global: memories.filter((memory) => memory.scope === "global").length,
    site: memories.filter((memory) => memory.scope === "site").length
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const gatewayExamples: Array<{
  id: GatewayExampleTab;
  label: string;
  title: string;
  description: string;
  code: string;
}> = [
  {
    id: "access",
    label: "Access",
    title: "Request origin-scoped access",
    description: "Ask once for the Gateway scopes your site needs. The extension returns the stable v1 response envelope.",
    code: `const access = await window.browserAgent.requestAccess({
  appName: "Example App",
  scopes: ["model.chat", "page.read", "page.act", "agent.run"],
  reason: "Summarize and operate the current page when requested.",
  autoRun: true
});

if (!access.ok) {
  throw new Error(access.error.message);
}`
  },
  {
    id: "debugger",
    label: "Debugger",
    title: "Request debugger mode explicitly",
    description: "Debugger control is a separate Site Access capability and should be requested only when the site needs debugger mode.",
    code: `const access = await window.browserAgent.requestAccess({
  appName: "Example App",
  scopes: [
    "model.chat",
    "page.read",
    "page.act",
    "agent.run",
    "debugger.control"
  ],
  reason: "Use debugger mode only when DOM control cannot complete the requested task.",
  autoRun: true
});

if (access.ok && access.result.scopes.includes("debugger.control")) {
  await window.browserAgent.run({
    task: "Inspect this page with debugger mode.",
    mode: "debugger"
  });
}`
  },
  {
    id: "status",
    label: "Status",
    title: "Read Gateway status",
    description: "Check protocol version, granted scopes, auto-run status, and default model availability.",
    code: `const status = await window.browserAgent.getStatus();

if (status.ok) {
  console.log(status.result);
  // {
  //   version: "1",
  //   enabled: true,
  //   grantedScopes: ["model.chat"],
  //   modelConfigured: true,
  //   defaultModel: "gpt-4.1-mini"
  // }
}`
  },
  {
    id: "models",
    label: "Models",
    title: "List enabled models",
    description: "Return enabled provider profiles and their configured model names after model.chat access is granted.",
    code: `const models = await window.browserAgent.models.list();

if (models.ok) {
  for (const provider of models.result.models) {
    console.log(provider.defaultModel, provider.models);
  }
}`
  },
  {
    id: "chat",
    label: "Chat",
    title: "Call the configured model",
    description: "Send messages through the selected provider without exposing API keys to the page.",
    code: `const chat = await window.browserAgent.chat({
  messages: [
    { role: "system", content: "Answer concisely." },
    { role: "user", content: "Summarize this page." }
  ]
});

if (chat.ok) {
  console.log(chat.result.text);
}`
  },
  {
    id: "run",
    label: "Run",
    title: "Run a browser task",
    description: "Run page-aware tasks after page scopes and auto-run are granted.",
    code: `const run = await window.browserAgent.run({
  task: "Extract the main action items from this page.",
  mode: "auto"
});

if (run.ok) {
  console.log(run.result.events);
}`
  }
];

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [modelDraft, setModelDraft] = useState<ExtensionSettings>(defaultSettings);
  const [tab, setTab] = useState<Tab>("models");
  const [gatewayExampleTab, setGatewayExampleTab] = useState<GatewayExampleTab>("access");
  const [status, setStatus] = useState("");
  const [accessRequestId] = useState(() => new URLSearchParams(window.location.search).get("accessRequest"));
  const [accessRequest, setAccessRequest] = useState<PendingAccessRequest | null>(null);
  const [allowAccessAutoRun, setAllowAccessAutoRun] = useState(false);
  const [allowDebuggerControl, setAllowDebuggerControl] = useState(false);
  const [accessResolving, setAccessResolving] = useState(false);
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Record<string, string>>({});
  const [editingProviders, setEditingProviders] = useState<Set<string>>(new Set());
  const [skillInstallUrl, setSkillInstallUrl] = useState("");
  const [skillBusy, setSkillBusy] = useState(false);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryScope, setNewMemoryScope] = useState<AgentMemory["scope"]>("global");
  const [newMemoryOrigin, setNewMemoryOrigin] = useState("");
  const t = getCopy(settings.locale);
  const memorySummary = memoryStats(settings.memories);

  const draftDefaultProvider = useMemo(
    () => modelDraft.providers.find((provider) => provider.id === modelDraft.defaultProviderId) ?? modelDraft.providers[0],
    [modelDraft]
  );
  const gatewayExample = gatewayExamples.find((example) => example.id === gatewayExampleTab) ?? gatewayExamples[0];

  useEffect(() => {
    sendRuntimeMessage<ExtensionSettings>({ type: "agenticify:get-settings" })
      .then((loaded) => {
        const normalized = normalizeSettings(loaded);
        setSettings(normalized);
        setModelDraft(normalized);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load settings"));
    sendRuntimeMessage<InstalledSkill[]>({ type: "agenticify:skills-list" })
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    if (!accessRequestId) return;
    sendRuntimeMessage<PendingAccessRequest>({ type: "agenticify:get-access-request", id: accessRequestId })
      .then((request) => {
        setAccessRequest(request);
        setAllowAccessAutoRun(request.requestedAutoRun);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load access request"));
  }, [accessRequestId]);

  const save = async (nextInput: ExtensionSettings) => {
    const next = normalizeSettings(nextInput);
    setSettings(next);
    await chrome.runtime.sendMessage({ type: "agenticify:save-settings", settings: next });
    setStatus(getCopy(next.locale).saved);
  };

  const refreshSkills = async () => {
    const loaded = await sendRuntimeMessage<InstalledSkill[]>({ type: "agenticify:skills-list" });
    setSkills(loaded);
    return loaded;
  };

  const refreshMemories = async () => {
    const loaded = normalizeSettings(await sendRuntimeMessage<ExtensionSettings>({ type: "agenticify:get-settings" }));
    setSettings(loaded);
    setModelDraft(loaded);
    return loaded.memories;
  };

  const installSkill = async () => {
    const url = skillInstallUrl.trim();
    if (!url) return;
    setSkillBusy(true);
    try {
      const skill = await sendRuntimeMessage<InstalledSkill>({ type: "agenticify:skills-install", url });
      setSkillInstallUrl("");
      await refreshSkills();
      const loaded = normalizeSettings(await sendRuntimeMessage<ExtensionSettings>({ type: "agenticify:get-settings" }));
      setSettings(loaded);
      setModelDraft(loaded);
      setStatus(`Installed skill: ${skill.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not install skill");
    } finally {
      setSkillBusy(false);
    }
  };

  const removeSkill = async (id: string) => {
    setSkillBusy(true);
    try {
      await sendRuntimeMessage({ type: "agenticify:skills-remove", id });
      await refreshSkills();
      const loaded = normalizeSettings(await sendRuntimeMessage<ExtensionSettings>({ type: "agenticify:get-settings" }));
      setSettings(loaded);
      setModelDraft(loaded);
      setStatus("Skill removed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove skill");
    } finally {
      setSkillBusy(false);
    }
  };

  const toggleSkill = async (skill: InstalledSkill, enabled: boolean) => {
    if (skill.source === "builtin") return;
    const next = {
      ...settings,
      skills: settings.skills.map((entry) => entry.id === skill.id ? { ...entry, enabled } : entry)
    };
    await save(next);
    await refreshSkills();
  };

  const addMemory = async () => {
    const content = newMemoryContent.trim();
    if (!content) return;
    setMemoryBusy(true);
    try {
      await sendRuntimeMessage<AgentMemory>({
        type: "agenticify:memories-add",
        content,
        scope: newMemoryScope,
        origin: newMemoryScope === "site" ? newMemoryOrigin.trim() : undefined
      });
      setNewMemoryContent("");
      await refreshMemories();
      setStatus(t.saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save memory");
    } finally {
      setMemoryBusy(false);
    }
  };

  const toggleMemory = async (memory: AgentMemory, enabled: boolean) => {
    setMemoryBusy(true);
    try {
      await sendRuntimeMessage<AgentMemory>({ type: "agenticify:memories-update", id: memory.id, patch: { enabled } });
      await refreshMemories();
      setStatus(t.saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update memory");
    } finally {
      setMemoryBusy(false);
    }
  };

  const removeMemory = async (id: string) => {
    setMemoryBusy(true);
    try {
      await sendRuntimeMessage({ type: "agenticify:memories-remove", id });
      await refreshMemories();
      setStatus(t.saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove memory");
    } finally {
      setMemoryBusy(false);
    }
  };

  const updateProvider = (updated: ProviderSettings) => {
    setModelDraft((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === updated.id ? updated : provider)
    }));
  };

  const addProvider = () => {
    const provider = createProvider("openai");
    setModelDraft((current) => ({
      ...current,
      providers: [provider, ...current.providers],
      defaultProviderId: current.defaultProviderId || provider.id,
      defaultModel: current.defaultModel || provider.defaultModel
    }));
    setEditingProviders((current) => new Set(current).add(provider.id));
  };

  const removeProvider = (id: string) => {
    const providers = modelDraft.providers.filter((provider) => provider.id !== id);
    const fallback = providers[0];
    setModelDraft((current) => ({
      ...current,
      providers,
      defaultProviderId: current.defaultProviderId === id ? fallback?.id : current.defaultProviderId,
      defaultModel: current.defaultProviderId === id ? fallback?.defaultModel : current.defaultModel
    }));
  };

  const changeProviderFormat = (provider: ProviderSettings, format: Provider) => {
    const defaults = providerDefaults(format);
    updateProvider({
      ...provider,
      provider: format,
      baseUrl: defaults.baseUrl,
      models: defaults.models,
      defaultModel: defaults.defaultModel
    });
  };

  const addModel = (provider: ProviderSettings) => {
    const model = (modelDrafts[provider.id] || "").trim();
    if (!model || provider.models.includes(model)) return;
    updateProvider({
      ...provider,
      models: [...provider.models, model],
      defaultModel: provider.defaultModel || model
    });
    setModelDrafts((current) => ({ ...current, [provider.id]: "" }));
  };

  const removeModel = (provider: ProviderSettings, model: string) => {
    const models = provider.models.filter((item) => item !== model);
    updateProvider({
      ...provider,
      models,
      defaultModel: provider.defaultModel === model ? models[0] || "" : provider.defaultModel
    });
  };

  const testProvider = async (provider: ProviderSettings) => {
    setTesting((current) => ({ ...current, [provider.id]: t.testing }));
    try {
      const result = await sendRuntimeMessage<{ text: string; model: string }>({
        type: "agenticify:test-provider",
        provider
      });
      setTesting((current) => ({ ...current, [provider.id]: `${t.connected}: ${result.model}` }));
    } catch (error) {
      setTesting((current) => ({ ...current, [provider.id]: error instanceof Error ? error.message : "Connection failed" }));
    }
  };

  const saveModelConfig = async () => {
    const normalized = normalizeSettings(modelDraft);
    setModelDraft(normalized);
    await save(normalized);
  };

  const saveProvider = async (id: string) => {
    await saveModelConfig();
    setEditingProviders((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const editProvider = (id: string) => {
    setEditingProviders((current) => new Set(current).add(id));
  };

  const cancelProviderEdit = (id: string) => {
    const saved = settings.providers.find((provider) => provider.id === id);
    if (!saved) {
      removeProvider(id);
    } else {
      updateProvider(saved);
    }
    setEditingProviders((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const resetModelDraft = () => {
    setModelDraft(settings);
    setStatus("");
  };

  const resolveAccessRequest = async (approved: boolean) => {
    if (!accessRequestId) return;
    setAccessResolving(true);
    try {
      await sendRuntimeMessage({
        type: "agenticify:resolve-access-request",
        id: accessRequestId,
        approved,
        autoRun: allowAccessAutoRun,
        debuggerControl: allowDebuggerControl
      });
      setStatus(approved ? "Site Access granted" : "Site Access denied");
      window.setTimeout(() => window.close(), 350);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not resolve access request");
      setAccessResolving(false);
    }
  };

  const revokePermission = async (origin: string) => {
    await sendRuntimeMessage({ type: "agenticify:revoke-site-access", origin });
    const loaded = normalizeSettings(await sendRuntimeMessage<ExtensionSettings>({ type: "agenticify:get-settings" }));
    setSettings(loaded);
    setModelDraft(loaded);
    setStatus("Site Access revoked");
  };

  if (accessRequestId) {
    const requestsDebuggerControl = accessRequest?.scopes.includes("debugger.control") ?? false;
    return (
      <main className="access-shell">
        <section className="access-panel">
          <div className="access-heading">
            <div className="settings-mark"><ShieldCheck size={18} /></div>
            <div>
              <p className="eyebrow">Site Access</p>
              <h1>Allow this site to use Haro Gateway?</h1>
            </div>
          </div>

          {!accessRequest && <p className="access-muted">{status || "Loading access request..."}</p>}

          {accessRequest && (
            <>
              <div className="access-summary">
                <div>
                  <span>Origin</span>
                  <strong>{accessRequest.origin}</strong>
                </div>
                <div>
                  <span>App name</span>
                  <strong>{accessRequest.appName || "Unnamed site app"}</strong>
                </div>
              </div>

              <div className="access-block">
                <h2>Requested capabilities</h2>
                <ul className="scope-list">
                  {accessRequest.scopes.map((scope) => <li key={scope}>{scopeLabel(scope)} <small>{scope}</small></li>)}
                </ul>
              </div>

              {accessRequest.reason && (
                <div className="access-block">
                  <h2>Reason</h2>
                  <p>{accessRequest.reason}</p>
                </div>
              )}

              <div className="risk-panel">
                <strong>Review carefully</strong>
                <p>This site may send prompts to your configured model and, if page control is granted, request browser actions on the active page. Grant access only to sites you trust.</p>
              </div>

              {requestsDebuggerControl && (
                <Label className="debugger-consent-row">
                  <Switch checked={allowDebuggerControl} onCheckedChange={setAllowDebuggerControl} />
                  <span>
                    <strong>Allow debugger mode</strong>
                    <small>This permits advanced inspection and browser control for this origin. It is stored as a separate Site Access capability and can be revoked later.</small>
                  </span>
                </Label>
              )}

              <Label className={accessRequest.requestedAutoRun ? "auto-run-row" : "auto-run-row disabled"}>
                <Switch
                  checked={accessRequest.requestedAutoRun && allowAccessAutoRun}
                  disabled={!accessRequest.requestedAutoRun}
                  onCheckedChange={setAllowAccessAutoRun}
                />
                <span>
                  <strong>Allow auto-run</strong>
                  <small>{accessRequest.requestedAutoRun ? "Permit this site to start authorized tasks without another prompt." : "This site did not request auto-run."}</small>
                </span>
              </Label>

              <div className="access-actions">
                <Button variant="secondary" disabled={accessResolving} onClick={() => resolveAccessRequest(false)}>Deny</Button>
                <Button disabled={accessResolving || (requestsDebuggerControl && !allowDebuggerControl)} onClick={() => resolveAccessRequest(true)}>Allow</Button>
              </div>
              {status && <p className="access-status">{status}</p>}
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <div className="settings-mark"><Settings2 size={18} /></div>
          <div>
            <div className="settings-title">Haro</div>
            <div className="settings-subtitle">{t.controlCenter}</div>
          </div>
        </div>

        <nav className="settings-nav">
          {navItems.map((item) => (
            <Button variant="ghost" size="sm" className={`nav-item ${tab === item.id ? "active" : ""}`} key={item.id} onClick={() => setTab(item.id)}>
              <item.icon size={17} />
              <span>
                <strong>{t[item.labelKey]}</strong>
                <small>{t[item.detailKey]}</small>
              </span>
            </Button>
          ))}
        </nav>

        <div className="sidebar-status">
          <CheckCircle2 size={14} />
          <span>{status || t.storedLocal}</span>
        </div>
      </aside>

      <section className="settings-main">
        {tab === "models" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t.modelGateway}</p>
                <h1>{t.modelProviders}</h1>
                <p>{t.modelProvidersCopy}</p>
              </div>
              <div className="section-actions">
                <Button variant="secondary" onClick={resetModelDraft}>{t.reset}</Button>
                <Button onClick={saveModelConfig}>{t.saveChanges}</Button>
                <Button variant="secondary" onClick={addProvider}><Plus size={16} /> {t.addProvider}</Button>
              </div>
            </div>

            <div className="provider-list">
              {modelDraft.providers.length === 0 && (
                <Card className="empty-panel">
                  <h2>{t.emptyProviders}</h2>
                  <p>{t.emptyProvidersCopy}</p>
                  <Button onClick={addProvider}><Plus size={16} /> {t.addProvider}</Button>
                </Card>
              )}
              {modelDraft.providers.map((provider) => {
                const isEditing = editingProviders.has(provider.id);
                if (!isEditing) {
                  return (
                    <Card className="provider-panel provider-summary" key={provider.id}>
                      <div>
                        <div className="summary-title">{provider.name || t.newProvider}</div>
                        <div className="provider-meta">{providerFormatLabel(provider.provider)} · {provider.enabled ? t.enabled : t.disabled}</div>
                        <div className="summary-models">{provider.models.length} {t.models} · {provider.baseUrl}</div>
                      </div>
                      <div className="provider-actions">
                        <Button variant="secondary" onClick={() => testProvider(provider)}><Wifi size={15} /> {t.test}</Button>
                        <Button variant="secondary" onClick={() => editProvider(provider.id)}>{t.edit}</Button>
                        <Button variant="destructive" size="icon" onClick={() => removeProvider(provider.id)} title="Delete Provider"><Trash2 size={16} /></Button>
                      </div>
                      {testing[provider.id] && <div className={testing[provider.id].startsWith(t.connected) ? "test-status ok summary-test" : "test-status summary-test"}>{testing[provider.id]}</div>}
                    </Card>
                  );
                }

                return (
                <Card className="provider-panel" key={provider.id}>
                  <div className="provider-header">
                    <div>
                      <Label>{t.providerName}</Label>
                      <Input
                        className="provider-name"
                        placeholder={t.providerNamePlaceholder}
                        value={provider.name}
                        onChange={(event) => updateProvider({ ...provider, name: event.target.value })}
                      />
                      <div className="provider-meta">{provider.name || t.newProvider} · {providerFormatLabel(provider.provider)} · {provider.enabled ? t.enabled : t.disabled}</div>
                    </div>
                    <div className="provider-actions">
                      <Label className="switch-label">
                        <Switch checked={provider.enabled} onCheckedChange={(checked) => updateProvider({ ...provider, enabled: checked })} />
                        {t.enabled}
                      </Label>
                      <Button variant="secondary" onClick={() => testProvider(provider)}><Wifi size={15} /> {t.test}</Button>
                      <Button onClick={() => saveProvider(provider.id)}>{t.save}</Button>
                      <Button variant="ghost" onClick={() => cancelProviderEdit(provider.id)}>{t.cancel}</Button>
                      <Button variant="destructive" size="icon" onClick={() => removeProvider(provider.id)} title="Delete Provider"><Trash2 size={16} /></Button>
                    </div>
                  </div>

                  <div className="provider-grid">
                    <div>
                      <Label>{t.providerFormat}</Label>
                      <Select value={provider.provider} onValueChange={(value) => changeProviderFormat(provider, value as Provider)}>
                        <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI-compatible</SelectItem>
                          <SelectItem value="anthropic">Anthropic-compatible</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t.baseUrl}</Label>
                      <Input className="mt-2" value={provider.baseUrl ?? ""} onChange={(event) => updateProvider({ ...provider, baseUrl: event.target.value })} />
                    </div>
                    <div>
                      <Label>{t.apiKey}</Label>
                      <Input className="mt-2" type="password" value={provider.apiKey} onChange={(event) => updateProvider({ ...provider, apiKey: event.target.value })} />
                      <p className="field-hint">{t.apiKeyLocalOnly}</p>
                    </div>
                    <div>
                      <Label>{t.providerDefaultModel}</Label>
                      <Select
                        value={provider.defaultModel || provider.models[0]}
                        onValueChange={(value) => updateProvider({ ...provider, defaultModel: value })}
                      >
                        <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {provider.models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="models-block">
                    <div className="models-heading">
                      <span>{t.models}</span>
                      <small>{t.modelsHelp}</small>
                    </div>
                    <div className="model-chips">
                      {provider.models.map((model) => (
                        <span className="model-chip" key={model}>
                          {model}
                          <Button variant="ghost" size="icon" className="model-chip-remove" onClick={() => removeModel(provider, model)} title="Remove model">×</Button>
                        </span>
                      ))}
                    </div>
                    <div className="add-model-row">
                      <Input
                        placeholder={provider.provider === "openai" ? "gpt-4.1, o3-mini, ..." : "claude-3-5-sonnet-latest, ..."}
                        value={modelDrafts[provider.id] || ""}
                        onChange={(event) => setModelDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") addModel(provider);
                        }}
                      />
                      <Button variant="secondary" onClick={() => addModel(provider)}><Plus size={15} /> {t.addModel}</Button>
                    </div>
                    {testing[provider.id] && <div className={testing[provider.id].startsWith(t.connected) ? "test-status ok" : "test-status"}>{testing[provider.id]}</div>}
                  </div>
                </Card>
                );
              })}
            </div>

            {modelDraft.providers.length > 0 && (
              <Card className="default-panel">
                <div>
                  <p className="eyebrow">{t.defaultRuntime}</p>
                  <h2>{t.defaultProviderModel}</h2>
                  <p>{t.defaultProviderModelCopy}</p>
                </div>
                <div className="default-grid">
                  <div>
                    <Label>{t.defaultProvider}</Label>
                    <Select
                      value={modelDraft.defaultProviderId || draftDefaultProvider?.id}
                      onValueChange={(value) => {
                        const provider = modelDraft.providers.find((item) => item.id === value);
                        setModelDraft((current) => ({ ...current, defaultProviderId: value, defaultModel: provider?.models[0] }));
                      }}
                    >
                      <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {modelDraft.providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name || t.newProvider}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t.defaultModel}</Label>
                    <Select value={modelDraft.defaultModel || draftDefaultProvider?.models[0]} onValueChange={(value) => setModelDraft((current) => ({ ...current, defaultModel: value }))}>
                      <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(draftDefaultProvider?.models || []).map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={saveModelConfig}>{t.saveChanges}</Button>
                </div>
              </Card>
            )}
          </section>
        )}

        {tab === "skills" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Skills</p>
                <h1>{t.skills}</h1>
                <p>{t.skillsCopy}</p>
              </div>
            </div>

            <Card className="skill-install-panel">
              <div>
                <h2>{t.installSkill}</h2>
                <p>{t.installSkillCopy}</p>
              </div>
              <div className="skill-install-row">
                <Input
                  placeholder="https://skills.sh/owner/repo/skill"
                  value={skillInstallUrl}
                  onChange={(event) => setSkillInstallUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") installSkill();
                  }}
                />
                <Button disabled={skillBusy || !skillInstallUrl.trim()} onClick={installSkill}><Plus size={15} /> {t.install}</Button>
              </div>
            </Card>

            <div className="skill-list">
              {skills.map((skill) => (
                <Card className="skill-card" key={skill.id}>
                  <div className="skill-main">
                    <div className="skill-title-row">
                      <h2>{skill.name}</h2>
                      <span className={skill.enabled ? "status-pill on" : "status-pill"}>{skill.enabled ? t.enabled : t.disabled}</span>
                      <span className="status-pill">{skillSourceLabel(skill.source)}</span>
                    </div>
                    <p>{skill.description}</p>
                    <div className="skill-meta">{skill.id}{skill.sourceUrl ? ` · ${skill.sourceUrl}` : ""}</div>
                  </div>
                  {!isBuiltInSkillId(skill.id) && (
                    <div className="skill-actions">
                      <Label className="switch-label">
                        <Switch checked={skill.enabled} onCheckedChange={(checked) => toggleSkill(skill, checked)} />
                        {t.enabled}
                      </Label>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={skillBusy}
                        onClick={() => removeSkill(skill.id)}
                      >
                        <Trash2 size={15} /> {t.remove}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
              {skills.length === 0 && (
                <Card className="empty-panel">
                  <h2>{t.noSkills}</h2>
                  <p>{t.noSkillsCopy}</p>
                </Card>
              )}
            </div>
          </section>
        )}

        {tab === "memory" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Memory</p>
                <h1>{t.memory}</h1>
                <p>{t.memoryCopy}</p>
              </div>
            </div>

            <div className="memory-overview">
              <Card className="memory-stat-card">
                <span>{t.total}</span>
                <strong>{memorySummary.total}</strong>
              </Card>
              <Card className="memory-stat-card">
                <span>{t.enabled}</span>
                <strong>{memorySummary.enabled}</strong>
              </Card>
              <Card className="memory-stat-card">
                <span>{t.global}</span>
                <strong>{memorySummary.global}</strong>
              </Card>
              <Card className="memory-stat-card">
                <span>{t.site}</span>
                <strong>{memorySummary.site}</strong>
              </Card>
            </div>

            <Card className="memory-compose-panel">
              <div className="memory-compose-copy">
                <div>
                  <p className="eyebrow">{t.addMemory}</p>
                  <h2>{t.addMemory}</h2>
                </div>
                <p>{t.addMemoryCopy}</p>
              </div>
              <div className="memory-create-row">
                <Textarea
                  placeholder={t.memoryContentPlaceholder}
                  value={newMemoryContent}
                  onChange={(event) => setNewMemoryContent(event.target.value)}
                />
                <div className="memory-create-controls">
                  <div>
                    <Label>{t.scope}</Label>
                    <Select value={newMemoryScope} onValueChange={(value) => setNewMemoryScope(value === "site" ? "site" : "global")}>
                      <SelectTrigger className="compact-field mt-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">{t.global}</SelectItem>
                        <SelectItem value="site">{t.site}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newMemoryScope === "site" && (
                    <div>
                      <Label>{t.origin}</Label>
                      <Input
                        className="mt-2"
                        placeholder="https://example.com"
                        value={newMemoryOrigin}
                        onChange={(event) => setNewMemoryOrigin(event.target.value)}
                      />
                    </div>
                  )}
                  <Button disabled={memoryBusy || !newMemoryContent.trim()} onClick={addMemory}><Plus size={15} /> {t.save}</Button>
                </div>
              </div>
            </Card>

            <div className="memory-list">
              {settings.memories.map((memory) => (
                <Card className="memory-card" key={memory.id}>
                  <div className="memory-card-main">
                    <div className="memory-card-topline">
                      <div className="memory-card-badges">
                      <span className={memory.enabled ? "status-pill on" : "status-pill"}>{memory.enabled ? t.enabled : t.disabled}</span>
                      <span className="status-pill">{memoryLayerLabel(memory.layer)}</span>
                      <span className="status-pill">{memoryScopeLabel(memory.scope)}</span>
                      <span className="status-pill">{memorySourceLabel(memory.source)}</span>
                      </div>
                      <span className="memory-card-date">{formatDateTime(memory.updatedAt)}</span>
                    </div>
                    <p className="memory-content">{memory.content}</p>
                    <div className="memory-meta-grid">
                      <span><strong>{t.scope}</strong>{memory.scope === "site" ? memory.origin || t.unknown : t.global}</span>
                      <span><strong>{t.created}</strong>{formatDateTime(memory.createdAt)}</span>
                      <span><strong>{t.updated}</strong>{formatDateTime(memory.updatedAt)}</span>
                      {memory.lastUsedAt && <span><strong>{t.lastUsed}</strong>{formatDateTime(memory.lastUsedAt)}</span>}
                    </div>
                  </div>
                  <div className="memory-card-actions">
                    <Label className="switch-label">
                      <Switch checked={memory.enabled} onCheckedChange={(checked) => toggleMemory(memory, checked)} />
                      {t.enabled}
                    </Label>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={memoryBusy}
                      onClick={() => removeMemory(memory.id)}
                    >
                      <Trash2 size={15} /> {t.remove}
                    </Button>
                  </div>
                </Card>
              ))}
              {settings.memories.length === 0 && (
                <Card className="empty-panel memory-empty-panel">
                  <div className="settings-mark"><Brain size={18} /></div>
                  <h2>{t.noMemories}</h2>
                  <p>{t.noMemoriesCopy}</p>
                </Card>
              )}
            </div>
          </section>
        )}

        {tab === "gateway" && (
          <section className="page-section narrow">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Gateway Access</p>
                <h1>{t.websiteGateway}</h1>
                <p>{t.websiteGatewayCopy}</p>
              </div>
            </div>
            <div className="gateway-toggle-card">
              <div>
                <div className="gateway-toggle-title">
                  <strong>{t.enableGateway}</strong>
                  <span className={settings.gateway.enabled ? "status-pill on" : "status-pill"}>{settings.gateway.enabled ? t.enabled : t.disabled}</span>
                </div>
                <span>{t.enableGatewayCopy}</span>
              </div>
              <Switch
                className="gateway-switch"
                checked={settings.gateway.enabled}
                aria-label={t.enableGateway}
                onCheckedChange={(checked) => save({ ...settings, gateway: { enabled: checked } })}
              />
            </div>
            <Card className="gateway-example-panel">
              <div className="example-tabs" role="tablist" aria-label="Gateway protocol examples">
                {gatewayExamples.map((example) => (
                  <Button
                    key={example.id}
                    role="tab"
                    aria-selected={gatewayExampleTab === example.id}
                    variant={gatewayExampleTab === example.id ? "default" : "ghost"}
                    size="sm"
                    className="example-tab"
                    onClick={() => setGatewayExampleTab(example.id)}
                  >
                    {example.label}
                  </Button>
                ))}
              </div>
              <div className="example-copy">
                <h2>{gatewayExample.title}</h2>
                <p>{gatewayExample.description}</p>
              </div>
              <pre className="code-block gateway-code"><code>{gatewayExample.code}</code></pre>
              <p className="gateway-envelope">{t.gatewayEnvelopeCopy}</p>
            </Card>
          </section>
        )}

        {tab === "sites" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t.permissions}</p>
                <h1>{t.siteAccess}</h1>
              </div>
            </div>
            <table className="data-table">
              <thead><tr><th>{t.origin}</th><th>App</th><th>{t.scopes}</th><th>{t.autoRun}</th><th>{t.status}</th><th>{t.lastUsed}</th><th></th></tr></thead>
              <tbody>
                {settings.permissions.map((permission) => (
                  <tr key={permission.origin}>
                    <td>{permission.origin}</td>
                    <td>{permission.appName || t.unknown}</td>
                    <td>{permission.scopes.join(", ")}</td>
                    <td>{permission.autoRun ? t.allowed : t.off}</td>
                    <td>{permission.revokedAt ? "Revoked" : t.allowed}</td>
                    <td>{permission.lastUsedAt || t.never}</td>
                    <td>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={Boolean(permission.revokedAt)}
                        onClick={() => revokePermission(permission.origin)}
                      >
                        <Trash2 size={15} /> Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === "history" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t.observability}</p>
                <h1>{t.callHistory}</h1>
              </div>
            </div>
            <table className="data-table">
              <thead><tr><th>{t.time}</th><th>{t.source}</th><th>{t.origin}</th><th>{t.type}</th><th>{t.model}</th><th>{t.status}</th></tr></thead>
              <tbody>
                {settings.callLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.createdAt}</td>
                    <td>{log.source}</td>
                    <td>{log.origin || t.sidebar}</td>
                    <td>{log.type}</td>
                    <td>{log.model || t.unknown}</td>
                    <td>{log.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === "advanced" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t.advanced}</p>
                <h1>{t.debugLogs}</h1>
              </div>
            </div>
            <div className="debug-list">
              {settings.debugLogs.map((log) => (
                <details className="debug-item" key={log.id}>
                  <summary>{log.createdAt} · {log.title}</summary>
                  <pre>{JSON.stringify(log.details, null, 2)}</pre>
                </details>
              ))}
            </div>
          </section>
        )}

        {tab === "system" && (
          <section className="page-section narrow">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t.system}</p>
                <h1>{t.systemSettings}</h1>
                <p>{t.systemSettingsCopy}</p>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <strong>{t.languageSetting}</strong>
                <span>{t.languageSettingCopy}</span>
              </div>
              <Select value={settings.locale} onValueChange={(value) => save({ ...settings, locale: value === "zh" ? "zh" : "en" })}>
                <SelectTrigger className="compact-field"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
