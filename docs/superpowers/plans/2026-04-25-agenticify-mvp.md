# Agenticify MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Chrome MV3 extension version of Agenticify with sidebar Agent UX, options console, OpenAI/Anthropic model settings, page gateway injection, site permissions, and call observability.

**Architecture:** The extension uses MV3 background as the policy and routing layer, content script as the DOM tool layer, injected script as the page-facing gateway, and two React apps for sidepanel/options. The first Agent runtime is a bounded observe-act loop that defaults to DOM tools and leaves Debugger mode as a gated advanced placeholder.

**Tech Stack:** React, TypeScript, Vite, Chrome Manifest V3, Tailwind CSS, shadcn-inspired local UI components, Vitest.

---

### Task 1: Project Scaffold And Core Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `sidepanel.html`
- Create: `options.html`
- Create: `manifest.json`
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write failing type-level tests for permission and logging helpers**

Create tests for behavior that production helpers must satisfy before implementing helpers.

- [ ] **Step 2: Add extension scaffold**

Create Vite/React/MV3 files with multiple build inputs for background, content, injected, sidepanel, and options.

- [ ] **Step 3: Add shared types**

Define provider settings, site permissions, gateway messages, call logs, debug logs, DOM observations, and Agent events.

- [ ] **Step 4: Verify**

Run `npm test` and `npm run build`.

### Task 2: Storage, Permissions, And Logs

**Files:**
- Create: `src/shared/storage.ts`
- Create: `src/shared/permissions.ts`
- Create: `src/shared/callLogs.ts`
- Create: `src/shared/debugLogs.ts`
- Test: `src/shared/permissions.test.ts`
- Test: `src/shared/callLogs.test.ts`

- [ ] **Step 1: Write failing tests for scope authorization**

Verify that auto-run requires origin match, no revocation, and all requested scopes.

- [ ] **Step 2: Implement permission helpers**

Add pure helper functions for scope checking and permission updates.

- [ ] **Step 3: Write failing tests for lightweight log creation**

Verify that lightweight logs exclude raw prompts by default.

- [ ] **Step 4: Implement call log helpers**

Add bounded log append and sanitization helpers.

- [ ] **Step 5: Verify**

Run focused tests and full tests.

### Task 3: Model Gateway

**Files:**
- Create: `src/model-gateway/index.ts`
- Create: `src/model-gateway/openai.ts`
- Create: `src/model-gateway/anthropic.ts`
- Test: `src/model-gateway/index.test.ts`

- [ ] **Step 1: Write failing tests for provider routing**

Verify OpenAI and Anthropic settings route to the correct HTTP request shape.

- [ ] **Step 2: Implement provider adapters**

Use fetch-based adapters so the first version does not depend on provider SDKs.

- [ ] **Step 3: Normalize responses**

Return provider, model, text, usage, and raw metadata.

- [ ] **Step 4: Verify**

Run model gateway tests.

### Task 4: Content And Injected Gateway

**Files:**
- Create: `src/content/index.ts`
- Create: `src/injected/browserAgent.ts`
- Test: `src/content/domTools.test.ts`
- Create: `src/content/domTools.ts`

- [ ] **Step 1: Write failing DOM observation tests**

Verify title, URL, headings, links, buttons, inputs, and selected text are collected.

- [ ] **Step 2: Implement DOM tools**

Add observe, click, type, scroll, and extract helpers.

- [ ] **Step 3: Implement injected gateway**

Expose `window.browserAgent.chat`, `window.browserAgent.run`, and `window.browserAgent.requestAccess`.

- [ ] **Step 4: Implement bridge**

Use `window.postMessage` between injected and content, then `chrome.runtime.sendMessage` to background.

- [ ] **Step 5: Verify**

Run content tests and build.

### Task 5: Agent Runtime And Background Router

**Files:**
- Create: `src/agent/runtime.ts`
- Create: `src/background/index.ts`
- Test: `src/agent/runtime.test.ts`

- [ ] **Step 1: Write failing Agent tests**

Verify direct page Q&A returns model output and bounded run emits observe/model/final events.

- [ ] **Step 2: Implement Agent runtime**

Implement limited observe-act orchestration with DOM mode by default and Debugger escalation events when requested.

- [ ] **Step 3: Implement background router**

Handle sidebar chat/run, gateway chat/run, access requests, provider settings, permissions, and logs.

- [ ] **Step 4: Verify**

Run Agent tests and build.

### Task 6: Sidebar UI

**Files:**
- Create: `src/sidepanel/main.tsx`
- Create: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/styles.css`
- Create: `src/ui/*`

- [ ] **Step 1: Build layout**

Create page context header, quick actions, timeline, composer, and permission/debugger prompts.

- [ ] **Step 2: Wire background messages**

Connect summarize, ask, extract, fill/rewrite, and custom run actions.

- [ ] **Step 3: Verify**

Run build and inspect generated sidepanel assets.

### Task 7: Options UI

**Files:**
- Create: `src/options/main.tsx`
- Create: `src/options/App.tsx`
- Create: `src/options/styles.css`

- [ ] **Step 1: Build model settings**

Support OpenAI and Anthropic API key, Base URL, default model, enabled state.

- [ ] **Step 2: Build gateway and site access settings**

Support gateway enablement, authorized site list, auto-run toggles, and revoke.

- [ ] **Step 3: Build observability**

Show lightweight call history by default and debug logs in Advanced.

- [ ] **Step 4: Verify**

Run build.

### Task 8: Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add usage instructions**

Document install, build, load unpacked extension, configure model, use sidebar, and test gateway.

- [ ] **Step 2: Run verification**

Run `npm test` and `npm run build`.

- [ ] **Step 3: Sync to target project directory**

Copy the completed project into `/Users/yofineliu/Workspace/Agenticify`.

