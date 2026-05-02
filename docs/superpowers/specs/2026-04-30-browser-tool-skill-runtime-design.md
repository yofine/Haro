# Browser Tool and Skill Runtime Design

## Context

The current BrowserAgent skill implementation is too tightly coupled to a small set of hardcoded built-in actions. Built-in skills such as screenshot, page report, rewrite page, and fill form are currently routed through `skillActionToBenchmarkRequest` and `runBenchmarkTool`. This works for an MVP, but it makes skills thin prompt wrappers around fixed benchmark tools.

BrowserAgent should become a browser-native agent platform. Its core value should come from a stable set of browser tools that understand page reading, page mutation, screenshots, artifacts, and safe script execution. Skills should be built on top of those tools, not wired directly to Chrome Debugger or ad hoc DOM functions.

## Goals

1. Define a browser-native core tool layer that can support current and future skills.
2. Separate skill intent, tool planning, and tool execution.
3. Make browser tools safe by default with capability declarations and risk gates.
4. Support browser-specific scripted skills using JavaScript and CSS under a constrained API.
5. Preserve compatibility with the existing sidebar and gateway routes while migrating.
6. Make future built-in and installed skills composable rather than hardcoded.

## Non-Goals

1. Do not expose raw `chrome.debugger`, `chrome.scripting`, `window`, or unrestricted page APIs to skills.
2. Do not add arbitrary remote code execution.
3. Do not require a vector database or long-term autonomous planning for the first version.
4. Do not replace the current model provider system.
5. Do not remove current built-in skills until compatibility shims exist.

## Architecture

The new architecture has four layers:

```text
Agent Runtime
  -> Skill Runtime
    -> Browser Tool Registry
      -> DOM Executor / Debugger Executor
```

The Agent Runtime decides whether a user task is simple chat, memory chat, or a browser task. For browser tasks, it can select skills and tools.

The Skill Runtime loads a skill package, validates its declared capabilities, prepares prompt/tool context for the model, and executes approved skill scripts or tool plans.

The Browser Tool Registry owns stable browser tool definitions, schemas, risk metadata, and execution routing.

The executors perform actual browser work through content scripts, Chrome Debugger API, or a hybrid path.

## Browser Core Tools

Browser tools should be first-class primitives. They are not skills themselves. Skills compose them.

### `page.read`

Reads page content through several modes:

- `visibleText`: readable body text, trimmed and normalized.
- `semanticOutline`: title, URL, headings, landmarks, and major sections.
- `interactiveElements`: clickable controls, inputs, labels, roles, and selectors.
- `selectedText`: current page selection.
- `htmlSnapshot`: sanitized structural HTML for analysis.
- `accessibilityTree`: debugger-backed accessibility tree when authorized.
- `textNodes`: indexed visible text nodes for rewrite workflows.
- `forms`: form fields, labels, types, constraints, and safe selectors.

Default executor: DOM.

Debugger executor is used only for accessibility tree, complete snapshots, or pages where DOM observation is insufficient.

### `page.write`

Mutates the page in controlled, reversible ways:

- `setInputValue(selector, value)`: fill one form field.
- `setFormValues(fields)`: fill multiple fields without submit.
- `rewriteTextNodes(sessionId, replacements)`: rewrite indexed text nodes.
- `injectCss(css, scope)`: inject scoped CSS with a reversible session.
- `injectOverlay(html, css)`: display an extension-owned overlay.
- `restoreMutation(sessionId)`: undo rewrite/CSS/overlay sessions.

Default executor: DOM.

All page writes produce a mutation record with a session id, changed count, and rollback support when possible.

### `page.capture`

Captures visual output and artifacts:

- `viewportScreenshot()`
- `fullPageScreenshot()`
- `elementScreenshot(selector)`
- `htmlToImage(html)`
- `saveArtifact(artifact)`

Default executor: Debugger for screenshots, local rendering for `htmlToImage`.

Full-page screenshot requires debugger permission.

### `page.act`

Performs user-like actions:

- `click(selector)`
- `type(selector, text)`
- `scroll(direction, amount)`
- `select(selector, value)`
- `focus(selector)`

Default executor: DOM.

High-risk actions return `needs_confirmation` with a preview rather than executing.

### `page.script`

Runs constrained browser scripts for advanced skills:

- `runJs(scriptId, args)`
- `injectCss(scriptId, args)`
- `validate(scriptId, args)`

Scripts run with a sandboxed skill API. They do not receive raw page globals or extension APIs. Scripts can only call exposed browser tool methods.

## Tool Definition

Each browser tool is registered with a definition:

```ts
type BrowserToolDefinition = {
  id: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  executor: "dom" | "debugger" | "hybrid";
  risk: "low" | "medium" | "high";
  requiresDebugger?: boolean;
  requiresConfirmation?: boolean;
  reversible?: boolean;
};
```

Example:

```ts
{
  id: "page.capture.fullPageScreenshot",
  description: "Capture a PNG screenshot of the full page.",
  executor: "debugger",
  risk: "low",
  requiresDebugger: true,
  requiresConfirmation: false,
  reversible: false,
  inputSchema: {
    type: "object",
    properties: {
      filenameHint: { type: "string" }
    }
  },
  outputSchema: {
    type: "object",
    required: ["screenshot"],
    properties: {
      screenshot: { type: "object" }
    }
  }
}
```

## Tool Result

All tools return a common result envelope:

```ts
type BrowserToolResult<T = unknown> = {
  ok: boolean;
  status: "success" | "failed" | "needs_confirmation" | "blocked";
  message: string;
  data?: T;
  preview?: BrowserToolPreview;
  artifacts?: BrowserArtifact[];
  mutations?: BrowserMutation[];
  memoryCandidates?: AgentMemory[];
};
```

This keeps timeline rendering, audit logging, confirmation cards, and skill composition consistent.

## Risk Model

Tool risk is determined before execution.

### Low Risk

Allowed without extra confirmation after normal page access:

- Read visible page text.
- Read headings and controls.
- Generate report artifacts.
- Capture screenshots after debugger permission is already granted.
- Inject temporary visual-only CSS that can be reverted.

### Medium Risk

Requires preview or user confirmation depending on context:

- Rewrite visible text nodes.
- Fill form fields.
- Inject overlays.
- Run installed skill scripts.

### High Risk

Always blocked or requires explicit confirmation:

- Submit forms.
- Click purchase, payment, delete, or send controls.
- Read password values, file input contents, tokens, cookies, local storage, or session storage.
- Run untrusted arbitrary JS.
- Navigate away or download files.

## Browser Skill Package

Browser skills extend standard `SKILL.md` with browser-specific frontmatter. The markdown remains human-readable and installable, while the runtime can parse capabilities.

```yaml
---
name: page-translator
description: Translate visible page copy in place.
runtime: browser
version: 1
capabilities:
  - page.read.textNodes
  - page.write.rewriteTextNodes
risk: medium
tools:
  - page.read
  - page.write
scripts:
  - scripts/plan.js
  - styles/preview.css
---
```

Skill body describes when to use the skill and how to compose tools. The package may include optional scripts and CSS.

## Skill Runtime API

Scripts receive a constrained API:

```ts
type BrowserSkillApi = {
  read: {
    visibleText(): Promise<string>;
    outline(): Promise<PageOutline>;
    textNodes(limit?: number): Promise<TextNodeRef[]>;
    forms(): Promise<FormDescriptor[]>;
    selection(): Promise<string | undefined>;
  };
  write: {
    setInputValue(selector: string, value: string): Promise<BrowserToolResult>;
    rewriteTextNodes(replacements: TextReplacement[]): Promise<BrowserToolResult>;
    injectCss(css: string): Promise<BrowserToolResult>;
    restore(sessionId: string): Promise<BrowserToolResult>;
  };
  capture: {
    fullPageScreenshot(): Promise<BrowserToolResult>;
    elementScreenshot(selector: string): Promise<BrowserToolResult>;
  };
  artifacts: {
    createHtmlReport(html: string): Promise<BrowserArtifact>;
    htmlToImage(html: string): Promise<BrowserArtifact>;
  };
};
```

Scripts cannot access:

- Raw `window`.
- Raw `document`.
- `chrome.*`.
- Network APIs.
- Browser storage.
- Cookies, local storage, session storage, or credentials.

## Built-In Browser Skills

The current built-ins should be rewritten on top of Browser Core Tools.

### `builtin/page-reader`

Uses:

- `page.read.visibleText`
- `page.read.semanticOutline`
- `page.read.interactiveElements`

Purpose:

- Summarize page structure.
- Answer page questions.
- Prepare context for other skills.

### `builtin/page-report`

Uses:

- `page.read.semanticOutline`
- `page.read.visibleText`
- model call
- `artifacts.createHtmlReport`
- optional `artifacts.htmlToImage`

Purpose:

- Produce an HTML analysis report shown in chat.
- Export report as image.

### `builtin/page-rewriter`

Uses:

- `page.read.textNodes`
- model call
- `page.write.rewriteTextNodes`
- `page.write.restoreMutation`

Purpose:

- Translate or rewrite visible copy.
- Preserve rollback support.

### `builtin/form-filler`

Uses:

- `page.read.forms`
- model call
- `page.write.setFormValues`

Purpose:

- Fill forms based on user description.
- Never submit.
- Skip password, file, payment, or unsafe controls.

### `builtin/screenshot`

Uses:

- `page.capture.viewportScreenshot`
- `page.capture.fullPageScreenshot`
- `page.capture.elementScreenshot`

Purpose:

- Capture visual state.
- Full-page capture requires debugger permission.

### `builtin/page-styler`

Uses:

- `page.write.injectCss`
- `page.write.restoreMutation`

Purpose:

- Temporary reading mode.
- Highlight page regions.
- Improve inspection workflows.

## Skill Execution Flow

1. User asks for a browser task.
2. Agent Runtime classifies task as `run`.
3. Skill Runtime selects:
   - explicitly selected skill, or
   - matched installed/browser skill, or
   - direct core tool path.
4. Skill Runtime validates capability declarations against available tools and permissions.
5. Model receives:
   - task,
   - relevant memories,
   - page observation,
   - selected skill instructions,
   - tool definitions.
6. Model returns a tool plan.
7. Tool Registry validates the requested tool call.
8. Executor runs the tool or returns confirmation/blocked.
9. Timeline receives structured events:
   - `tool-plan`
   - `tool-call`
   - `tool-result`
   - `artifact`
   - `mutation`
   - `blocked`
10. Agent returns final response.

## Compatibility

Existing APIs should keep working during migration.

Current:

```ts
skillActionToBenchmarkRequest(action)
runBenchmarkTool(request)
agenticify:benchmark-tool
```

Migration:

```text
Legacy Benchmark Request
  -> Browser Tool Plan
  -> Browser Tool Registry
  -> DOM/Debugger Executor
```

The old `BenchmarkToolRequest` route becomes a compatibility adapter. New built-in skills should use browser tools directly.

## Storage and Installation

Installed browser skills should still store the standard `SKILL.md` content locally. Additional files are stored as package assets:

```ts
type BrowserSkillAsset = {
  path: string;
  kind: "js" | "css" | "json" | "markdown";
  content: string;
  hash: string;
};
```

The `InstalledSkill` model should eventually gain:

```ts
runtime?: "prompt" | "browser";
capabilities?: string[];
risk?: "low" | "medium" | "high";
assets?: BrowserSkillAsset[];
```

Prompt-only skills remain supported.

## Security Rules

1. Browser skills must declare capabilities before use.
2. Installed scripts are inert until invoked by a user task.
3. Script execution uses a constrained API, not raw browser globals.
4. High-risk tool calls always require explicit confirmation.
5. Debugger-backed tools require debugger permission.
6. Reversible mutations must create a session id.
7. Sensitive data is never exposed to skill scripts:
   - password values,
   - cookies,
   - local/session storage,
   - auth tokens,
   - file input contents,
   - payment fields.
8. CSS injection must be scoped and reversible.
9. Tool calls and script invocations are logged as structured timeline events.

## Proposed File Structure

```text
src/browser-tools/
  registry.ts
  types.ts
  risk.ts
  executors/
    domExecutor.ts
    debuggerExecutor.ts
  tools/
    pageRead.ts
    pageWrite.ts
    pageCapture.ts
    pageAct.ts
    pageScript.ts

src/agent/
  browserSkillRuntime.ts
  browserSkillManifest.ts
  skills.ts

src/background/
  browserTools.ts        # compatibility adapter during migration
  debuggerTools.ts       # lower-level debugger executor support

src/shared/
  types.ts
```

## Migration Plan

### Phase 1: Tool Registry

Create browser tool types, registry, risk gate, and executor abstraction. Migrate existing screenshot, report, rewrite, and fill-form behavior behind tool definitions. Keep current external routes working.

### Phase 2: Browser Skill Runtime

Extend skill parsing to understand browser frontmatter. Add selected skill execution through the tool registry. Rebuild current built-in skills as browser skill packages.

### Phase 3: Scripted Browser Skills

Support installed JS/CSS assets with the constrained skill API. Add package validation, capability checks, and script result envelopes.

### Phase 4: Options and Debug UX

Show browser skill capabilities, risk, assets, and tool usage in Options. Improve timeline rendering for tool plan, tool call, artifact, mutation, and confirmation events.

## Open Decisions

1. Whether scripted skills can be installed from `skills.sh` in the first browser-skill version, or only local/built-in packages initially.
2. Whether medium-risk mutations should always require confirmation or only when they affect many nodes/fields.
3. Whether `page.script` should initially allow JavaScript scripts, or launch with CSS-only scripted skills first.
4. Whether browser skill assets should be stored inside `ExtensionSettings.skills` or a separate storage namespace.

## Recommendation

Build Phase 1 first and stop treating built-in skills as direct benchmark tool aliases. The key foundation is the Browser Tool Registry with safe DOM and Debugger executors. Once that is stable, browser skills become thin, declarative compositions of real browser-native tools, and the system can grow without hardcoding every new capability into `skillActionToBenchmarkRequest`.
