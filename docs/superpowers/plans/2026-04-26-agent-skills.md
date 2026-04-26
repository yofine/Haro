# Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe installation and use of standard `SKILL.md` skills, including installation from `skills.sh`, and expose benchmark tools as built-in skills.

**Architecture:** Add an `agent/skills.ts` module for parsing, installation, matching, prompt building, and built-in skill mapping. Store installed skills in extension settings as original `SKILL.md` markdown plus metadata. Runtime injects matched skills into prompts and background routes executable built-in skill actions to benchmark tools.

**Tech Stack:** TypeScript, Chrome MV3 storage/background messaging, Vitest.

---

### Task 1: Skill Types And Storage

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Test: `src/shared/storage.test.ts`

- [x] Add `InstalledSkill` and `AgentSkillAction`.
- [x] Add `ExtensionSettings.skills`.
- [x] Preserve `skillMarkdown` in normalized settings.
- [x] Run storage tests.

### Task 2: Skill Parser And Installer

**Files:**
- Create: `src/agent/skills.ts`
- Create: `src/agent/skills.test.ts`

- [x] Parse standard `SKILL.md` frontmatter.
- [x] Install from `https://skills.sh/<owner>/<repo>/<skill>` through GitHub contents API.
- [x] Match skills by task text.
- [x] Build runtime skill prompt.
- [x] Run skill tests.

### Task 3: Built-In Benchmark Skills

**Files:**
- Modify: `src/agent/skills.ts`
- Modify: `src/background/index.ts`
- Test: `src/agent/skills.test.ts`

- [x] Register benchmark tools as built-in skills.
- [x] Map `AgentSkillAction` to `BenchmarkToolRequest`.
- [x] Route built-in skill actions through benchmark tools.

### Task 4: Runtime And Sidepanel Integration

**Files:**
- Modify: `src/agent/runtime.ts`
- Modify: `src/agent/runtime.test.ts`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.ts`

- [x] Inject matched skills into model prompt.
- [x] Accept and execute `skill` actions.
- [x] Add explicit sidepanel install command detection for `skills.sh`.
- [x] Run runtime and sidepanel tests.

### Task 5: Verification

- [x] Run `pnpm test`.
- [x] Run `pnpm run build`.
