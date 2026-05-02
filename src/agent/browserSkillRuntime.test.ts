import { describe, expect, it } from "vitest";
import type { AgentSkillAction } from "../shared/types";
import { builtInSkills } from "./skills";
import { planBrowserSkillAction } from "./browserSkillRuntime";

describe("browser skill runtime", () => {
  it("plans built-in browser skills through browser tool plans", () => {
    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "builtin/page-report",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.read", input: { mode: "semanticOutline" } },
            { toolId: "page.read", input: { mode: "visibleText" } },
            { toolId: "artifacts.createHtmlReport", input: {} }
          ]
        }
      }
    }, builtInSkills)).toMatchObject({
      ok: true,
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "semanticOutline" } },
          { toolId: "page.read", input: { mode: "visibleText" } },
          { toolId: "artifacts.createHtmlReport", input: {} }
        ]
      }
    });

    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "builtin/rewrite-page",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.read", input: { mode: "textNodes" } },
            { toolId: "page.write", input: { operation: "rewriteTextNodes", instruction: "Translate to Chinese" } }
          ]
        }
      }
    }, builtInSkills)).toMatchObject({
      ok: true,
      plan: {
        calls: [
          { toolId: "page.read", input: { mode: "textNodes" } },
          { toolId: "page.write", input: { operation: "rewriteTextNodes", instruction: "Translate to Chinese" } }
        ]
      }
    });
  });

  it("plans built-in browser skills from their default browser tool plan", () => {
    expect(planBrowserSkillAction({ type: "skill", skillId: "builtin/page-report" }, builtInSkills)).toMatchObject({
      ok: true,
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "semanticOutline" } },
          { toolId: "page.read", input: { mode: "visibleText" } },
          { toolId: "artifacts.createHtmlReport", input: {} }
        ]
      }
    });
  });

  it("blocks browser skills that request undeclared tools", () => {
    const action: AgentSkillAction = { type: "skill", skillId: "custom/unsafe" };
    const skill = {
      id: "custom/unsafe",
      name: "unsafe",
      description: "Unsafe script",
      skillMarkdown: "---\nname: unsafe\ndescription: Unsafe script\nruntime: browser\n---",
      enabled: true,
      source: "manual" as const,
      runtime: "browser" as const,
      tools: ["page.script"],
      risk: "high" as const
    };

    expect(planBrowserSkillAction(action, [skill])).toEqual({
      ok: false,
      status: "needs_confirmation",
      message: "Browser skill custom/unsafe requires explicit confirmation before high-risk tools can run."
    });
  });

  it("plans custom browser skills from declared browser tool plans", () => {
    const skill = {
      id: "custom/reader",
      name: "reader",
      description: "Read page content.",
      skillMarkdown: "---\nname: reader\ndescription: Read page content\nruntime: browser\ntools:\n  - page.read\n---\nRead the page.",
      enabled: true,
      source: "manual" as const,
      runtime: "browser" as const,
      tools: ["page.read"],
      risk: "low" as const
    };

    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "custom/reader",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.read", input: { mode: "visibleText" } }
          ]
        }
      }
    }, [skill])).toMatchObject({
      ok: true,
      plan: {
        source: "skill",
        calls: [
          { toolId: "page.read", input: { mode: "visibleText" } }
        ]
      }
    });
  });

  it("resolves declared script assets into page.script tool calls", () => {
    const skill = builtInSkills.find((entry) => entry.id === "builtin/mark-page")!;

    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "builtin/mark-page",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.script", input: { language: "css", scriptId: "styles/mark-page.css" } },
            { toolId: "page.script", input: { language: "js", scriptId: "scripts/mark-page.js" } }
          ]
        }
      }
    }, [skill])).toMatchObject({
      ok: true,
      plan: {
        calls: [
          { toolId: "page.script", input: { language: "css", scriptId: "styles/mark-page.css", code: expect.stringContaining(".agenticify-marked-heading") } },
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/mark-page.js", code: expect.stringContaining("agenticify-marked-heading") } }
        ]
      }
    });
  });

  it("resolves immersive reading script skills with generation hints", () => {
    const skill = builtInSkills.find((entry) => entry.id === "builtin/immersive-translate")!;

    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "builtin/immersive-translate",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.read", input: { mode: "visibleText" } },
            { toolId: "page.script", input: { language: "css", scriptId: "styles/immersive-reading.css" } },
            { toolId: "page.script", input: { language: "js", scriptId: "scripts/immersive-translate.js", generate: "paragraphTranslations" } }
          ]
        }
      }
    }, [skill])).toMatchObject({
      ok: true,
      plan: {
        calls: [
          { toolId: "page.read", input: { mode: "visibleText" } },
          { toolId: "page.script", input: { language: "css", scriptId: "styles/immersive-reading.css", code: expect.stringContaining("agenticify-immersive-block") } },
          { toolId: "page.script", input: { language: "js", scriptId: "scripts/immersive-translate.js", generate: "paragraphTranslations", code: expect.stringContaining("agenticify-translation") } }
        ]
      }
    });
  });

  it("blocks script asset ids that are not declared by the skill", () => {
    const skill = builtInSkills.find((entry) => entry.id === "builtin/mark-page")!;

    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "builtin/mark-page",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.script", input: { language: "js", scriptId: "scripts/unknown.js" } }
          ]
        }
      }
    }, [skill])).toEqual({
      ok: false,
      status: "blocked",
      message: "Skill builtin/mark-page requested undeclared script asset scripts/unknown.js."
    });
  });

  it("blocks custom browser skill plans that use undeclared tools", () => {
    const skill = {
      id: "custom/reader",
      name: "reader",
      description: "Read page content.",
      skillMarkdown: "---\nname: reader\ndescription: Read page content\nruntime: browser\ntools:\n  - page.read\n---\nRead the page.",
      enabled: true,
      source: "manual" as const,
      runtime: "browser" as const,
      tools: ["page.read"],
      risk: "low" as const
    };

    expect(planBrowserSkillAction({
      type: "skill",
      skillId: "custom/reader",
      input: {
        browserToolPlan: {
          calls: [
            { toolId: "page.write", input: { operation: "rewriteTextNodes" } }
          ]
        }
      }
    }, [skill])).toEqual({
      ok: false,
      status: "blocked",
      message: "Skill custom/reader requested undeclared browser tool page.write."
    });
  });
});
