import type { BrowserToolDefinition } from "./types";

const objectSchema = (properties: Record<string, { type: string; enum?: string[] }> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

const definitions: BrowserToolDefinition[] = [
  {
    id: "page.read",
    description: "Read browser page content through a requested mode such as visibleText, semanticOutline, interactiveElements, textNodes, forms, selectedText, htmlSnapshot, or accessibilityTree.",
    executor: "hybrid",
    risk: "low",
    inputSchema: objectSchema({
      mode: { type: "string", enum: ["visibleText", "semanticOutline", "interactiveElements", "selectedText", "htmlSnapshot", "accessibilityTree", "textNodes", "forms"] },
      limit: { type: "number" }
    }, ["mode"]),
    outputSchema: objectSchema()
  },
  {
    id: "page.write",
    description: "Mutate browser page state through controlled reversible operations such as filling fields, rewriting text nodes, injecting CSS, overlays, or restoring sessions.",
    executor: "dom",
    risk: "medium",
    requiresConfirmation: true,
    reversible: true,
    inputSchema: objectSchema({
      operation: { type: "string", enum: ["setInputValue", "setFormValues", "rewriteTextNodes", "injectCss", "injectOverlay", "restoreMutation"] }
    }, ["operation"]),
    outputSchema: objectSchema()
  },
  {
    id: "page.capture",
    description: "Capture page visuals including viewport, full-page, element screenshots, and HTML-to-image artifacts.",
    executor: "debugger",
    risk: "low",
    requiresDebugger: true,
    inputSchema: objectSchema({
      target: { type: "string", enum: ["viewport", "fullPage", "element", "html"] },
      selector: { type: "string" },
      filenameHint: { type: "string" }
    }, ["target"]),
    outputSchema: objectSchema()
  },
  {
    id: "artifacts.createHtmlReport",
    description: "Create a sanitized HTML report artifact for display and export.",
    executor: "dom",
    risk: "low",
    inputSchema: objectSchema({
      html: { type: "string" },
      title: { type: "string" }
    }, ["html"]),
    outputSchema: objectSchema()
  },
  {
    id: "page.act",
    description: "Perform user-like page actions such as click, type, scroll, select, and focus with high-risk action gating.",
    executor: "dom",
    risk: "medium",
    requiresConfirmation: true,
    inputSchema: objectSchema({
      action: { type: "string", enum: ["click", "type", "scroll", "select", "focus"] },
      selector: { type: "string" },
      text: { type: "string" }
    }, ["action"]),
    outputSchema: objectSchema()
  },
  {
    id: "page.script",
    description: "Run constrained browser JS or CSS skill assets through a sandboxed browser skill API.",
    executor: "hybrid",
    risk: "high",
    requiresConfirmation: true,
    inputSchema: objectSchema({
      language: { type: "string", enum: ["js", "css"] },
      code: { type: "string" },
      scriptId: { type: "string" }
    }, ["language"]),
    outputSchema: objectSchema()
  }
];

export function listBrowserToolDefinitions(): BrowserToolDefinition[] {
  return definitions;
}

export function getBrowserToolDefinition(id: string): BrowserToolDefinition {
  const definition = definitions.find((tool) => tool.id === id);
  if (!definition) throw new Error(`Unknown browser tool: ${id}`);
  return definition;
}
