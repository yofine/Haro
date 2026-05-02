import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSidebarRunMessage, detectDirectBenchmarkRequest, detectSkillInstallUrl, filterComposerSkills, filterStoredConversationPages, formatAgentEventsForTimeline, formatAgentRunResultForTimeline, formatBenchmarkToolResultForTimeline, getSiteConversationStorageKey, isConnectedToActivePage, isScrolledNearBottom, MarkdownText, moveSkillPickerIndex, normalizeRuntimeMessageError, parseMessageBlocks, sanitizeTimelineItemsForStorage, storedConversationPageToObservation, timelineItemsToConversationMemory, upsertStoredConversationPage, userMessageMeta } from "./App";
import type { AgentEvent } from "../shared/types";

describe("formatAgentEventsForTimeline", () => {
  it("maps agent events into safe console timeline entries", () => {
    const events: AgentEvent[] = [
      {
        type: "observe",
        observation: {
          title: "Example Product",
          url: "https://example.com/product",
          origin: "https://example.com",
          text: "private page text should not be mirrored into the step label",
          headings: ["Pricing", "FAQ"],
          links: [],
          interactiveElements: [{ selector: "#email", tagName: "input", label: "Email" }]
        }
      },
      { type: "thought", text: "I should summarize the page, then answer with concise bullets." },
      { type: "action", action: { type: "type", selector: "#email", value: "reader@example.com" }, reason: "Fill the active field" },
      { type: "action-result", action: { type: "type", selector: "#email", value: "reader@example.com" }, result: { ok: true, message: "Typed into field" } },
      { type: "blocked", reason: "Needs tab-level inspection", status: "blocked" },
      { type: "final", text: "Done." }
    ];

    expect(formatAgentEventsForTimeline(events)).toEqual([
      expect.objectContaining({ kind: "observe", title: "Observe", detail: "Read Example Product (2 headings, 1 controls)" }),
      expect.objectContaining({ kind: "reasoning", title: "Reasoning summary", detail: "Planned response from current page context." }),
      expect.objectContaining({ kind: "action", title: "Action", detail: "Type #email -> Fill the active field" }),
      expect.objectContaining({ kind: "result", title: "Action result", detail: "Type #email -> Typed into field" }),
      expect.objectContaining({ kind: "blocked", title: "Blocked", detail: "Needs tab-level inspection" }),
      expect.objectContaining({ kind: "final", title: "Final", detail: "Done." })
    ]);
  });

  it("maps skill draft confirmations into permission cards", () => {
    const events: AgentEvent[] = [
      {
        type: "action-result",
        action: { type: "skill", skillId: "builtin/skill-creator" },
        result: {
          ok: false,
          status: "needs_confirmation",
          message: "Review and install this skill.",
          skillDraft: {
            id: "page-qa",
            name: "page-qa",
            description: "Answer questions about pages.",
            skillMarkdown: "---\nname: page-qa\ndescription: Answer questions about pages.\n---\nUse page context.",
            enabled: true,
            source: "manual"
          }
        }
      }
    ];

    expect(formatAgentEventsForTimeline(events)).toEqual([
      expect.objectContaining({
        kind: "permission",
        action: "skill-install",
        title: "Install skill?",
        skillDraft: expect.objectContaining({ id: "page-qa" })
      })
    ]);
  });

  it("maps benchmark skill results into artifact timeline entries", () => {
    const events: AgentEvent[] = [
      {
        type: "action-result",
        action: { type: "skill", skillId: "builtin/screenshot" },
        result: {
          ok: true,
          message: "Screenshot captured.",
          benchmarkResult: {
            type: "screenshot",
            title: "Full-page screenshot",
            screenshot: {
              dataUrl: "data:image/png;base64,abc",
              mimeType: "image/png",
              width: 100,
              height: 200,
              filename: "page.png"
            }
          }
        }
      }
    ];

    expect(formatAgentEventsForTimeline(events)).toEqual([
      expect.objectContaining({
        kind: "result",
        title: "Full-page screenshot",
        image: expect.objectContaining({ filename: "page.png" })
      })
    ]);
  });

  it("labels browser tool actions in trace output", () => {
    const events: AgentEvent[] = [
      { type: "action", action: { type: "tool", toolId: "page.read", input: { mode: "semanticOutline" } }, reason: "Run browser tool page.read" },
      {
        type: "action-result",
        action: { type: "tool", toolId: "page.read", input: { mode: "semanticOutline" } },
        result: { ok: true, status: "success", message: "Read page" }
      },
      { type: "final", text: "Done." }
    ];

    expect(formatAgentRunResultForTimeline({ finalText: "Done.", events }, "Final")).toEqual([
      expect.objectContaining({
        kind: "result",
        title: "Activity",
        detail: "Run page.read · Tool completed"
      }),
      expect.objectContaining({ kind: "final", detail: "Done." })
    ]);
  });

  it("keeps only the last final event when duplicate finals arrive", () => {
    const events: AgentEvent[] = [
      { type: "final", text: "First final" },
      { type: "final", text: "Last final" }
    ];

    expect(formatAgentEventsForTimeline(events)).toEqual([
      expect.objectContaining({ kind: "final", title: "Final", detail: "Last final" })
    ]);
  });
});

describe("detectSkillInstallUrl", () => {
  it("detects skills.sh install requests", () => {
    expect(detectSkillInstallUrl("install skill https://skills.sh/acme/browser/page-report")).toBe("https://skills.sh/acme/browser/page-report");
    expect(detectSkillInstallUrl("安装 skill https://skills.sh/acme/browser/page-report")).toBe("https://skills.sh/acme/browser/page-report");
    expect(detectSkillInstallUrl("open https://skills.sh/acme/browser/page-report")).toBeUndefined();
  });
});

describe("detectDirectBenchmarkRequest", () => {
  it("routes screenshot requests directly to the screenshot tool", () => {
    expect(detectDirectBenchmarkRequest("帮我截一下整页截图")).toEqual({ type: "screenshot" });
    expect(detectDirectBenchmarkRequest("capture screenshot of this page")).toEqual({ type: "screenshot" });
    expect(detectDirectBenchmarkRequest("Do this", { id: "builtin/screenshot" })).toEqual({ type: "screenshot" });
    expect(detectDirectBenchmarkRequest("summarize this page")).toBeUndefined();
  });

  it("routes report requests directly to the report tool", () => {
    expect(detectDirectBenchmarkRequest("生成这个页面的分析报告")).toEqual({ type: "report" });
    expect(detectDirectBenchmarkRequest("create an HTML report for this page")).toEqual({ type: "report" });
    expect(detectDirectBenchmarkRequest("Do this", { id: "builtin/page-report" })).toEqual({ type: "report" });
  });
});

describe("filterComposerSkills", () => {
  it("filters enabled skills for @ mention UI", () => {
    const skills = [
      { id: "builtin/page-report", name: "page-report", description: "Create reports.", skillMarkdown: "", enabled: true, source: "builtin" as const },
      { id: "manual/page-qa", name: "page-qa", description: "Answer page questions.", skillMarkdown: "", enabled: true, source: "manual" as const },
      { id: "manual/off", name: "off", description: "Disabled.", skillMarkdown: "", enabled: false, source: "manual" as const }
    ];

    expect(filterComposerSkills(skills, "qa").map((skill) => skill.id)).toEqual(["manual/page-qa"]);
    expect(filterComposerSkills(skills, "").map((skill) => skill.id)).toEqual(["builtin/page-report", "manual/page-qa"]);
  });
});

describe("buildSidebarRunMessage", () => {
  it("sends an empty skillIds array when no composer skill is selected", () => {
    expect(buildSidebarRunMessage({
      task: "Summarize",
      mode: "auto",
      providerId: "provider-a",
      model: "model-a",
      tabId: 123,
      memory: { turns: [{ role: "user", content: "Earlier question" }] }
    })).toEqual({
      type: "agenticify:sidebar-run",
      task: "Summarize",
      mode: "auto",
      providerId: "provider-a",
      model: "model-a",
      tabId: 123,
      memory: { turns: [{ role: "user", content: "Earlier question" }] },
      skillIds: []
    });
  });

  it("sends the selected composer skill id in sidebar-run messages", () => {
    expect(buildSidebarRunMessage({
      task: "Create a report",
      mode: "dom",
      providerId: "provider-a",
      model: "model-a",
      memory: { turns: [] },
      selectedSkill: { id: "builtin/page-report" }
    })).toMatchObject({
      type: "agenticify:sidebar-run",
      task: "Create a report",
      mode: "dom",
      providerId: "provider-a",
      model: "model-a",
      memory: { turns: [] },
      skillIds: ["builtin/page-report"]
    });
  });
});

describe("moveSkillPickerIndex", () => {
  it("moves through skill picker options with wrapping", () => {
    expect(moveSkillPickerIndex(-1, "down", 3)).toBe(0);
    expect(moveSkillPickerIndex(0, "down", 3)).toBe(1);
    expect(moveSkillPickerIndex(2, "down", 3)).toBe(0);
    expect(moveSkillPickerIndex(-1, "up", 3)).toBe(2);
    expect(moveSkillPickerIndex(0, "up", 3)).toBe(2);
    expect(moveSkillPickerIndex(1, "up", 3)).toBe(0);
    expect(moveSkillPickerIndex(0, "down", 0)).toBe(-1);
  });
});

describe("isScrolledNearBottom", () => {
  it("treats small bottom gaps as still following the conversation", () => {
    expect(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 552, clientHeight: 400 })).toBe(true);
    expect(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });
});

describe("isConnectedToActivePage", () => {
  it("detects when Haro is still connected to a previous active tab", () => {
    expect(isConnectedToActivePage(
      { tabId: 10, url: "https://old.example/a" },
      { tabId: 11, origin: "https://new.example", url: "https://new.example/a" }
    )).toBe(false);
    expect(isConnectedToActivePage(
      { tabId: 10, url: "https://example.com/a" },
      { tabId: 10, origin: "https://example.com", url: "https://example.com/a" }
    )).toBe(true);
    expect(isConnectedToActivePage(null, { tabId: 10, origin: "https://example.com", url: "https://example.com/a" })).toBe(true);
  });

  it("treats same-origin path changes as a different connected page", () => {
    expect(isConnectedToActivePage(
      { tabId: 10, url: "https://example.com/docs/a?tab=1" },
      { tabId: 10, origin: "https://example.com", url: "https://example.com/docs/b?tab=1" }
    )).toBe(false);
  });
});

describe("stored conversation page helpers", () => {
  it("filters stored conversation pages by title or full URL", () => {
    const pages = [
      { title: "Docs", url: "https://example.com/docs/a", origin: "https://example.com", updatedAt: "2026-05-03T00:00:00.000Z" },
      { title: "Inbox", url: "https://mail.example.com/u/0", origin: "https://mail.example.com", updatedAt: "2026-05-03T00:00:01.000Z" }
    ];

    expect(filterStoredConversationPages(pages, "docs").map((page) => page.url)).toEqual(["https://example.com/docs/a"]);
    expect(filterStoredConversationPages(pages, "u/0").map((page) => page.url)).toEqual(["https://mail.example.com/u/0"]);
    expect(filterStoredConversationPages(pages, "")).toEqual(pages);
  });

  it("upserts stored conversation pages by full URL and sorts by update time", () => {
    const pages = upsertStoredConversationPage(
      [{ title: "Old", url: "https://example.com/a", origin: "https://example.com", updatedAt: "2026-05-03T00:00:00.000Z" }],
      { title: "New", url: "https://example.com/a", origin: "https://example.com" },
      "2026-05-03T00:00:02.000Z"
    );

    expect(pages).toEqual([
      { title: "New", url: "https://example.com/a", origin: "https://example.com", updatedAt: "2026-05-03T00:00:02.000Z" }
    ]);
  });

  it("creates a readable page shell when selecting stored conversation history", () => {
    expect(storedConversationPageToObservation({
      title: "Docs",
      url: "https://example.com/docs/a",
      origin: "https://example.com",
      updatedAt: "2026-05-03T00:00:00.000Z"
    })).toEqual({
      title: "Docs",
      url: "https://example.com/docs/a",
      origin: "https://example.com",
      text: "",
      headings: [],
      links: [],
      interactiveElements: []
    });
  });
});

describe("userMessageMeta", () => {
  it("shows selected skill on the submitted user message", () => {
    expect(userMessageMeta("auto", { name: "page-report" })).toBe("@page-report");
    expect(userMessageMeta("debugger")).toBe("DEBUGGER");
  });
});

describe("formatAgentRunResultForTimeline", () => {
  it("renders final text once when finalText and final events both exist", () => {
    const events: AgentEvent[] = [
      { type: "thought", text: "Ready to answer." },
      { type: "final", text: "Duplicated answer" },
      { type: "final", text: "Duplicated answer" }
    ];

    const items = formatAgentRunResultForTimeline({ finalText: "Duplicated answer", events }, "Final");

    expect(items.filter((item) => item.kind === "final")).toEqual([
      expect.objectContaining({ detail: "Duplicated answer" })
    ]);
  });

  it("collapses agent trace events into an activity summary before the final answer", () => {
    const events: AgentEvent[] = [
      {
        type: "observe",
        observation: {
          title: "Example Product",
          url: "https://example.com/product",
          origin: "https://example.com",
          text: "Product page",
          headings: ["Pricing"],
          links: [],
          interactiveElements: [{ selector: "#buy", tagName: "button", label: "Buy" }]
        }
      },
      { type: "thought", text: "I should click the button." },
      { type: "action", action: { type: "click", selector: "#buy" }, reason: "Open checkout" },
      { type: "action-result", action: { type: "click", selector: "#buy" }, result: { ok: true, message: "Clicked" } },
      { type: "final", text: "Opened checkout." }
    ];

    expect(formatAgentRunResultForTimeline({ finalText: "Opened checkout.", events }, "Final")).toEqual([
      expect.objectContaining({
        kind: "result",
        title: "Activity",
        meta: "TRACE",
        detail: "Read page · Planned · Click #buy · Tool completed"
      }),
      expect.objectContaining({ kind: "final", title: "Final", detail: "Opened checkout." })
    ]);
  });
});

describe("formatBenchmarkToolResultForTimeline", () => {
  it("maps benchmark artifacts into timeline entries", () => {
    expect(formatBenchmarkToolResultForTimeline({
      type: "screenshot",
      title: "Full-page screenshot",
      screenshot: {
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        width: 100,
        height: 200,
        filename: "page.png"
      }
    })).toMatchObject({
      kind: "result",
      title: "Full-page screenshot",
      image: { filename: "page.png" }
    });

    expect(formatBenchmarkToolResultForTimeline({
      type: "report",
      title: "Page analysis report",
      html: "<article><h1>Report</h1></article>"
    })).toMatchObject({
      kind: "final",
      html: "<article><h1>Report</h1></article>"
    });
  });

  it("maps non-artifact benchmark results into trace activity", () => {
    expect(formatBenchmarkToolResultForTimeline({
      type: "fill-form",
      title: "Form fill",
      formFill: { filled: 2, skipped: [{ selector: "#password", reason: "unsafe_field" }] }
    })).toMatchObject({
      kind: "result",
      title: "Activity",
      meta: "TRACE",
      detail: "Tool completed · Filled 2 fields · Skipped 1"
    });
  });
});

describe("parseMessageBlocks", () => {
  it("splits fenced code blocks from normal text", () => {
    expect(parseMessageBlocks("Before\n```ts\nconst ok = true;\n```\nAfter")).toEqual([
      { type: "text", content: "Before\n" },
      { type: "code", language: "ts", content: "const ok = true;" },
      { type: "text", content: "\nAfter" }
    ]);
  });
});

describe("MarkdownText", () => {
  it("renders common assistant markdown without leaking syntax markers", () => {
    const html = renderToStaticMarkup(createElement(
      MarkdownText,
      { content: [
        "## Overview",
        "This is a wrapped",
        "paragraph with a [source](https://example.com) and *emphasis*.",
        "",
        "> Important note",
        "",
        "- **First:** useful detail",
        "  continued detail",
        "- Second item",
        "",
        "---",
        "",
        "1. Step one",
        "2. Step two"
      ].join("\n") }
    ));

    expect(html).toContain("md-heading h2");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("md-blockquote");
    expect(html).toContain("<strong>First:</strong>");
    expect(html).toContain("continued detail");
    expect(html).toContain("md-rule");
    expect(html).toContain("<ol");
    expect(html).not.toContain("&gt; Important note");
    expect(html).not.toContain("[source]");
  });
});

describe("normalizeRuntimeMessageError", () => {
  it("turns missing receiver errors into an actionable message", () => {
    expect(normalizeRuntimeMessageError(new Error("Could not establish connection. Receiving end does not exist.")))
      .toBe("Haro is not connected. Reopen the side panel, or reload the extension if it was just updated.");
    expect(normalizeRuntimeMessageError(new Error("Receiving end does not exist."), "连接断开了。"))
      .toBe("连接断开了。");
  });
});

describe("site conversation persistence helpers", () => {
  it("uses full-page URL storage keys", () => {
    expect(getSiteConversationStorageKey("https://example.com/docs/a?tab=1")).toBe("agenticify:sidepanel:conversation:https://example.com/docs/a?tab=1");
  });

  it("keeps recent text timeline items and drops heavy screenshots", () => {
    const items = Array.from({ length: 82 }, (_, index) => ({
      kind: "final" as const,
      title: "Final",
      detail: `Message ${index}`,
      image: {
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png" as const,
        width: 100,
        height: 100,
        filename: "page.png"
      }
    }));

    const stored = sanitizeTimelineItemsForStorage(items);

    expect(stored).toHaveLength(80);
    expect(stored[0].detail).toBe("Message 2");
    expect(stored[0]).not.toHaveProperty("image");
  });

  it("builds page conversation memory from user and final timeline items only", () => {
    const memory = timelineItemsToConversationMemory([
      { kind: "observe", title: "Observe", detail: "Read page" },
      { kind: "user", title: "Task", detail: "这页讲什么？" },
      { kind: "result", title: "Activity", detail: "Read page", meta: "TRACE" },
      { kind: "final", title: "Final", detail: "这页介绍定价。" },
      { kind: "action", title: "Action", detail: "Click #buy" }
    ]);

    expect(memory).toEqual({
      turns: [
        { role: "user", content: "这页讲什么？" },
        { role: "assistant", content: "这页介绍定价。" }
      ]
    });
  });
});
