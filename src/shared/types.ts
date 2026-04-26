export type Provider = "openai" | "anthropic";
export type Locale = "en" | "zh";

export type MessageRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: MessageRole;
  content: string;
};

export type ProviderSettings = {
  id: string;
  name: string;
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  models: string[];
  defaultModel: string;
  enabled: boolean;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ModelRequest = {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type ModelResponse = {
  provider: Provider;
  model: string;
  text: string;
  usage?: ModelUsage;
  raw?: unknown;
};

export type ModelGateway = {
  chat(messages: ChatMessage[]): Promise<ModelResponse>;
};

export type Scope = "model.chat" | "page.read" | "page.act" | "agent.run" | "debugger.control";
export type AgentControlMode = "dom" | "debugger" | "auto";
export type AgentTaskIntent = "memory" | "chat" | "run";

export type SitePermission = {
  origin: string;
  appName?: string;
  scopes: Scope[];
  autoRun: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CallSource = "sidebar" | "gateway";
export type CallType = "access" | "chat" | "run";
export type CallStatus = "success" | "failed" | "denied" | "canceled" | "revoked";

export type CallLog = {
  id: string;
  source: CallSource;
  origin?: string;
  type: CallType;
  model?: string;
  status: CallStatus;
  createdAt: string;
  summary?: string;
};

export type DebugLog = {
  id: string;
  callId?: string;
  createdAt: string;
  title: string;
  details: unknown;
};

export type GatewaySettings = {
  enabled: boolean;
};

export type AgentMemoryScope = "global" | "site";
export type AgentMemoryLayer = "profile" | "site" | "interaction";
export type AgentMemorySource = "explicit" | "manual" | "auto" | "summary";

export type AgentMemory = {
  id: string;
  content: string;
  scope: AgentMemoryScope;
  layer: AgentMemoryLayer;
  origin?: string;
  source: AgentMemorySource;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type ExtensionSettings = {
  locale: Locale;
  providers: ProviderSettings[];
  defaultProviderId?: string;
  defaultModel?: string;
  gateway: GatewaySettings;
  skills: InstalledSkill[];
  memories: AgentMemory[];
  permissions: SitePermission[];
  callLogs: CallLog[];
  debugLogs: DebugLog[];
};

export type InteractiveElement = {
  selector: string;
  tagName: string;
  label: string;
  role?: string;
};

export type DomObservation = {
  title: string;
  url: string;
  origin: string;
  text: string;
  selectedText?: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  interactiveElements: InteractiveElement[];
};

export type ConversationMemoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationMemory = {
  turns: ConversationMemoryTurn[];
  memories?: AgentMemory[];
};

export type DomAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; value: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number };

export type AgentReadAction = { type: "read" };
export type AgentDebuggerAction = { type: "debugger"; reason?: string };
export type AgentSkillAction = { type: "skill"; skillId: string; input?: Record<string, unknown> };
export type AgentAction = DomAction | AgentReadAction | AgentDebuggerAction | AgentSkillAction;
export type AgentActionStatus = "success" | "failed" | "needs_confirmation" | "blocked";

export type DomActionResult = {
  ok: boolean;
  status?: AgentActionStatus;
  message: string;
  skillDraft?: InstalledSkill;
  benchmarkResult?: BenchmarkToolResult;
};

export type DebuggerSnapshot = DomObservation & {
  source: "debugger";
  document?: unknown;
  accessibilityTree?: unknown[];
};

export type DebuggerAction =
  | { type: "attach" }
  | { type: "detach" }
  | { type: "snapshot" }
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "click"; x: number; y: number }
  | { type: "click"; selector: string }
  | { type: "type"; text: string; selector?: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; ms?: number };

export type DebuggerActionResult = {
  ok: boolean;
  message: string;
  observation?: DebuggerSnapshot;
  screenshot?: PageScreenshot;
  rewrite?: PageRewriteResult;
  formFill?: FormFillResult;
};

export type PageScreenshot = {
  dataUrl: string;
  mimeType: "image/png";
  width: number;
  height: number;
  filename: string;
};

export type PageTextReplacement = {
  index: number;
  original: string;
  replacement: string;
};

export type PageRewriteResult = {
  sessionId: string;
  changed: number;
  replacements: PageTextReplacement[];
};

export type FormFillField = {
  selector: string;
  value: string;
};

export type FormFillResult = {
  filled: number;
  skipped: Array<{ selector: string; reason: string }>;
};

export type BenchmarkToolRequest =
  | { type: "screenshot" }
  | { type: "report" }
  | { type: "rewrite"; instruction: string }
  | { type: "restore-rewrite"; sessionId?: string }
  | { type: "fill-form"; instruction: string };

export type InstalledSkill = {
  id: string;
  name: string;
  description: string;
  skillMarkdown: string;
  enabled: boolean;
  source: "builtin" | "skills.sh" | "manual";
  sourceUrl?: string;
  installedAt?: string;
  updatedAt?: string;
};

export type BenchmarkToolResult =
  | { type: "screenshot"; title: string; screenshot: PageScreenshot }
  | { type: "report"; title: string; html: string }
  | { type: "rewrite"; title: string; rewrite: PageRewriteResult }
  | { type: "restore-rewrite"; title: string; restored: number }
  | { type: "fill-form"; title: string; formFill: FormFillResult };

export type AgentEvent =
  | { type: "observe"; observation: DomObservation }
  | { type: "thought"; text: string; confidence?: number }
  | { type: "plan"; text: string; confidence?: number }
  | { type: "action"; action: AgentAction; reason: string; confidence?: number }
  | { type: "action-result"; action: AgentAction; result: DomActionResult }
  | { type: "blocked"; reason: string; status: "needs_confirmation" | "blocked" }
  | { type: "final"; text: string };

export type GatewayErrorCode =
  | "permission_denied"
  | "model_not_configured"
  | "user_rejected"
  | "gateway_disabled"
  | "page_unavailable"
  | "page_not_operable"
  | "debugger_control_unavailable"
  | "invalid_request"
  | "internal_error";

export type GatewayMethod = "requestAccess" | "getStatus" | "chat" | "run" | "models.list";

export type BrowserAgentRequest =
  | { id: string; requestId: string; source: "agenticify-page"; version: "1"; method: "requestAccess"; payload: AccessRequestPayload }
  | { id: string; requestId: string; source: "agenticify-page"; version: "1"; method: "getStatus"; payload?: undefined }
  | { id: string; requestId: string; source: "agenticify-page"; version: "1"; method: "chat"; payload: ChatPayload }
  | { id: string; requestId: string; source: "agenticify-page"; version: "1"; method: "run"; payload: RunPayload }
  | { id: string; requestId: string; source: "agenticify-page"; version: "1"; method: "models.list"; payload?: undefined };

export type GatewayError = {
  code: GatewayErrorCode;
  message: string;
  details?: unknown;
};

export type BrowserAgentResponse =
  | { id: string; requestId: string; source: "agenticify-extension"; ok: true; result: unknown }
  | { id: string; requestId: string; source: "agenticify-extension"; ok: false; code: GatewayErrorCode; error: GatewayError };

export type AccessRequestPayload = {
  appName?: string;
  scopes: Scope[];
  reason?: string;
  autoRun?: boolean;
};

export type PendingAccessRequest = {
  id: string;
  origin: string;
  appName?: string;
  scopes: Scope[];
  reason?: string;
  requestedAutoRun: boolean;
  createdAt: string;
};

export type ChatPayload = {
  messages: ChatMessage[];
};

export type RunPayload = {
  task: string;
  mode?: AgentControlMode;
};
