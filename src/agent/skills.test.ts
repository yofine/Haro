import { describe, expect, it, vi } from "vitest";
import {
  builtInSkills,
  buildSkillPrompt,
  installSkillFromUrl,
  matchSkillsForTask,
  parseSkillMarkdown
} from "./skills";

const skillMarkdown = `---
name: page-translator
description: Translate visible page copy into another language.
---

# Page Translator

Rewrite visible page text while preserving meaning.
`;

describe("Agent skills", () => {
  it("parses standard SKILL.md frontmatter and stores markdown intact", () => {
    const skill = parseSkillMarkdown(skillMarkdown, { sourceUrl: "https://skills.sh/example/repo/page-translator" });

    expect(skill).toMatchObject({
      id: "page-translator",
      name: "page-translator",
      description: "Translate visible page copy into another language.",
      sourceUrl: "https://skills.sh/example/repo/page-translator",
      enabled: true
    });
    expect(skill.skillMarkdown).toBe(skillMarkdown);
  });

  it("parses browser skill frontmatter capabilities and script assets", () => {
    const skill = parseSkillMarkdown(`---
name: page-translator
description: Translate visible page copy in place.
runtime: browser
version: 1
risk: medium
capabilities:
  - page.read.textNodes
  - page.write.rewriteTextNodes
tools:
  - page.read
  - page.write
scripts:
  - scripts/plan.js
  - styles/preview.css
---

Use browser tools to translate the page.`);

    expect(skill).toMatchObject({
      id: "page-translator",
      runtime: "browser",
      version: 1,
      risk: "medium",
      capabilities: ["page.read.textNodes", "page.write.rewriteTextNodes"],
      tools: ["page.read", "page.write"],
      scripts: ["scripts/plan.js", "styles/preview.css"]
    });
  });

  it("ships built-in script-backed reading skills", () => {
    const skill = builtInSkills.find((entry) => entry.id === "builtin/mark-page")!;
    const translate = builtInSkills.find((entry) => entry.id === "builtin/immersive-translate")!;
    const notes = builtInSkills.find((entry) => entry.id === "builtin/paragraph-notes")!;

    expect(skill).toMatchObject({
      runtime: "browser",
      risk: "medium",
      tools: ["page.read", "page.script"],
      scripts: ["styles/mark-page.css", "scripts/mark-page.js"],
      scriptAssets: {
        "styles/mark-page.css": expect.stringContaining(".agenticify-marked-section"),
        "scripts/mark-page.js": expect.stringContaining("agenticify-marked-media")
      }
    });
    expect(skill.skillMarkdown).toContain("page.script");
    expect(skill.skillMarkdown).toContain("scriptId");

    expect(translate).toMatchObject({
      runtime: "browser",
      tools: ["page.read", "page.script"],
      scripts: ["styles/immersive-reading.css", "scripts/immersive-translate.js"],
      scriptAssets: {
        "scripts/immersive-translate.js": expect.stringContaining("agenticify-translation")
      }
    });
    expect(translate.skillMarkdown).toContain("generateParagraphTranslations");

    expect(notes).toMatchObject({
      runtime: "browser",
      tools: ["page.read", "page.script"],
      scripts: ["styles/immersive-reading.css", "scripts/paragraph-notes.js"],
      scriptAssets: {
        "scripts/paragraph-notes.js": expect.stringContaining("agenticify-note-label"),
        "styles/immersive-reading.css": expect.stringContaining("border-left")
      }
    });
    expect(notes.skillMarkdown).toContain("generateParagraphNotes");
  });

  it("installs a skill from a skills.sh URL through GitHub contents", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: btoa(skillMarkdown),
        encoding: "base64"
      })
    });

    const skill = await installSkillFromUrl("https://skills.sh/acme/browser-skills/page-translator", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("https://api.github.com/repos/acme/browser-skills/contents/page-translator/SKILL.md");
    expect(skill.name).toBe("page-translator");
  });

  it("matches enabled skills by task, name, description, and body", () => {
    const skill = parseSkillMarkdown(skillMarkdown);

    expect(matchSkillsForTask("Please translate this page to Chinese", [skill]).map((item) => item.id)).toEqual(["page-translator"]);
    expect(matchSkillsForTask("Take a screenshot", [skill])).toEqual([]);
  });

  it("matches built-in reading skills from Chinese task phrases", () => {
    expect(matchSkillsForTask("执行沉浸式翻译", builtInSkills).map((item) => item.id)).toContain("builtin/immersive-translate");
    expect(matchSkillsForTask("给文章段落加标注", builtInSkills).map((item) => item.id)).toContain("builtin/paragraph-notes");
  });

  it("builds a compact skill prompt from matched standard skills", () => {
    const skill = parseSkillMarkdown(skillMarkdown);

    expect(buildSkillPrompt([skill])).toContain("Skill: page-translator");
    expect(buildSkillPrompt([skill])).toContain("Rewrite visible page text");
  });

  it("includes browser skill tool metadata in skill prompts", () => {
    const skill = builtInSkills.find((entry) => entry.id === "builtin/rewrite-page")!;

    expect(buildSkillPrompt([skill])).toContain("Runtime: browser");
    expect(buildSkillPrompt([skill])).toContain("Tools: page.read, page.write");
    expect(buildSkillPrompt([skill])).toContain("Capabilities: page.read.textNodes, page.write.rewriteTextNodes");
    expect(buildSkillPrompt([skill])).toContain("For browser runtime skills, call action {\"type\":\"skill\",\"skillId\":\"...\",\"input\":{\"browserToolPlan\":{\"calls\":[...]}}}");
  });

  it("exposes benchmark capabilities as built-in executable skills", () => {
    expect(builtInSkills.map((skill) => skill.id)).toEqual([
      "builtin/screenshot",
      "builtin/page-report",
      "builtin/rewrite-page",
      "builtin/fill-form",
      "builtin/mark-page",
      "builtin/immersive-translate",
      "builtin/paragraph-notes",
      "builtin/skill-creator"
    ]);
    expect(builtInSkills.find((skill) => skill.id === "builtin/skill-creator")?.skillMarkdown).toContain("Create a concise standard SKILL.md");
    expect(builtInSkills.find((skill) => skill.id === "builtin/page-report")).toMatchObject({
      runtime: "browser",
      risk: "low",
      tools: ["page.read", "artifacts.createHtmlReport"]
    });
    expect(builtInSkills.find((skill) => skill.id === "builtin/rewrite-page")).toMatchObject({
      runtime: "browser",
      risk: "medium",
      tools: ["page.read", "page.write"]
    });
    expect(builtInSkills.find((skill) => skill.id === "builtin/screenshot")).toMatchObject({
      runtime: "browser",
      risk: "low",
      tools: ["page.read", "page.capture"]
    });
    for (const skill of builtInSkills.filter((entry) => entry.runtime === "browser")) {
      expect(skill.skillMarkdown).toContain("browserToolPlan");
      expect(skill.skillMarkdown).not.toContain("Compatibility action protocol");
    }
  });
});
