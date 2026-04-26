# Debugger Benchmark Tools Design

## Goal

Build four stable BrowserAgent benchmark tools on top of Chrome Debugger API:

- full-page screenshot with PNG export data
- HTML page analysis report for chat display and image export
- reversible page text rewrite or translation through DOM mutation
- automatic form filling from a user description without submitting

## Scope

This release adds tool primitives and background routes. The sidepanel may call these routes and render returned artifacts, but options UI and model provider UI remain unchanged.

Debugger operations remain gated by existing `debugger.control` site permission. Form submission, payment, delete, send, account, and legal acceptance actions remain blocked or confirmation-only.

## Architecture

Add high-level browser tools above `DebuggerTools`:

- `DebuggerTools` stays responsible for low-level CDP commands.
- `browserTools` coordinates screenshot, report generation, rewrite, restore, and form fill plans.
- background routes expose benchmark tools to the sidepanel.
- sidepanel timeline displays returned text, HTML artifacts, and screenshot/export metadata.

The agent runtime can later call these same high-level tools. The first implementation keeps them as explicit sidepanel actions so each tool is demonstrable and testable.

## Tool Behavior

### Full-Page Screenshot

Use CDP `Page.getLayoutMetrics` and `Page.captureScreenshot` with `captureBeyondViewport: true`.
Return `dataUrl`, `mimeType`, width, height, and a filename.

### HTML Analysis Report

Capture a Debugger snapshot, call the configured model with a strict HTML-report prompt, sanitize the returned HTML, and return a report artifact. The report is shown in chat. Image export is handled from the rendered report container in the sidepanel using browser APIs.

### Page Rewrite / Translation

Collect visible text nodes, ask the model for replacement strings, then mutate text nodes in page context. Store a per-tab rewrite session in memory with original text so a restore action can revert the page.

The tool only changes text nodes. It does not change links, form values, attributes, scripts, styles, or hidden content.

### Auto Fill Form

Capture form controls and nearby labels/placeholders. Ask the model for a selector-to-value plan. Fill inputs, textareas, and selects through page scripts or existing debugger input primitives. Do not submit. Return a field-by-field result list.

## Testing

- unit test full-page screenshot command shape
- unit test rewrite applies and restores text node replacements
- unit test form fill dispatches safe fill script and does not submit
- unit test report HTML sanitization removes scripts and inline event handlers
- keep `pnpm test` and `pnpm run build` passing
