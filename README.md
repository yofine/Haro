# Haro

Turn your browser into an AI browser.

Haro is a Chrome MV3 extension that adds a quiet, page-aware AI layer to the browser. It includes a sidebar-first experience, local model provider settings, a low-profile `window.browserAgent` gateway, site permissions, memory, skills, and call observability.

## Stack

- React
- TypeScript
- Vite
- Chrome Manifest V3
- Tailwind CSS
- shadcn-inspired local UI primitives
- Vitest

## Develop

```bash
pnpm install
pnpm test
pnpm run build
```

## Load In Chrome

1. Run `pnpm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `dist` directory.

## First Run

1. Open the extension options page.
2. Add one or more model provider profiles.
3. Choose OpenAI-compatible or Anthropic-compatible format for each profile.
4. Add your API key, custom Base URL if needed, and model names.
5. Test the provider connection and choose the default provider/model.
6. Open any webpage.
7. Open the Haro side panel and run a page task.

## Gateway Example

Authorized websites can call:

```js
const access = await window.browserAgent.requestAccess({
  appName: "Example App",
  scopes: ["model.chat", "page.read", "page.act", "agent.run"],
  autoRun: true
});

if (access.ok) {
  const status = await window.browserAgent.getStatus();
  const chat = await window.browserAgent.chat({
    messages: [{ role: "user", content: "Summarize this page." }]
  });
  const run = await window.browserAgent.run({
    task: "Extract the main action items from this page.",
    mode: "auto"
  });
}
```

Gateway responses use a stable v1 envelope:

```js
{ ok: true, requestId: "...", result: ... }
{ ok: false, requestId: "...", code: "permission_denied", error: { code, message } }
```

First-release scopes are `model.chat`, `page.read`, `page.act`, `agent.run`, and gated `debugger.control`.
API keys stay inside extension storage and are never exposed to webpages.
Call logs and debug logs are kept lightweight and redact provider secrets.

## Debugger Mode

Debugger mode is an advanced control capability built on the Chrome Debugger API. It is not enabled by default, only works on the current active tab, and requires a separate `debugger.control` site authorization before Haro can attach. Use it when DOM mode is not reliable enough for page inspection or input.
