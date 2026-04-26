# Agent Skills Design

## Goal

Let BrowserAgent install and use standard `SKILL.md` skills, including skills from `https://skills.sh/`, while keeping execution safe inside the extension.

## Skill Format

Skills are stored as standard `SKILL.md` markdown with YAML frontmatter:

```md
---
name: page-translator
description: Translate visible page copy.
---

Skill instructions...
```

Agenticify stores the original markdown unchanged in `ExtensionSettings.skills[].skillMarkdown`, plus parsed metadata for indexing and matching.

## Installation

The first installer supports `https://skills.sh/<owner>/<repo>/<skill-path>` URLs. The extension resolves that into GitHub contents API:

```txt
https://api.github.com/repos/<owner>/<repo>/contents/<skill-path>/SKILL.md
```

The downloaded `SKILL.md` is parsed, validated, and stored locally. No skill code, scripts, or referenced files are executed.

## Usage

Runtime merges built-in skills with installed skills, matches them against the user task, and injects compact skill context into the model system prompt. Skills can guide model behavior through instructions.

Only built-in executable skills may produce `{"action":{"type":"skill","skillId":"..."}}`. External installed skills are prompt-only in this version.

## Built-In Skills

Existing benchmark tools are represented as built-in skills:

- `builtin/screenshot`
- `builtin/page-report`
- `builtin/rewrite-page`
- `builtin/fill-form`

These map to existing benchmark tool requests and keep existing permission gates, especially `debugger.control`.

## Safety

- Installed skills cannot execute arbitrary JavaScript.
- Installed skills cannot bypass permissions.
- Built-in executable skills call existing background benchmark routes.
- Gateway sites cannot install skills in this version.
- Sidepanel installation is explicit through an install command containing a `skills.sh` URL.
