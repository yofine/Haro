# Privacy Policy

Last updated: 2026-04-27

## Overview
Haro is a Chrome extension that turns your browser into an AI browser. It provides a side panel AI experience, user-configured model provider settings, page-aware browser actions, site permissions, memory, skills, and lightweight call/debug logs.

## Data We Store Locally

Haro stores extension data locally in Chrome extension storage. This may include:

- Model provider settings, including API keys, base URLs, model names, and default model selections.
- Site permissions, including approved origins, granted scopes, auto-run status, and revocation status.
- Extension preferences, such as locale and gateway settings.
- Installed skills and manually added skill content.
- Conversation memory and recent side panel history for the sites you use Haro with.
- Lightweight call logs and debug logs used for transparency and troubleshooting.

API keys are stored only in Chrome extension storage and are not exposed to websites through the page gateway.

## Data Sent To Model Providers

Haro does not operate its own cloud service for model inference. If you configure an OpenAI-compatible or Anthropic-compatible provider and ask Haro to chat, summarize, reason about, or act on a page, Haro may send the necessary prompts, selected page context, conversation memory, task instructions, and model parameters to the provider you configured.

The model provider receives that data only when you use model-powered features or when a site you authorized uses Haro through the gateway. Use of third-party model providers is subject to the privacy policy and data practices of the provider you configure.

## Website Gateway And Site Access

Authorized websites can request access to Haro through the `window.browserAgent` gateway. Access is origin-scoped and controlled by explicit permissions such as model chat, page reading, page actions, agent runs, and debugger control.

Websites cannot read your API keys. They can only receive the results of approved Haro requests. You can revoke site access from the extension settings.

## Data Usage

Haro uses stored and processed data only to provide extension functionality, including:

- Saving your model and extension settings.
- Reading page content when you ask Haro to work with the current page.
- Sending model requests to your configured provider.
- Running page actions that you request or authorize.
- Remembering relevant context for future interactions.
- Showing call history and debug information inside the extension.

Haro does not include analytics, advertising trackers, or behavioral tracking tools.

## Data Sharing

Haro does not sell personal data. Haro does not share data with the developer's own servers.

Data may be transmitted to third-party model providers only when you configure a provider and use model-powered features, as described above.

## Data Retention And Deletion

Data stored by Haro remains in Chrome extension storage until you update it, clear it, revoke access, remove memories, uninstall the extension, or clear extension storage through Chrome.

You can remove provider settings, revoke site permissions, clear memory entries, and review call/debug logs from the extension UI where those controls are available.

## Permissions

This extension requires certain browser permissions solely to provide its core functionality:

- **activeTab**: To access the current tab when you activate Haro or ask it to work with the active page.
- **debugger**: To support explicitly authorized advanced page inspection and browser control, such as debugger-mode snapshots, screenshots, text rewriting, and form filling. Debugger mode is gated by separate site authorization and should be used only for sites you trust.
- **scripting**: To inject the content script and page gateway needed to observe page content, expose `window.browserAgent`, and run approved page actions.
- **sidePanel**: To display Haro's user interface in the Chrome side panel.
- **storage**: To save settings, provider profiles, API keys, site permissions, memory, skills, call logs, and debug logs locally.
- **host permissions (`<all_urls>`)**: To allow Haro to run on regular web pages when you choose to use it, observe the active page, and support origin-scoped gateway permissions across websites.

## Security Notes

- API keys are not exposed to webpages.
- Site access is origin-scoped and can be revoked.
- Debugger control requires explicit authorization.
- High-risk browser actions may be blocked or require confirmation.
- Logs are intended to be lightweight and should not include provider secrets.

## Changes
We may update this Privacy Policy from time to time. Any changes will be posted on this page.

## Contact
If you have any questions, please contact: yofineliu@gmail.com
