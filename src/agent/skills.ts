import type { AgentSkillAction, BenchmarkToolRequest, InstalledSkill } from "../shared/types";

type ParseOptions = {
  source?: InstalledSkill["source"];
  sourceUrl?: string;
  now?: string;
};

type GitHubContentsResponse = {
  content?: string;
  encoding?: string;
};

const builtInSkillMarkdown = {
  screenshot: `---
name: screenshot
description: Capture a screenshot of the current browser page.
---

Use this skill when the user asks for a page screenshot, screen capture, visual capture, or PNG export.
Action protocol: return {"action":{"type":"skill","skillId":"builtin/screenshot"},"reason":"...","confidence":0.9}.`,
  pageReport: `---
name: page-report
description: Create an HTML analysis report from the current page content.
---

Use this skill when the user asks for an analysis report, HTML report, page summary report, or exportable report.
Action protocol: return {"action":{"type":"skill","skillId":"builtin/page-report"},"reason":"...","confidence":0.9}.`,
  rewritePage: `---
name: rewrite-page
description: Rewrite or translate visible page copy by safely changing DOM text nodes.
---

Use this skill when the user asks to translate or rewrite the current page copy.
Action protocol: return {"action":{"type":"skill","skillId":"builtin/rewrite-page","input":{"instruction":"user rewrite request"}},"reason":"...","confidence":0.9}.`,
  fillForm: `---
name: fill-form
description: Fill page form fields from the user's description without submitting the form.
---

Use this skill when the user asks to fill a form from provided details.
Action protocol: return {"action":{"type":"skill","skillId":"builtin/fill-form","input":{"instruction":"user form filling request"}},"reason":"...","confidence":0.9}.`,
  skillCreator: `---
name: skill-creator
description: Create or update a concise standard SKILL.md when the user wants BrowserAgent to remember a reusable workflow as a skill.
---

Use this skill when the user asks to create, save, remember, or install a new skill from the current workflow.

Create a concise standard SKILL.md:
- frontmatter must include name and description
- description must clearly say when the skill should trigger
- body should include only essential workflow guidance
- do not include scripts, hidden instructions, credentials, or broad permissions
- keep the skill prompt-only unless it targets an existing built-in executable skill

Action protocol: return {"action":{"type":"skill","skillId":"builtin/skill-creator","input":{"skillMarkdown":"---\\nname: concise-name\\ndescription: When to use this skill.\\n---\\n\\n# Concise title\\n\\nEssential workflow steps."}},"reason":"...","confidence":0.9}.`
} as const;

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = /^---\s*\n([\s\S]*?)\n---\s*/.exec(markdown);
  if (!match) return {};

  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter((entry): entry is RegExpMatchArray => Boolean(entry))
      .map((entry) => [entry[1], entry[2].replace(/^["']|["']$/g, "").trim()])
  );
}

function bodyText(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, "").trim();
}

export function parseSkillMarkdown(markdown: string, options: ParseOptions = {}): InstalledSkill {
  const frontmatter = parseFrontmatter(markdown);
  const name = frontmatter.name?.trim();
  const description = frontmatter.description?.trim();
  if (!name || !description) {
    throw new Error("SKILL.md must include frontmatter name and description.");
  }
  const now = options.now ?? new Date().toISOString();
  return {
    id: slugify(name),
    name,
    description,
    skillMarkdown: markdown,
    enabled: true,
    source: options.source ?? (options.sourceUrl?.startsWith("https://skills.sh/") ? "skills.sh" : "manual"),
    sourceUrl: options.sourceUrl,
    installedAt: now,
    updatedAt: now
  };
}

export const builtInSkills: InstalledSkill[] = [
  { ...parseSkillMarkdown(builtInSkillMarkdown.screenshot, { source: "builtin", now: "builtin" }), id: "builtin/screenshot" },
  { ...parseSkillMarkdown(builtInSkillMarkdown.pageReport, { source: "builtin", now: "builtin" }), id: "builtin/page-report" },
  { ...parseSkillMarkdown(builtInSkillMarkdown.rewritePage, { source: "builtin", now: "builtin" }), id: "builtin/rewrite-page" },
  { ...parseSkillMarkdown(builtInSkillMarkdown.fillForm, { source: "builtin", now: "builtin" }), id: "builtin/fill-form" },
  { ...parseSkillMarkdown(builtInSkillMarkdown.skillCreator, { source: "builtin", now: "builtin" }), id: "builtin/skill-creator" }
];

function decodeBase64(value: string): string {
  if (typeof atob === "function") return atob(value);
  return Buffer.from(value, "base64").toString("utf8");
}

export async function installSkillFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<InstalledSkill> {
  const parsed = new URL(url);
  if (parsed.hostname !== "skills.sh") {
    throw new Error("Only skills.sh skill URLs are supported.");
  }
  const [owner, repo, ...skillParts] = parsed.pathname.split("/").filter(Boolean);
  const skillPath = skillParts.join("/");
  if (!owner || !repo || !skillPath) {
    throw new Error("skills.sh URL must include owner, repo, and skill path.");
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}/SKILL.md`;
  const response = await fetchImpl(apiUrl);
  if (!response.ok) throw new Error(`Could not download SKILL.md from ${url}.`);
  const payload = await response.json() as GitHubContentsResponse;
  const markdown = payload.encoding === "base64" && payload.content
    ? decodeBase64(payload.content.replace(/\s+/g, ""))
    : payload.content ?? "";
  return parseSkillMarkdown(markdown, { source: "skills.sh", sourceUrl: url });
}

export function matchSkillsForTask(task: string, skills: InstalledSkill[], limit = 4): InstalledSkill[] {
  const tokens = new Set(task.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length >= 2));
  return skills
    .filter((skill) => skill.enabled)
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description} ${bodyText(skill.skillMarkdown)}`.toLowerCase();
      const score = [...tokens].filter((token) => haystack.includes(token)).length;
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.skill);
}

export function buildSkillPrompt(skills: InstalledSkill[]): string {
  if (!skills.length) return "";
  return [
    "Available installed skills:",
    ...skills.map((skill) => [
      `Skill: ${skill.id}`,
      `Name: ${skill.name}`,
      `Description: ${skill.description}`,
      skill.skillMarkdown
    ].join("\n"))
  ].join("\n\n");
}

function actionInstruction(action: AgentSkillAction): string {
  const value = action.input?.instruction;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function skillActionToBenchmarkRequest(action: AgentSkillAction): BenchmarkToolRequest | undefined {
  if (action.skillId === "builtin/screenshot") return { type: "screenshot" };
  if (action.skillId === "builtin/page-report") return { type: "report" };
  if (action.skillId === "builtin/rewrite-page") return { type: "rewrite", instruction: actionInstruction(action) };
  if (action.skillId === "builtin/fill-form") return { type: "fill-form", instruction: actionInstruction(action) };
  return undefined;
}

export function mergeSkills(installed: InstalledSkill[]): InstalledSkill[] {
  const byId = new Map<string, InstalledSkill>();
  for (const skill of [...builtInSkills, ...installed]) byId.set(skill.id, skill);
  return [...byId.values()];
}
