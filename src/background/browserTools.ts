import type {
  BenchmarkToolRequest,
  BenchmarkToolResult,
  DebuggerActionResult,
  FormFillField,
  ModelGateway,
  PageTextReplacement
} from "../shared/types";

type BrowserToolDebugger = {
  snapshot(): Promise<DebuggerActionResult>;
  captureFullPageScreenshot(title?: string): Promise<DebuggerActionResult>;
  collectTextNodes(limit?: number): Promise<Array<{ index: number; text: string }>>;
  rewriteTextNodes(sessionId: string, replacements: PageTextReplacement[]): Promise<DebuggerActionResult>;
  restoreRewriteSession(sessionId: string): Promise<DebuggerActionResult>;
  fillFormFields(fields: FormFillField[]): Promise<DebuggerActionResult>;
};

type RunBenchmarkToolInput = {
  request: BenchmarkToolRequest;
  tools: BrowserToolDebugger;
  modelGateway: ModelGateway;
};

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createSessionId(): string {
  return `rewrite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isUnsafeField(field: FormFillField): boolean {
  return /\b(submit|button|reset|password|file|pay|purchase|delete|remove|send|checkout)\b/i.test(`${field.selector} ${field.value}`);
}

function parseReplacements(text: string, nodes: Array<{ index: number; text: string }>): PageTextReplacement[] {
  const parsed = extractJson(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.replacements)) return [];
  const originals = new Map(nodes.map((node) => [node.index, node.text]));

  return parsed.replacements.flatMap((item) => {
    if (!isRecord(item) || typeof item.index !== "number" || typeof item.replacement !== "string") return [];
    const original = originals.get(item.index);
    if (!original || original === item.replacement) return [];
    return [{ index: item.index, original, replacement: item.replacement }];
  });
}

function parseFields(text: string): FormFillField[] {
  const parsed = extractJson(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.fields)) return [];
  return parsed.fields.flatMap((item) => {
    if (!isRecord(item) || typeof item.selector !== "string" || typeof item.value !== "string") return [];
    const field = { selector: item.selector, value: item.value };
    return isUnsafeField(field) ? [] : [field];
  });
}

export function sanitizeReportHtml(html: string): string {
  const trimmed = html.trim();
  const fenced = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .trim();
}

export async function runBenchmarkTool({ request, tools, modelGateway }: RunBenchmarkToolInput): Promise<BenchmarkToolResult> {
  if (request.type === "restore-rewrite") {
    const restored = await tools.restoreRewriteSession(request.sessionId ?? "");
    const match = restored.message.match(/\d+/);
    return { type: "restore-rewrite", title: "Restore page rewrite", restored: match ? Number(match[0]) : 0 };
  }

  const snapshot = await tools.snapshot();
  const observation = snapshot.observation;
  if (!observation) throw new Error("Debugger snapshot did not return page data.");

  if (request.type === "screenshot") {
    const captured = await tools.captureFullPageScreenshot(observation.title || observation.origin);
    if (!captured.screenshot) throw new Error("Debugger screenshot did not return image data.");
    return { type: "screenshot", title: "Full-page screenshot", screenshot: captured.screenshot };
  }

  if (request.type === "report") {
    const response = await modelGateway.chat([
      { role: "system", content: "Create a concise HTML analysis report for display in a browser chat panel. Return HTML only. Do not include scripts or event handlers." },
      { role: "user", content: `Title: ${observation.title}\nURL: ${observation.url}\nHeadings: ${observation.headings.join(" | ")}\nText: ${observation.text}` }
    ]);
    return { type: "report", title: "Page analysis report", html: sanitizeReportHtml(response.text) };
  }

  if (request.type === "rewrite") {
    const nodes = await tools.collectTextNodes();
    const response = await modelGateway.chat([
      {
        role: "system",
        content: "Return strict JSON: {\"replacements\":[{\"index\":0,\"replacement\":\"new text\"}]}. Only rewrite visible text. Preserve meaning unless the user asks to translate or change tone."
      },
      { role: "user", content: `Instruction: ${request.instruction}\nText nodes: ${JSON.stringify(nodes)}` }
    ]);
    const replacements = parseReplacements(response.text, nodes);
    const result = await tools.rewriteTextNodes(createSessionId(), replacements);
    return { type: "rewrite", title: "Page rewrite", rewrite: result.rewrite ?? { sessionId: "", changed: 0, replacements } };
  }

  const response = await modelGateway.chat([
    {
      role: "system",
      content: "Return strict JSON: {\"fields\":[{\"selector\":\"#email\",\"value\":\"ada@example.com\"}]}. Fill fields only. Never submit, click buttons, pay, send, delete, or change passwords."
    },
    { role: "user", content: `Instruction: ${request.instruction}\nControls: ${JSON.stringify(observation.interactiveElements)}` }
  ]);
  const fields = parseFields(response.text);
  const result = await tools.fillFormFields(fields);
  return { type: "fill-form", title: "Form fill", formFill: result.formFill ?? { filled: 0, skipped: [] } };
}
