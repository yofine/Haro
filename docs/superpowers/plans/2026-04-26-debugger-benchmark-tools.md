# Debugger Benchmark Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable Debugger-powered benchmark tools for screenshots, HTML reports, page rewrites, and form filling.

**Architecture:** Extend `DebuggerTools` with low-level screenshot/evaluate helpers, add a focused `browserTools` module for high-level workflows, expose background routes, then render returned artifacts in sidepanel timeline. Existing permission gates remain in background.

**Tech Stack:** TypeScript, Chrome Debugger Protocol, Vitest, React sidepanel.

---

### Task 1: Debugger Tool Primitives

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/background/debuggerTools.ts`
- Test: `src/background/debuggerTools.test.ts`

- [x] Add screenshot, evaluate, rewrite, restore, and form-fill result types.
- [x] Write failing tests for screenshot command shape and safe page-script helpers.
- [x] Implement `captureFullPageScreenshot`, `rewriteTextNodes`, `restoreRewriteSession`, and `fillFormFields`.
- [x] Run `pnpm test -- src/background/debuggerTools.test.ts`.

### Task 2: Browser Benchmark Tools

**Files:**
- Create: `src/background/browserTools.ts`
- Create: `src/background/browserTools.test.ts`
- Modify: `src/shared/types.ts`

- [x] Add request/result types for screenshot, report, rewrite, restore, and form fill.
- [x] Write failing tests for report sanitization and model-plan parsing.
- [x] Implement high-level tool orchestration with explicit safe defaults.
- [x] Run `pnpm test -- src/background/browserTools.test.ts`.

### Task 3: Background Routes

**Files:**
- Modify: `src/background/index.ts`
- Test: existing background/browser tests where available

- [x] Add `agenticify:benchmark-tool` route.
- [x] Require `debugger.control` for screenshot, rewrite, restore, and form fill.
- [x] Require model provider only for report, rewrite planning, and form fill planning.
- [x] Persist debug logs for every benchmark tool execution.

### Task 4: Sidepanel Artifacts

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/styles.css`
- Test: `src/sidepanel/App.test.ts`

- [x] Add benchmark quick actions without changing options UI.
- [x] Render HTML report and screenshot artifacts in timeline.
- [x] Add export image helpers for screenshot and report artifacts.
- [x] Keep existing timeline event formatting tests passing.

### Task 5: Verification

- [x] Run `pnpm test`.
- [x] Run `pnpm run build`.
