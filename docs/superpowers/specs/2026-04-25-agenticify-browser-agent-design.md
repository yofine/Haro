# Agenticify Browser Agent Design

Date: 2026-04-25

## 1. Product Positioning

Agenticify is a Chrome-first browser extension that turns an ordinary Chrome browser into an Agentic Browser.

The first release should be perceived as a useful browser productivity tool, not as an AI wallet or protocol project. The strategic AI wallet layer is intentionally kept implicit through local model key ownership, site permissions, gateway access, and call observability.

Primary message:

> Turn Chrome into an Agentic Browser.

Supporting message:

> Ask, understand, extract, and act on any webpage using your own AI models.

First-release product promise:

- The AI understands the current webpage without copy and paste.
- The AI can help users act on webpages, not only answer questions.
- Users configure and control their own model keys.
- Trusted websites can use user-authorized BrowserAgent capabilities through a low-profile gateway.

First-release non-message:

- Do not market this as an AI Wallet.
- Do not lead with Web3, wallet, decentralization, or protocol language.
- Do not present `window.browserAgent` as a public standard yet.

## 2. Target Users And First-Release Goal

The first release is optimized for ordinary users who want a better browser experience. Developer-facing gateway capabilities exist, but they are secondary and experimental.

Primary user:

- Uses Chrome as the main browser.
- Wants AI help while reading, researching, extracting, filling, or operating websites.
- Is comfortable adding an API key for OpenAI or Anthropic.

Secondary user:

- Developer or AI Web app builder who wants to test calling local browser AI capabilities through `window.browserAgent`.

First-release goal:

- Ship a useful sidebar-first AI browser tool.
- Build the hidden foundation for site authorization, gateway calls, call logs, and future AI wallet semantics.
- Avoid exposing the broader AI wallet strategy before there is user distribution and at least one strong AI Web app demonstration.

## 3. Product Surfaces

### 3.1 Sidebar

The sidebar is the primary user experience. It should feel like the control panel of an AI browser, not a generic chatbot.

Core sections:

- Current page context: title, URL, origin, read status, and control mode.
- Quick actions: summarize, ask page, extract data, fill or rewrite, run a task.
- Conversation timeline: user messages, model responses, and Agent progress.
- Agent run timeline: observe, decide, act, result, and error states.
- Composer: natural language task input.
- Permission prompts: site access, auto-run access, and Debugger mode access.

Required first-release workflows:

- Open an article page and summarize it.
- Ask follow-up questions about the current page.
- Extract structured data from a list, table, search result page, or product page.
- Fill or rewrite content in forms and text inputs.
- Run a short browser task with visible progress.

Design constraints:

- Sidebar-first. Do not build a complex in-page floating UI in the first release.
- Page context should always be visible enough that users understand the AI is operating on the current page.
- Agent progress should be explicit and calm. Users should know when the extension is reading, clicking, typing, waiting, blocked, or finished.

### 3.2 Options / Background Console

The options page is the control and observability surface. It should feel trustworthy and precise.

Core sections:

- Model settings
- Gateway settings
- Site access
- Call history
- Advanced debug logs
- Advanced control settings

Default view:

- Simple model configuration.
- Gateway enablement status.
- Site authorization list.
- Lightweight call history.

Advanced view:

- Debug logs.
- Agent steps.
- Tool calls.
- Request and response summaries.
- Error details.
- Debugger mode controls.

The options UI should not expose AI wallet terminology in the first release. Use terms such as Site Access, Gateway Access, Call History, Debug Logs, and Advanced Control.

## 4. Brand Design

Product brand:

- Agenticify

Category / mental model:

- Agentic Browser

Core tagline:

- Turn Chrome into an Agentic Browser.

Logo direction:

- Minimal browser frame plus intelligence mark.
- The browser frame signals that this product upgrades the existing browser.
- The intelligence mark can be a small star, cursor, node, or precise spark.
- Avoid robot faces, wallet symbols, chains, coins, or strong Web3 references.

Visual style:

- Professional, calm, accurate, and trustworthy.
- Neutral palette with restrained blue accents.
- Avoid heavy gradients, cyberpunk styling, oversized marketing cards, and playful mascot branding.
- The extension UI should feel closer to browser settings, developer tools, and productivity software than to an AI novelty app.

Landing page first viewport:

```text
Agenticify

Turn Chrome into an Agentic Browser.

Ask, understand, extract, and act on any webpage using your own AI models.
```

Landing page content priorities:

- Show the sidebar operating on a real webpage.
- Show model ownership and local API key configuration.
- Show webpage understanding and actions.
- Keep gateway/developer capability secondary.
- Do not mention AI Wallet in the first public launch.

## 5. Technical Stack

Use:

- Chrome Manifest V3
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui

Browser strategy:

- Chrome-first for product copy, testing, and release.
- Keep Chromium compatibility in mind where inexpensive.
- Do not commit first-release QA scope to Edge, Brave, Arc, or other Chromium browsers.

## 6. High-Level Architecture

Modules:

- `background`: model gateway, permission decisions, call logs, Debugger API access, message routing.
- `content`: DOM observation, DOM tools, and bridge communication with the page.
- `injected`: page-context script that exposes `window.browserAgent`.
- `sidepanel`: React sidebar app for ordinary users.
- `options`: React options app for configuration and observability.
- `agent-runtime`: pi-mono based short-task Agent orchestration.
- `storage`: typed persistence layer over extension storage.

Data boundaries:

- API keys stay in extension storage and are never exposed to webpages.
- Webpages communicate through the injected gateway and message bridge.
- Background is the policy enforcement point for model calls, Agent runs, scopes, logs, and Debugger permissions.
- Content scripts provide page tools but should not make authorization decisions by themselves.

## 7. Model Gateway

First-release providers:

- OpenAI
- Anthropic

Do not add third-party provider presets in the first release.

Provider settings:

- Provider type: OpenAI or Anthropic.
- API key.
- Optional Base URL, defaulting to the official provider URL.
- Default model.
- Enabled / disabled.

Gateway behavior:

- Normalize model requests behind one internal interface.
- Support chat-style messages.
- Return normalized text output, raw provider metadata, and usage data when available.
- If usage data is unavailable, store usage as unknown rather than guessing.

Provider-specific SDK usage can be decided during implementation. The architectural requirement is that UI, Agent runtime, and gateway API do not depend directly on provider-specific shapes.

## 8. Agent Runtime

Use pi-mono as the basis for a simple Agent runtime.

Execution style:

- Default to short command-style tasks.
- Allow a limited observe-act loop for `run`.
- First release maximum: 3 to 5 observe-act iterations per run.
- Every step should be visible in the sidebar timeline and available in debug logs.

Default tools:

- Observe page summary.
- Read selected text.
- Read main page content.
- Read interactive elements.
- Click element.
- Type into element.
- Scroll page.
- Extract structured data.

High-risk actions requiring confirmation:

- Submit form.
- Send message or email.
- Delete data.
- Make purchases or payments.
- Accept legal terms.
- Perform account or security-sensitive actions.

Agent modes:

- DOM mode: default.
- Debugger mode: advanced, site-authorized, and only enabled when needed.
- Auto mode: start with DOM mode, request Debugger mode only when DOM tools are insufficient.

## 9. DOM Agent And Debugger Agent

### 9.1 DOM Agent

DOM Agent is the default control layer.

Capabilities:

- Read title, URL, origin, selected text, body text, headings, links, buttons, inputs, and forms.
- Build simplified page context for the model.
- Execute basic page actions through DOM events.
- Prefer deterministic selectors and stable element references when possible.

Limitations:

- May fail on complex shadow DOM, canvas-heavy apps, cross-origin iframes, and advanced SPA interaction patterns.
- Should return clear failure reasons and suggest Debugger mode when appropriate.

### 9.2 Debugger Agent

Debugger Agent uses Chrome Debugger API / CDP for advanced control.

Capabilities:

- Stronger page observation and interaction.
- Better support for complex browser states.
- Potential network and console diagnostic support in later releases.

Permission model:

- Not globally enabled by default.
- Requires explicit user approval.
- Should be authorized per site where possible.
- Should be presented as Advanced Control, not as a default requirement.

First-release use:

- Keep minimal.
- Use only when DOM mode is insufficient or when the user manually enables advanced control.

## 10. Browser Gateway API

Expose a low-profile page API:

```ts
window.browserAgent.chat(options)
window.browserAgent.run(options)
```

Optional access request API:

```ts
window.browserAgent.requestAccess(options)
```

Example:

```ts
await window.browserAgent.requestAccess({
  appName: "Research Copilot",
  scopes: ["model.chat", "page.read", "page.act"],
  reason: "Use your BrowserAgent to understand and act on this page."
})

await window.browserAgent.chat({
  messages: [{ role: "user", content: "Summarize this page." }]
})

await window.browserAgent.run({
  task: "Extract product names and prices from this page.",
  mode: "auto"
})
```

Gateway principles:

- The page can discover the API.
- The page cannot access API keys.
- The page cannot call privileged capabilities without authorization.
- Trusted sites can be granted auto-run access.
- Debugger control remains a separate advanced scope.

Initial scopes:

- `model.chat`: call the configured model.
- `page.read`: read current page context.
- `page.act`: perform DOM-level page actions.
- `debugger.control`: use advanced browser control.

First-release default:

- Auto-run can be granted to trusted sites for `model.chat`, `page.read`, and `page.act`.
- `debugger.control` requires separate approval.

## 11. Message Flow

### 11.1 Sidebar-Initiated Run

1. User enters a task in the sidebar.
2. Sidepanel sends a run request to background.
3. Background checks model configuration and active tab.
4. Background asks content script to observe the page.
5. Agent runtime plans the next action.
6. Background routes DOM actions to content script.
7. If Debugger mode is required, background prompts for advanced control.
8. Each step is logged and streamed to the sidepanel.
9. Final result is shown in the conversation timeline.

### 11.2 Website-Initiated Run

1. Website calls `window.browserAgent.run`.
2. Injected script posts a message to content script.
3. Content script forwards the request to background with origin and tab context.
4. Background checks site authorization and scopes.
5. If not authorized, the extension prompts the user.
6. If authorized and auto-run is enabled, background starts the Agent run.
7. Results are returned through the bridge.
8. Lightweight call log and debug log entries are stored.

## 12. Permissions And Trust

Permission objects should be origin-scoped.

Suggested internal structure:

```ts
type SitePermission = {
  origin: string
  appName?: string
  scopes: Array<"model.chat" | "page.read" | "page.act" | "debugger.control">
  autoRun: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  revokedAt?: string
}
```

User-facing controls:

- View authorized sites.
- See granted scopes.
- Toggle auto-run.
- Revoke access.
- See last used time.

Hidden future wallet fields can exist in storage, but should not be exposed in first-release UI:

- usage counters.
- budget fields.
- per-origin model limits.
- spending limits.
- signing or proof fields.

## 13. Observability

### 13.1 Lightweight Call History

Shown by default.

Fields:

- Source: Sidebar or Website Gateway.
- Origin.
- Type: chat or run.
- Model.
- Time.
- Status: success, failed, denied, canceled.

### 13.2 Advanced Debug Logs

Shown only in advanced configuration.

Fields:

- Request summary.
- Response summary.
- Agent observe-act steps.
- Tool calls.
- Error details.
- Provider metadata.
- Usage metadata when available.

Debug logs are for development and trust verification. They should be easy to inspect, but not visually dominate the product.

## 14. Storage

Required storage groups:

- Provider settings.
- Gateway settings.
- Site permissions.
- Lightweight call history.
- Debug logs.
- UI preferences.

API key handling:

- Store keys only in extension storage.
- Never expose keys to the page, injected script, or content script.
- Avoid logging raw prompts if doing so would expose user-sensitive page content by default. Store summaries in lightweight logs and reserve detailed data for advanced debug mode.

Retention:

- Lightweight call history can have a bounded retention window or maximum count.
- Debug logs should have a smaller bounded retention window by default.
- Add clear controls to clear logs.

## 15. UI Requirements

Use shadcn/ui and Tailwind to build restrained, reliable interfaces.

Sidebar:

- Compact header with current page state.
- Quick action buttons with clear labels.
- Timeline-based Agent progress.
- Composer fixed at the bottom.
- Clear blocked and permission states.

Options:

- Use tabs or a sidebar navigation for Models, Gateway, Sites, History, and Advanced.
- Use tables for site access and call history.
- Use forms for provider settings.
- Keep advanced debug logs visually separate from default settings.

Copy style:

- Short, concrete, and precise.
- Avoid hype-heavy AI phrasing.
- Avoid wallet or protocol language in first-release UI.

## 16. MVP Scope

Included:

- Chrome MV3 extension scaffold.
- Sidebar UI.
- Options UI.
- OpenAI and Anthropic provider configuration.
- Model gateway abstraction.
- DOM page observation.
- Basic DOM actions.
- pi-mono based short-task Agent loop.
- `window.browserAgent.chat`.
- `window.browserAgent.run`.
- Origin-scoped site permission records.
- Trusted-site auto-run.
- Lightweight call history.
- Advanced debug logs.
- Minimal brand assets and landing page direction.

Excluded from first release:

- Public AI Wallet branding.
- Full AI wallet protocol.
- Provider marketplace.
- Payment or token purchasing.
- Multi-browser QA.
- Heavy page-injected UI.
- Multi-agent workflow builder.
- Cloud sync.
- Team management.
- Public developer documentation positioned as a standard.

## 17. Main Risks

Security risk:

- Websites could abuse auto-run if authorization is too broad.
- Mitigation: origin-scoped permissions, explicit scopes, revocation, call history, and high-risk action confirmation.

Trust risk:

- Debugger API permissions may scare users.
- Mitigation: keep Debugger mode optional and present it as Advanced Control.

Reliability risk:

- DOM actions may fail on complex websites.
- Mitigation: visible step timeline, clear failure states, and optional Debugger escalation.

Strategic leakage risk:

- Too much early gateway/protocol messaging could expose the AI wallet thesis before distribution exists.
- Mitigation: market as Agentic Browser; keep gateway experimental and low-profile.

Product risk:

- If the sidebar feels like a generic chatbot, the product will not establish the AI browser mental model.
- Mitigation: make page context, quick actions, and visible browser actions central to the experience.

## 18. Open Implementation Questions

These should be resolved during implementation planning:

- Whether to use provider SDKs or direct HTTP calls for OpenAI and Anthropic.
- Exact pi-mono integration boundary and whether it lives as a separate package.
- Exact extension storage strategy and retention limits.
- Debugger permission UX details.
- Whether detailed debug logs include full prompts by default or require an extra local developer toggle.
- First landing page implementation scope: static page, extension store assets, or both.

