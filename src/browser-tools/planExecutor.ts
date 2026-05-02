import type {
  BenchmarkToolResult,
  AgentEvent,
  ArticleParagraph,
  DebuggerActionResult,
  FormFillField,
  ModelGateway,
  PageScriptResult,
  PageTextReplacement
} from "../shared/types";
import { sanitizeReportHtml } from "./html";
import { getBrowserToolDefinition } from "./registry";
import { evaluateBrowserToolRisk } from "./risk";
import type { BrowserToolPlan } from "./types";

export type BrowserToolDebugger = {
  snapshot(): Promise<DebuggerActionResult>;
  captureFullPageScreenshot(title?: string): Promise<DebuggerActionResult>;
  collectTextNodes(limit?: number): Promise<Array<{ index: number; text: string }>>;
  collectArticleParagraphs(limit?: number): Promise<ArticleParagraph[]>;
  rewriteTextNodes(sessionId: string, replacements: PageTextReplacement[]): Promise<DebuggerActionResult>;
  restoreRewriteSession(sessionId: string): Promise<DebuggerActionResult>;
  fillFormFields(fields: FormFillField[]): Promise<DebuggerActionResult>;
  runPageScript(script: { language: "js" | "css"; code: string; scriptId?: string; data?: unknown }): Promise<DebuggerActionResult>;
};

type ExecuteBrowserToolPlanInput = {
  plan: BrowserToolPlan;
  tools: BrowserToolDebugger;
  modelGateway: ModelGateway;
  onEvent?: (event: AgentEvent) => void;
};

const modelBackedScriptGenerators = new Set([
  "paragraphTranslations",
  "paragraphNotes",
  "generateParagraphTranslations",
  "generateParagraphNotes"
]);

export class BrowserToolPlanBlockedError extends Error {
  status: "needs_confirmation" | "blocked";

  constructor(status: "needs_confirmation" | "blocked", message: string) {
    super(message);
    this.name = "BrowserToolPlanBlockedError";
    this.status = status;
  }
}

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

function instructionFrom(plan: BrowserToolPlan, operation: string): string {
  const call = plan.calls.find((entry) => entry.input.operation === operation);
  const instruction = call?.input.instruction;
  return typeof instruction === "string" ? instruction : "";
}

function parseGeneratedItems(text: string): { items: Array<{ index: number; text: string }> } {
  const parsed = extractJson(text);
  const rawItems = isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
  return {
    items: rawItems.flatMap((item) => {
      if (!isRecord(item) || typeof item.index !== "number" || typeof item.text !== "string" || !item.text.trim()) return [];
      return [{ index: item.index, text: item.text.trim() }];
    })
  };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), min), max);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function compactParagraphs(paragraphs: ArticleParagraph[]): ArticleParagraph[] {
  return paragraphs.map((paragraph) => ({
    index: paragraph.index,
    text: paragraph.text.length > 800 ? `${paragraph.text.slice(0, 800)}...` : paragraph.text,
    language: paragraph.language
  }));
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (
    (error as { code?: unknown }).code === "request_timeout"
    || (error as { code?: unknown }).code === "request_aborted"
  ));
}

function languageNameFromLocale(locale: string): string {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("zh")) return "Chinese";
  if (normalized.startsWith("ja")) return "Japanese";
  if (normalized.startsWith("ko")) return "Korean";
  if (normalized.startsWith("fr")) return "French";
  if (normalized.startsWith("de")) return "German";
  if (normalized.startsWith("es")) return "Spanish";
  if (normalized.startsWith("pt")) return "Portuguese";
  if (normalized.startsWith("it")) return "Italian";
  if (normalized.startsWith("ru")) return "Russian";
  if (normalized.startsWith("ar")) return "Arabic";
  return locale;
}

function resolveTargetLanguage(input: Record<string, unknown>, paragraphs: ArticleParagraph[]): { instruction: string; locale?: string } {
  if (typeof input.targetLanguage === "string" && input.targetLanguage.trim() && input.targetLanguage !== "system") {
    return { instruction: input.targetLanguage.trim() };
  }
  const locale = paragraphs.find((paragraph) => typeof paragraph.language === "string" && paragraph.language.trim())?.language?.trim();
  if (!locale) return { instruction: "the browser/system language" };
  return { instruction: `${languageNameFromLocale(locale)} (${locale}), the browser language`, locale };
}

async function generateScriptData(
  generate: unknown,
  input: Record<string, unknown>,
  tools: BrowserToolDebugger,
  modelGateway: ModelGateway
): Promise<unknown> {
  if (!modelBackedScriptGenerators.has(String(generate))) return undefined;
  const maxParagraphs = boundedNumber(input.maxParagraphs, 12, 4, 40);
  const batchSize = boundedNumber(input.batchSize, 3, 1, 6);
  const paragraphs = compactParagraphs(await tools.collectArticleParagraphs(maxParagraphs));
  const targetLanguage = resolveTargetLanguage(input, paragraphs);
  const isTranslation = generate === "paragraphTranslations" || generate === "generateParagraphTranslations";
  const systemPrompt = isTranslation
    ? `Translate each paragraph into ${targetLanguage.instruction}. Return strict JSON: {"items":[{"index":0,"text":"translation"}]}. Keep formatting plain and concise.`
    : `Write a concise explanatory note for each paragraph in ${targetLanguage.instruction}. Return strict JSON: {"items":[{"index":0,"text":"note"}]}. Mention chart/table implications when the paragraph refers to data or figures.`;
  const generatedItems: Array<{ index: number; text: string }> = [];
  const skipped: number[] = [];
  const generateBatch = async (batch: ArticleParagraph[]): Promise<void> => {
    if (!batch.length) return;
    try {
      const response = await modelGateway.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ paragraphs: batch }) }
      ]);
      generatedItems.push(...parseGeneratedItems(response.text).items);
      return;
    } catch (error) {
      if (!isTimeoutError(error)) throw error;
      if (batch.length === 1) {
        skipped.push(batch[0].index);
        return;
      }
    }
    for (const paragraph of batch) await generateBatch([paragraph]);
  };
  for (const batch of chunkItems(paragraphs, batchSize)) {
    await generateBatch(batch);
  }
  return {
    items: generatedItems,
    ...(targetLanguage.locale ? { locale: targetLanguage.locale } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(!isTranslation ? { label: targetLanguage.locale?.toLowerCase().startsWith("zh") ? "注释" : "Note" } : {})
  };
}

export function browserToolPlanNeedsModel(plan: BrowserToolPlan): boolean {
  return plan.calls.some((call) => (
    call.toolId === "artifacts.createHtmlReport"
    || (call.toolId === "page.write" && (call.input.operation === "rewriteTextNodes" || call.input.operation === "setFormValues"))
    || (call.toolId === "page.script" && modelBackedScriptGenerators.has(String(call.input.generate)))
  ));
}

function emitToolAction(onEvent: ExecuteBrowserToolPlanInput["onEvent"], toolId: string, input: Record<string, unknown>): void {
  onEvent?.({
    type: "action",
    action: { type: "tool", toolId, input },
    reason: `Run browser tool ${toolId}`
  });
}

function emitToolResult(onEvent: ExecuteBrowserToolPlanInput["onEvent"], toolId: string, input: Record<string, unknown>, message: string, ok = true): void {
  onEvent?.({
    type: "action-result",
    action: { type: "tool", toolId, input },
    result: { ok, status: ok ? "success" : "failed", message }
  });
}

function shouldStopForRisk(toolId: string, status: "needs_confirmation" | "blocked"): boolean {
  if (status === "blocked") return true;
  const definition = getBrowserToolDefinition(toolId);
  return definition.risk === "high" || definition.id === "page.act";
}

function assertPlanAllowed(plan: BrowserToolPlan, onEvent: ExecuteBrowserToolPlanInput["onEvent"]): void {
  for (const call of plan.calls) {
    const decision = evaluateBrowserToolRisk(getBrowserToolDefinition(call.toolId), call.input);
    if (decision.status === "success" || !shouldStopForRisk(call.toolId, decision.status)) continue;
    const reason = decision.reason ?? "Browser tool requires confirmation.";
    onEvent?.({ type: "blocked", status: decision.status, reason });
    throw new BrowserToolPlanBlockedError(decision.status, reason);
  }
}

export async function executeBrowserToolPlan({ plan, tools, modelGateway, onEvent }: ExecuteBrowserToolPlanInput): Promise<BenchmarkToolResult> {
  assertPlanAllowed(plan, onEvent);

  const restore = plan.calls.find((call) => call.toolId === "page.write" && call.input.operation === "restoreMutation");
  if (restore) {
    emitToolAction(onEvent, restore.toolId, restore.input);
    const sessionId = typeof restore.input.sessionId === "string" ? restore.input.sessionId : "";
    const restored = await tools.restoreRewriteSession(sessionId);
    emitToolResult(onEvent, restore.toolId, restore.input, restored.message, restored.ok);
    const match = restored.message.match(/\d+/);
    return { type: "restore-rewrite", title: "Restore page rewrite", restored: match ? Number(match[0]) : 0 };
  }

  const readCalls = plan.calls.filter((call) => call.toolId === "page.read");
  const capture = plan.calls.find((call) => call.toolId === "page.capture" && call.input.target === "fullPage");
  const report = plan.calls.find((call) => call.toolId === "artifacts.createHtmlReport");
  const rewrite = plan.calls.find((call) => call.toolId === "page.write" && call.input.operation === "rewriteTextNodes");
  const fill = plan.calls.find((call) => call.toolId === "page.write" && call.input.operation === "setFormValues");
  const scriptCalls = plan.calls.filter((call) => call.toolId === "page.script");
  const needsObservation = readCalls.length > 0 || Boolean(capture || report || rewrite || fill);
  const observation = needsObservation ? (await tools.snapshot()).observation : undefined;
  if (needsObservation && !observation) throw new Error("Debugger snapshot did not return page data.");
  if (observation) {
    readCalls.forEach((call) => emitToolAction(onEvent, call.toolId, call.input));
    readCalls.forEach((call) => emitToolResult(onEvent, call.toolId, call.input, `Read ${observation.title || observation.origin}`));
  }

  if (scriptCalls.length) {
    let scriptResult: PageScriptResult | undefined;
    for (const script of scriptCalls) {
      const language = script.input.language === "css" ? "css" : "js";
      const code = typeof script.input.code === "string" ? script.input.code : "";
      const scriptId = typeof script.input.scriptId === "string" ? script.input.scriptId : undefined;
      const data = await generateScriptData(script.input.generate, script.input, tools, modelGateway);
      emitToolAction(onEvent, script.toolId, script.input);
      const result = await tools.runPageScript({ language, code, scriptId, data });
      emitToolResult(onEvent, script.toolId, script.input, result.message, result.ok);
      scriptResult = result.script ?? { language, scriptId, changed: result.ok ? 1 : 0 };
    }
    return { type: "script", title: "Page script", script: scriptResult ?? { language: "js", changed: 0 } };
  }

  if (capture) {
    emitToolAction(onEvent, capture.toolId, capture.input);
    const captured = await tools.captureFullPageScreenshot(observation?.title || observation?.origin);
    if (!captured.screenshot) throw new Error("Debugger screenshot did not return image data.");
    emitToolResult(onEvent, capture.toolId, capture.input, captured.message, captured.ok);
    return { type: "screenshot", title: "Full-page screenshot", screenshot: captured.screenshot };
  }

  if (report) {
    emitToolAction(onEvent, report.toolId, report.input);
    const response = await modelGateway.chat([
      { role: "system", content: "Create a concise HTML analysis report for display in a browser chat panel. Return HTML only. Do not include scripts or event handlers." },
      { role: "user", content: `Title: ${observation?.title}\nURL: ${observation?.url}\nHeadings: ${observation?.headings.join(" | ")}\nText: ${observation?.text}` }
    ]);
    emitToolResult(onEvent, report.toolId, report.input, "Created sanitized HTML report");
    return { type: "report", title: "Page analysis report", html: sanitizeReportHtml(response.text) };
  }

  if (rewrite) {
    const nodes = await tools.collectTextNodes();
    const response = await modelGateway.chat([
      {
        role: "system",
        content: "Return strict JSON: {\"replacements\":[{\"index\":0,\"replacement\":\"new text\"}]}. Only rewrite visible text. Preserve meaning unless the user asks to translate or change tone."
      },
      { role: "user", content: `Instruction: ${instructionFrom(plan, "rewriteTextNodes")}\nText nodes: ${JSON.stringify(nodes)}` }
    ]);
    const replacements = parseReplacements(response.text, nodes);
    emitToolAction(onEvent, rewrite.toolId, rewrite.input);
    const result = await tools.rewriteTextNodes(createSessionId(), replacements);
    emitToolResult(onEvent, rewrite.toolId, rewrite.input, result.message, result.ok);
    return { type: "rewrite", title: "Page rewrite", rewrite: result.rewrite ?? { sessionId: "", changed: 0, replacements } };
  }

  const response = await modelGateway.chat([
    {
      role: "system",
      content: "Return strict JSON: {\"fields\":[{\"selector\":\"#email\",\"value\":\"ada@example.com\"}]}. Fill fields only. Never submit, click buttons, pay, send, delete, or change passwords."
    },
    { role: "user", content: `Instruction: ${instructionFrom(plan, "setFormValues")}\nControls: ${JSON.stringify(observation?.interactiveElements ?? [])}` }
  ]);
  const fields = parseFields(response.text);
  if (fill) emitToolAction(onEvent, fill.toolId, fill.input);
  const result = await tools.fillFormFields(fields);
  if (fill) emitToolResult(onEvent, fill.toolId, fill.input, result.message, result.ok);
  return { type: "fill-form", title: "Form fill", formFill: result.formFill ?? { filled: 0, skipped: [] } };
}
