# Haro Brand Design

## 1. Brand Direction

**Haro** is the product-facing name and character layer for the AI browser experience.

The underlying product promise remains:

> Turn your browser into an AI browser.

In Chinese:

> 把普通浏览器变成 AI 浏览器。

Haro should not feel like a generic AI chatbot, a developer tool, or a virtual pet. Haro is a quiet companion inside the browser: present when needed, respectful when not needed, and increasingly useful as it remembers context and user preferences.

## 2. Brand Relationship

- **Haro**: the visible product name and user-facing assistant identity.
- **Agenticify**: the product mental model and positioning, not the main UI brand name.
- **BrowserAgent / window.browserAgent**: developer-facing technical concepts. These may remain in code, API docs, or technical examples where accuracy matters.

UI should use **Haro** as the main visible brand. Agenticify may appear only as a positioning idea, such as "Agenticify your browser" or "Turn your browser into an AI browser."

## 3. Personality

Haro sits between a quiet tool and a lightly personified companion.

Core traits:

- **Quiet**: Haro does not interrupt, over-explain, or force personality into every interaction.
- **Reliable**: Haro is clear about what it can do, what it needs permission for, and what happened.
- **Memory-aware**: Haro can remember useful context, preferences, and site-specific patterns.
- **Warm**: Haro sounds more human than a settings panel, but still concise and professional.
- **Small robot presence**: Haro can feel like a small companion in the browser, but should not become cute, needy, emotional, or pet-like.

The emotional texture should come from continuity, memory, and calm wording, not from exaggerated character behavior.

## 4. Voice Principles

### Do

- Use short, calm sentences.
- Prefer "ready", "remember", "help", "work with this page", and "when you need it".
- Make permissions feel safe and understandable.
- Use first person sparingly when it reinforces memory or action clarity.
- Keep technical areas professional, especially model settings, gateway access, debugger mode, and logs.

### Avoid

- Overly cute or playful language.
- Strong emotional claims.
- Phrases that imply surveillance.
- Phrases that imply Haro is taking control away from the user.
- Replacing clear permission language with personality.

Avoid examples:

- "I missed you."
- "Haro is excited!"
- "Your cute browser buddy."
- "I am always watching this page."
- "Let me take over."

## 5. Naming Rules

- Use **Haro** as the product name.
- Do not use "Haro Assistant", "Haro Partner", "Haro Buddy", or similar variants in UI.
- Do not use Agenticify as the product name in UI.
- Keep technical API names unchanged where needed, such as `window.browserAgent`.
- Keep scope names, message names, storage keys, and internal logic names unchanged.

## 6. Suggested UI Copy

### Product Taglines

- Turn your browser into an AI browser.
- Haro brings page-aware AI into your browser.
- Haro is ready when you need it.

### Side Panel

- Haro is ready when you need it.
- Ask Haro to read, reason, or act on this page.
- Haro can help with the current page.
- Haro will keep this in mind.
- Remembered for this site.
- Working with the current page.
- Waiting for your next task.

### Permissions

- Allow Haro to work with this site.
- Haro needs permission before it can read or act on this page.
- Debugger mode gives Haro deeper page access and should be enabled only when needed.
- You can revoke site access at any time.

### Model Settings

- Configure the model Haro uses.
- Haro uses your configured provider. API keys stay inside the extension.
- Test this provider before using it with Haro.

### Gateway

- Let trusted sites ask Haro to use your configured model without exposing API keys.
- Site access controls what Haro can read, run, or operate.
- Gateway responses use a stable v1 envelope.

### Memory

- Haro will keep this in mind.
- Haro can remember useful context for this site.
- Clear this site's conversation memory.
- Recent memory helps Haro answer with better context.

## 7. Chinese Copy Direction

Use **Haro** directly in Chinese UI. Do not translate the name or add "助手" / "伙伴" after it.

Recommended:

- Haro 随时待命。
- 让 Haro 阅读、理解或处理当前页面。
- Haro 会记住这次上下文。
- 已为这个站点记住。
- 允许 Haro 处理这个站点。
- Haro 需要权限才能读取或操作当前页面。
- 调试模式会给 Haro 更深入的页面访问能力，只在需要时开启。
- Haro 使用你配置的模型，API Key 不会暴露给网页。

Avoid:

- Haro 很想你。
- Haro 超开心。
- 你的可爱浏览器伙伴。
- Haro 一直在看着这个页面。
- 让 Haro 接管浏览器。

## 8. Visual Direction

This document does not require visual asset implementation, but it defines the intended visual feeling for future work.

Recommended direction:

- A small circular or capsule-like presence can reference Haro's origin as a small spherical companion robot.
- Use restraint: the UI should remain a productivity tool, not a character app.
- Prefer small status marks, soft motion, or a compact avatar over large mascots.
- The visual system should support future memory/personality states without making them dominant.

Possible future states:

- Ready
- Reading
- Thinking
- Acting
- Remembered
- Needs permission
- Blocked

## 9. UI Change Boundary

This brand pass should only affect visible UI and user-facing documentation.

Allowed:

- Manifest display name and description.
- Page titles.
- Side panel visible copy.
- Options page visible copy.
- README user-facing brand copy.
- Permission and gateway explanatory text.
- Tests that only assert visible UI text.

Not allowed:

- Internal runtime behavior.
- Model gateway behavior.
- Permissions logic.
- Scope names.
- Message types.
- Storage keys.
- Public API names such as `window.browserAgent`.
- TypeScript type names or function names unless they are purely UI labels.

## 10. Prompt For UI Agent

Use this prompt when assigning the UI update to another agent:

```text
You are responsible for UI copy and visible brand presentation only. Do not change product purpose, internal logic, protocols, function names, storage keys, message types, permission scopes, model gateway behavior, or agent runtime behavior.

Goal:
Update the visible product brand from Agenticify to Haro. Haro is a quiet, lightly personified AI browser presence. It has a sense of companionship and memory, but it must not feel like a virtual pet or a noisy chatbot.

Positioning:
- Main visible brand: Haro
- Product mental model: Turn your browser into an AI browser.
- Chinese positioning: 把普通浏览器变成 AI 浏览器。
- Agenticify may remain only as a positioning concept, not as the primary product name.

Brand rules:
1. Use only "Haro" as the product name.
2. Do not write "Haro Assistant", "Haro Partner", "Haro Buddy", or Chinese variants like "Haro 助手" / "Haro 伙伴".
3. Keep the tone quiet, reliable, memory-aware, and lightly warm.
4. Do not make Haro cute, needy, emotional, or pet-like.
5. Keep permission, model, gateway, debugger, and log copy clear and professional.

Suggested copy:
- Product tagline: Turn your browser into an AI browser.
- Empty state: Haro is ready when you need it.
- Task prompt: Ask Haro to read, reason, or act on this page.
- Memory: Haro will keep this in mind.
- Site memory: Remembered for this site.
- Permission: Allow Haro to work with this site.
- Gateway: Let trusted sites ask Haro to use your configured model without exposing API keys.
- Model settings: Configure the model Haro uses.

Scope:
- Update manifest display name and description if needed.
- Update visible copy in sidepanel and options UI.
- Update page titles and user-facing README copy.
- Update tests only when they assert visible text.

Do not modify:
- `window.browserAgent`
- Gateway methods
- Permission scopes
- Message types
- Storage keys
- Runtime behavior
- Model provider behavior
- Debugger behavior

Before editing, scan the current UI copy and list the visible text locations you intend to change. Then make the smallest sufficient UI-layer changes and run the existing test suite.
```

