# Agenticify 端侧模型与隐私网关设计

Date: 2026-05-02

## 1. 背景

Agenticify 当前的模型能力主要通过用户配置的 OpenAI-compatible / Anthropic-compatible provider 访问外部模型。这个模型适合复杂推理和长上下文任务，但对浏览器插件有三个明显问题：

1. 简单任务也要走外部模型，响应速度受网络和 provider 延迟影响。
2. Agent 的意图识别、任务路由、风险判断不需要大模型能力，但当前仍容易依赖外部模型。
3. 页面上下文可能包含邮箱、手机号、地址、订单号、token、表单内容等敏感信息，在发送给外部模型前缺少本地语义级检查。

端侧模型的目标不是替代外部模型，而是在浏览器内提供一个低延迟、隐私优先的第一道模型层：先做意图识别、简单问题处理、敏感信息识别与拦截，再决定是否调用用户配置的外部模型。

## 2. 目标

1. 在插件内增加端侧模型管理能力，第一版优先基于 WebLLM。
2. 端侧模型用于快速意图识别、简单问题处理、隐私扫描、上下文脱敏、外部调用安全门。
3. 保持现有 Model Gateway provider 体系可用，不破坏 OpenAI/Anthropic-compatible provider。
4. 为 Agent runtime 提供清晰接入方式：本地模型先判定，再由外部模型处理复杂任务。
5. 将端侧模型能力通过内部服务和受控 Gateway API 透出，避免页面直接访问模型权重、API key 或未授权页面上下文。
6. 端侧模型由用户显式选择、下载、配置和启停；插件只提供管理入口、加载状态和安全接入，不自动下载模型。

## 3. 非目标

1. 第一版不追求完全离线 Agent，不用端侧模型完成复杂多步浏览器任务。
2. 第一版不内置第三方远程 provider preset。
3. 第一版不把网页的任意 prompt 直接转发给端侧模型；仍需 Gateway 权限控制。
4. 第一版不依赖端侧模型做百分百准确的隐私合规判断；它是安全门之一，不是唯一机制。
5. 第一版不做多端同步模型缓存，也不做模型权重分发平台。

## 4. WebLLM 采用原则

WebLLM 提供浏览器内 LLM 推理，使用 WebGPU 加速，并兼容 OpenAI 风格 chat completions API。文档中可用能力包括：

- `@mlc-ai/web-llm` npm 包。
- `CreateMLCEngine` / `MLCEngine.reload(model)`。
- `CreateWebWorkerMLCEngine` + `WebWorkerMLCEngineHandler`。
- OpenAI 风格 `engine.chat.completions.create({ messages })`。
- streaming、JSON mode、模型缓存 backend、Chrome extension 示例。

Agenticify 第一版建议使用 WebLLM 的 Dedicated Worker 方式，而不是把模型直接放在 React 页面主线程或 MV3 background service worker 中：

```text
background service worker
  -> LocalModelHost client
    -> offscreen document or extension page runtime
      -> dedicated Web Worker
        -> WebWorkerMLCEngineHandler
          -> WebLLM / WebGPU
```

原因：

- WebLLM 首次加载和推理会占用 CPU/GPU 和内存，不应阻塞 Options/Sidepanel UI。
- MV3 background service worker 生命周期可能被浏览器回收，不适合作为唯一常驻模型宿主。
- Offscreen document 或扩展页面可以作为模型宿主，background 只做路由和权限判断。
- Dedicated Worker 能隔离重计算，并保留 WebLLM 官方推荐的 worker 接入方式。

如果后续验证 WebLLM service worker 在 Chrome extension 环境中稳定，再考虑替换或补充为 service worker engine。第一版不要把该路径作为主方案。

## 5. 总体架构

新增模块：

```text
src/local-model/
  config.ts              端侧模型候选列表和默认配置
  types.ts               LocalModelProfile / LocalModelRequest / LocalModelResult
  host.ts                background 侧 LocalModelService client
  worker.ts              WebLLM worker handler
  engine.ts              WebLLM engine lifecycle wrapper
  policy.ts              意图识别、简单回答、隐私扫描、脱敏策略
  privacy.ts             规则 + 模型混合敏感信息识别
  index.test.ts

src/options/
  LocalModel settings UI

src/shared/
  types.ts               增加 localModels / privacyPolicy / localModel gateway 类型
  storage.ts             normalize local model settings
```

运行链路：

```text
User task / Gateway request
  -> background policy entry
  -> observe page if needed
  -> LocalPolicyEngine
     -> classify intent
     -> detect sensitive spans
     -> decide local answer / redact / block / escalate
  -> if local answer: return immediately
  -> if external needed:
       sanitize ModelRequest
       call external Model Gateway
  -> Agent runtime receives local policy hints and model gateway wrapper
```

核心原则：

- 端侧模型先于外部模型运行。
- 外部模型只能收到 LocalPolicyEngine 允许的上下文。
- 所有 provider API key 仍只在 extension storage 中。
- 网页只能通过 `window.browserAgent` 的权限模型访问能力，不能直接访问 local model host。

## 6. 端侧模型管理

### 6.1 LocalModelProfile

新增本地模型 profile，与外部 provider profile 分开：

```ts
type LocalModelRuntime = "webllm";
type LocalModelPurpose = "intent" | "privacy" | "simple-chat" | "agent-policy";
type LocalModelLoadState = "not-loaded" | "loading" | "ready" | "failed";

type LocalModelProfile = {
  id: string;
  name: string;
  runtime: LocalModelRuntime;
  modelId: string;
  enabled: boolean;
  purposes: LocalModelPurpose[];
  defaultForPurposes: LocalModelPurpose[];
  cacheBackend?: "cache" | "indexeddb";
  temperature?: number;
  maxTokens?: number;
  contextWindowHint?: number;
  createdAt: string;
  updatedAt: string;
};
```

### 6.2 用户下载与配置策略

第一版不自动下载端侧模型，也不在安装后默认启用端侧模型。用户必须在设置页中显式完成三步：

1. 选择 WebLLM model id。
2. 点击下载/加载，并等待模型进入 ready 状态。
3. 勾选这个模型承担的用途，再启用端侧模型策略。

配置原则：

- 小模型优先：用于意图识别、隐私分类、简单回答。
- 插件可以展示少量推荐模型 id，但这些只是建议，不是自动 provider preset。
- UI 必须提示：模型由用户主动下载；首次下载耗时和体积取决于模型；模型缓存保存在浏览器本地；清理浏览器缓存可能导致需要重新下载。
- 未下载或未 ready 的端侧模型不得参与 Agent 决策，也不得让用户误以为隐私扫描已启用。

一个端侧模型 profile 可以承担多个用途：

- `intent`
- `privacy`
- `simple-chat`
- `agent-policy`

第一版可以允许用户配置多个本地模型 profile，但默认路由只选择一个 ready profile。后续再允许不同 purpose 使用不同本地模型。

### 6.3 端侧模型用途说明

Options UI 必须明确说明端侧模型的用途和边界：

1. 意图识别  
   在本地判断用户请求是普通聊天、页面问答、记忆、浏览器操作还是不支持的任务，减少不必要的外部模型调用。

2. 简单问题快速处理  
   对标题、选中文本、短页面片段、轻量翻译、格式整理等任务直接本地回答，提高响应速度。

3. 隐私识别与拦截  
   在页面内容发往外部模型前，本地识别邮箱、手机号、地址、token、订单、财务等敏感信息，并按策略脱敏、阻断或请求用户确认。

4. Agent 策略建议  
   为 Agent 提供上下文裁剪、风险等级、是否需要页面全文、是否可以走外部模型等策略提示。端侧模型不直接执行浏览器动作。

5. 外部模型调用前的安全门  
   复杂任务仍可交给用户配置的外部模型，但外部请求必须先经过本地 privacy guard。

### 6.4 Options 管理页面

端侧模型管理放在现有 Models/Gateway 页面下的独立 section，标题建议为 `Local Models` 或 `On-device Models`。不要新增一级页面，避免设置结构变复杂。

布局建议：

```text
Models
  - External Providers
  - Default Provider / Model
  - Local Models

Gateway
  - BrowserAgent Gateway switch
  - Gateway examples
  - Local model gateway status
```

必需能力：

- 启用/停用端侧模型。
- 选择 WebLLM model id。
- 用户手动下载/加载模型。
- 显示加载状态、下载进度、缓存状态、最近错误。
- 选择用途：意图识别、简单问题、隐私扫描、Agent policy。
- 清理本地模型缓存。
- 配置隐私策略：`off` / `redact` / `block` / `ask`。
- 说明端侧模型只在本机运行，不会把 API key 暴露给网页；但下载模型 artifacts 仍需要访问模型来源。

状态展示：

```text
Local model
Status: Ready / Loading 42% / Failed / Not loaded
Runtime: WebLLM + WebGPU
Cache: IndexedDB
Purposes: Intent, Privacy, Simple Chat
```

当模型未 ready 时，UI 应显示：

```text
Local model is not active. Agenticify will use rule-based privacy checks only until you load a local model.
```

### 6.5 存储

扩展 `ExtensionSettings`：

```ts
type PrivacyPolicyMode = "off" | "redact" | "block" | "ask";

type LocalModelSettings = {
  enabled: boolean;
  defaultProfileId?: string;
  profiles: LocalModelProfile[];
  privacy: {
    mode: PrivacyPolicyMode;
    scanPageText: boolean;
    scanSelectedText: boolean;
    scanFormValues: boolean;
    blockHighConfidenceSecrets: boolean;
  };
};
```

注意：模型权重不进入 `chrome.storage.local`，只保存配置和状态摘要。模型 artifacts 使用 WebLLM cache backend。

## 7. 本地模型服务透出

### 7.1 内部服务接口

background 侧统一通过 `LocalModelService` 访问端侧模型：

```ts
type LocalModelRequest = {
  purpose: LocalModelPurpose;
  messages: ChatMessage[];
  responseFormat?: "text" | "json";
  jsonSchema?: unknown;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

type LocalModelResult = {
  ok: boolean;
  profileId: string;
  modelId: string;
  purpose: LocalModelPurpose;
  text: string;
  json?: unknown;
  usage?: ModelUsage;
  latencyMs: number;
  fallbackReason?: string;
};
```

`LocalModelService` 负责：

- 确保 host 已启动。
- 确保目标 model 已加载。
- 把 progress 和错误写入本地状态。
- 统一超时、abort、错误码。
- 在模型不可用时返回明确 fallback reason，不静默降级。

### 7.2 Gateway API 透出

对网页透出时必须走现有 BrowserAgent Gateway 权限模型。建议增加两个受控方法：

```ts
type GatewayMethod =
  | "requestAccess"
  | "getStatus"
  | "chat"
  | "run"
  | "models.list"
  | "local.status"
  | "local.classify";
```

`local.status`：

- 权限：可以无额外 scope 返回有限状态。
- 返回：是否启用、是否 ready、可用 purposes、默认 local model id。
- 不返回模型缓存路径、内部错误详情、权重 URL。

`local.classify`：

- 权限：需要 `model.chat` 或新增 `local.model` scope。第一版建议复用 `model.chat`，避免 scope 膨胀。
- 输入：短文本、可选 purpose。
- 输出：intent / sensitivity / simple-answer decision。
- 限制：只处理调用方提供的文本，不自动附带页面全文。

不建议第一版暴露通用 `local.chat`，否则网页可能把端侧模型当成无约束本地算力使用。需要先通过 `local.classify` 和 `models.list` 观察使用方式。

## 8. 隐私识别与拦截

### 8.1 混合检测

隐私检测不要完全依赖 LLM。第一版采用规则 + 端侧模型混合：

规则层：

- 邮箱
- 手机号 / 电话
- 信用卡号候选
- 身份证/护照号候选
- 地址关键词
- API key / token / Bearer / cookie-like 字符串
- 密码字段、隐藏字段、文件输入
- 页面表单值

端侧模型层：

- 判断文本片段是否包含个人身份信息。
- 判断是否是商业敏感数据、订单信息、财务信息、医疗信息。
- 给出 sensitivity label、confidence、建议动作。

统一输出：

```ts
type SensitiveSpan = {
  id: string;
  label: "email" | "phone" | "address" | "token" | "credential" | "financial" | "personal" | "unknown";
  text: string;
  start?: number;
  end?: number;
  confidence: number;
  source: "rule" | "local-model";
  action: "allow" | "redact" | "block" | "ask";
};

type PrivacyScanResult = {
  hasSensitiveData: boolean;
  maxRisk: "low" | "medium" | "high";
  spans: SensitiveSpan[];
  recommendedAction: "allow" | "redact" | "block" | "ask";
  redactedText?: string;
};
```

### 8.2 外部模型调用前的安全门

所有发往外部 provider 的 `ModelRequest` 都经过 `PrivacyGuard`：

```text
ModelRequest
  -> collect candidate text fields
  -> rule scan
  -> local model scan if enabled and text is non-trivial
  -> apply policy
     - off: allow
     - redact: replace spans with labels
     - block: throw privacy_blocked error
     - ask: create user confirmation prompt
  -> external Model Gateway
```

脱敏示例：

```text
Original: Email ada@example.com and order A-10292 need support.
Redacted: Email [email:redacted] and order [personal:redacted] need support.
```

日志规则：

- callLogs 只记录 summary，不记录原文。
- debugLogs 记录 privacy result 的 label/count/risk，不记录 sensitive span 原文。
- 如果需要调试，必须提供显式开发开关，默认关闭。

## 9. Agent 中的对接方式

### 9.1 当前 Agent 接入点

当前 Agent runtime 通过 `ModelGateway` 抽象调用模型：

```ts
type ModelGateway = {
  chat(messages: ChatMessage[]): Promise<ModelResponse>;
};
```

`runAgentTask` 在每个 observe-act step 中读取页面，再调用 `modelGateway.chat(buildMessages(...))`。这给端侧模型提供了一个清晰插入点：不要修改 Agent 核心推理循环，而是在 background 组装传入 Agent 的 gateway wrapper。

### 9.2 新增 AgentPolicyEngine

在 background 侧增加 `AgentPolicyEngine`：

```text
runTask()
  -> classifyTaskIntentLocal(task, optional page summary)
  -> if simple local answer: return without external model
  -> create guardedModelGateway
  -> runAgentTask({ modelGateway: guardedModelGateway, policyHints })
```

本地模型用于四类 Agent 决策：

1. Intent routing  
   判断任务是 `memory`、`chat`、`run`、`simple-answer`、`unsupported`。替代或增强当前正则版 `classifyTaskIntent`。

2. Context minimization  
   决定是否需要页面全文、只需要标题/选中文本/heading、还是完全不需要页面上下文。

3. Privacy guard  
   对即将进入 prompt 的页面文本和用户任务做扫描与脱敏。

4. Simple answer fast path  
   对不需要外部知识和复杂推理的问题直接本地回答，例如：
   - “这个页面标题是什么？”
   - “把选中文本翻译成中文。”
   - “这个按钮是什么意思？”
   - “总结这一小段选中文本。”

### 9.3 GuardedModelGateway

Agent runtime 不直接知道外部 provider，也不直接知道 WebLLM。background 传入一个包装后的 gateway：

```ts
function createGuardedModelGateway(input: {
  externalProvider: ProviderSettings;
  localPolicy: LocalPolicyEngine;
  privacyMode: PrivacyPolicyMode;
}): ModelGateway {
  return {
    async chat(messages) {
      const decision = await localPolicy.beforeExternalModel({ messages });
      if (decision.type === "block") throw new PrivacyBlockedError(decision);
      if (decision.type === "local-answer") return decision.response;
      return callModel({
        settings: input.externalProvider,
        request: { messages: decision.messages, timeoutMs: 60_000 }
      });
    }
  };
}
```

这样 Agent runtime 仍保持纯净：

- `runAgentTask` 不依赖 WebLLM。
- `runPageChat` / `runMemoryChat` 也可以复用 guarded gateway。
- 所有隐私策略集中在 background / local-model 模块。

### 9.4 Agent prompt 变化

Agent prompt 可以增加本地策略 hint，但不包含敏感原文：

```text
Local policy:
- intent: run
- contextPolicy: redacted
- privacyRisk: medium
- redactedFields: email:2, token:1
- allowedActions: read, click, type, scroll
```

如果本地模型建议只使用摘要上下文，则 `buildMessages` 的 `Page text` 应替换为本地摘要或脱敏文本。

### 9.5 失败与降级

端侧模型不可用时：

- 意图识别降级到当前正则 `classifyTaskIntent`。
- 隐私扫描仍运行规则层。
- 简单回答 fast path 关闭。
- 外部模型调用是否继续取决于 privacy mode：
  - `off`：继续。
  - `redact`：规则脱敏后继续。
  - `block`：如果规则命中高风险，阻断。
  - `ask`：提示用户确认。

## 10. Model Gateway 扩展

现有外部 provider gateway 保持不变。新增本地模型不是 `Provider = "openai" | "anthropic"` 的第三种 provider，而是一个独立 local runtime。

原因：

- 外部 provider 有 API key、baseUrl、usage、HTTP 错误。
- 本地模型有下载、缓存、WebGPU、加载生命周期。
- 混在 provider profile 中会让 Options UI 和错误处理复杂化。

但内部可以共享 `ModelRequest` / `ModelResponse`：

```ts
type LocalModelResponse = ModelResponse & {
  provider: "local";
  runtime: "webllm";
  localProfileId: string;
};
```

如果 TypeScript 类型需要避免扩大现有 `Provider`，可单独定义 `LocalModelResponse`，由 `LocalModelService` 返回。

## 11. 安全与权限

1. Webpages 不直接访问 WebLLM engine。
2. Gateway 暴露的本地能力必须走 origin permission。
3. 本地模型配置和加载状态可见，模型权重 URL 和缓存细节不暴露给网页。
4. 隐私扫描结果默认不记录原文。
5. 高风险敏感信息命中时，外部模型调用必须被脱敏、确认或阻断。
6. 本地模型输出不能直接执行浏览器动作；它只能给 AgentPolicyEngine 提供建议。
7. 用户可关闭端侧模型，但关闭后 UI 要明确提示隐私保护降级。

## 12. 错误模型

新增错误码：

```ts
type LocalModelErrorCode =
  | "local_model_disabled"
  | "webgpu_unavailable"
  | "model_not_loaded"
  | "model_load_failed"
  | "model_inference_failed"
  | "local_model_timeout"
  | "privacy_blocked";
```

用户可见文案要区分：

- 浏览器不支持 WebGPU。
- 用户还没有下载/加载模型，或模型尚未 ready。
- 模型加载失败，可重试或切换模型。
- 因隐私策略阻断了外部模型调用。

## 13. 测试计划

单元测试：

- local model settings normalize。
- disabled local model fallback。
- WebGPU unavailable fallback。
- privacy rule scanner：email、phone、token、credential。
- privacy model result normalize。
- `redact` mode 替换敏感 span。
- `block` mode 阻止外部 `callModel`。
- GuardedModelGateway local-answer fast path。
- GuardedModelGateway external escalation path。
- Agent intent local classification fallback 到正则。

集成测试：

- `runPageChat` 使用 guarded gateway，不泄露原始敏感文本。
- `runAgentTask` 在页面文本包含 token 时被脱敏后再调用外部 provider。
- Gateway `local.status` 不泄露内部缓存路径。
- Gateway `local.classify` 需要授权。

手动验证：

- 用户手动下载/加载 WebLLM 模型，进度可见。
- 关闭网络后，已缓存模型仍可用于简单分类。
- WebGPU 不可用时 UI 有明确降级。
- 大页面文本不会导致本地模型长时间卡死；超时后按策略降级。

## 14. 实施阶段

### Phase 1: 类型和设置

- 增加 `LocalModelSettings`、`LocalModelProfile`、`PrivacyPolicy` 类型。
- storage normalize。
- 在现有 Models/Gateway 页面下增加 Local Models 独立 section。
- 明确说明端侧模型用途、用户手动下载/配置流程、未 ready 时的降级行为。
- 不接 WebLLM，只做配置、用途选择和状态。

### Phase 2: WebLLM Host

- 安装 `@mlc-ai/web-llm`。
- 增加 dedicated worker 和 engine wrapper。
- 支持 load/unload/status/progress。
- Options 只在用户点击下载/加载后启动模型下载和加载，并显示状态。

### Phase 3: PrivacyGuard

- 先实现规则扫描和脱敏。
- 再接本地模型 JSON mode 分类。
- 外部 `callModel` 前统一经过 privacy guard。

### Phase 4: Agent 对接

- background `runChat` / `runTask` 使用 `createGuardedModelGateway`。
- 本地 intent classifier 增强当前 `classifyTaskIntent`。
- simple-answer fast path。
- Agent prompt 增加 local policy hints。

### Phase 5: Gateway 透出

- 增加 `local.status`。
- 增加受控 `local.classify`。
- Options Gateway 示例补充端侧模型 API。

## 15. 开放问题

1. 第一版推荐展示哪些 WebLLM model id，需要根据包体、下载体积、中文能力和 WebGPU 性能实测决定；这些推荐项不应自动下载。
2. Offscreen document 是否作为唯一 LocalModelHost，需要用 Chrome MV3 生命周期实测确认。
3. 是否新增 `local.model` scope，还是第一版复用 `model.chat`。
4. `ask` 模式的用户确认 UI 放在 sidepanel、options 弹窗还是浏览器 notification。
5. 隐私扫描是否处理图片 OCR、截图和 accessibility tree，第一版建议只处理文本和表单值。

## 16. 结论

端侧模型应作为 Agenticify 的本地策略层，而不是外部 provider 的简单替代。第一版重点是快和安全：

- 快：用本地模型处理意图识别、简单回答、上下文裁剪。
- 安全：外部模型调用前做本地隐私扫描、脱敏、阻断或确认。
- 可控：用户自己执行本地模型下载和配置，并能看到加载、缓存和用途。
- 可扩展：WebLLM 作为第一种 runtime，后续可增加浏览器原生模型 API 或其他端侧推理 runtime。

Agent 对接方式应保持现有 runtime 简洁：不把 WebLLM 直接放进 Agent 循环，而是在 background 创建 `GuardedModelGateway` 和 `AgentPolicyEngine`，把本地模型能力作为外部模型调用前的策略门和快速路径。
