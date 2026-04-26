import { describe, expect, it, vi } from "vitest";
import {
  builtInSkills,
  buildSkillPrompt,
  installSkillFromUrl,
  matchSkillsForTask,
  parseSkillMarkdown,
  skillActionToBenchmarkRequest
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

  it("builds a compact skill prompt from matched standard skills", () => {
    const skill = parseSkillMarkdown(skillMarkdown);

    expect(buildSkillPrompt([skill])).toContain("Skill: page-translator");
    expect(buildSkillPrompt([skill])).toContain("Rewrite visible page text");
  });

  it("exposes benchmark capabilities as built-in executable skills", () => {
    expect(builtInSkills.map((skill) => skill.id)).toEqual([
      "builtin/screenshot",
      "builtin/page-report",
      "builtin/rewrite-page",
      "builtin/fill-form",
      "builtin/skill-creator"
    ]);
    expect(builtInSkills.find((skill) => skill.id === "builtin/skill-creator")?.skillMarkdown).toContain("Create a concise standard SKILL.md");
    expect(skillActionToBenchmarkRequest({ type: "skill", skillId: "builtin/page-report" })).toEqual({ type: "report" });
    expect(skillActionToBenchmarkRequest({ type: "skill", skillId: "builtin/fill-form", input: { instruction: "Use Ada's profile" } }))
      .toEqual({ type: "fill-form", instruction: "Use Ada's profile" });
  });
});
