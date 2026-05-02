import type {
  DebuggerAction,
  DebuggerActionResult,
  DebuggerSnapshot,
  ArticleParagraph,
  FormFillField,
  PageScriptResult,
  PageTextReplacement
} from "../shared/types";

export type DebuggerTarget = { tabId: number } | { targetId: string };

type ChromeDebuggerLike = {
  debugger?: {
    attach(target: DebuggerTarget, requiredVersion: string, callback?: () => void): void;
    detach(target: DebuggerTarget, callback?: () => void): void;
    sendCommand(
      target: DebuggerTarget,
      method: string,
      commandParams?: Record<string, unknown>,
      callback?: (result?: unknown) => void
    ): void;
  };
  runtime?: {
    lastError?: {
      message?: string;
    };
  };
};

type RuntimeEvaluateResult = {
  result?: {
    value?: unknown;
  };
};

type Point = {
  x: number;
  y: number;
};

type LayoutMetricsResult = {
  cssContentSize?: {
    width?: number;
    height?: number;
  };
};

type ScreenshotResult = {
  data?: string;
};

type ScreenshotParams = {
  format: "png";
  captureBeyondViewport: boolean;
  fromSurface: boolean;
  clip: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  };
};

const DEBUGGER_PROTOCOL_VERSION = "1.3";

function getChromeApi(api?: ChromeDebuggerLike): ChromeDebuggerLike {
  const resolved = api ?? (globalThis.chrome as ChromeDebuggerLike | undefined);
  if (!resolved?.debugger) {
    throw new Error("Chrome Debugger API is unavailable in this environment.");
  }
  return resolved;
}

function chromeError(api: ChromeDebuggerLike): Error | undefined {
  const message = api.runtime?.lastError?.message;
  return message ? new Error(message) : undefined;
}

function callbackCommand<T>(api: ChromeDebuggerLike, call: (callback: (result?: unknown) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    call((result) => {
      const error = chromeError(api);
      if (error) {
        reject(error);
        return;
      }
      resolve(result as T);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DebuggerToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebuggerToolError";
  }
}

export class DebuggerTools {
  private readonly target: DebuggerTarget;
  private readonly api: ChromeDebuggerLike;
  private readonly targetLabel?: string;
  private readonly rewriteCounts = new Map<string, number>();

  constructor(target: number | DebuggerTarget, api?: ChromeDebuggerLike, targetUrl?: string, targetLabel?: string) {
    const normalizedTarget = typeof target === "number" ? { tabId: target } : target;
    if ("tabId" in normalizedTarget && (!Number.isInteger(normalizedTarget.tabId) || normalizedTarget.tabId <= 0)) {
      throw new DebuggerToolError("Debugger tools require an active tab id.");
    }
    if ("targetId" in normalizedTarget && !normalizedTarget.targetId) {
      throw new DebuggerToolError("Debugger tools require a page target id.");
    }
    if (targetUrl && !/^https?:\/\//.test(targetUrl)) {
      throw new DebuggerToolError(`Debugger target is not a regular webpage: ${targetUrl}`);
    }
    this.target = normalizedTarget;
    this.api = getChromeApi(api);
    this.targetLabel = targetLabel ?? targetUrl;
  }

  async attach(): Promise<DebuggerActionResult> {
    try {
      await callbackCommand<void>(this.api, (callback) => {
        this.api.debugger?.attach(this.target, DEBUGGER_PROTOCOL_VERSION, () => callback());
      });
      return { ok: true, message: "Debugger attached to active tab." };
    } catch (error) {
      const detail = this.targetDescription();
      throw new DebuggerToolError(`Could not attach debugger to ${detail}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async detach(): Promise<DebuggerActionResult> {
    try {
      await callbackCommand<void>(this.api, (callback) => {
        this.api.debugger?.detach(this.target, () => callback());
      });
      return { ok: true, message: "Debugger detached from active tab." };
    } catch (error) {
      throw new DebuggerToolError(`Could not detach debugger from active tab: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async sendCommand<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      return await callbackCommand<T>(this.api, (callback) => {
        this.api.debugger?.sendCommand(this.target, method, params, callback);
      });
    } catch (error) {
      throw new DebuggerToolError(`Debugger command ${method} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async snapshot(): Promise<DebuggerActionResult> {
    await this.sendCommand("DOM.enable");
    await this.sendCommand("Runtime.enable");

    const document = await this.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const page = await this.evaluate<DebuggerSnapshot>(`
      (() => {
        const root = document;
        const textOf = (element) => (element.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").trim();
        const selectorFor = (element, index) => {
          if (element.id) return "#" + CSS.escape(element.id);
          const attr = element.getAttribute("name") || element.getAttribute("aria-label");
          if (attr) return element.tagName.toLowerCase() + "[" + (element.getAttribute("name") ? "name" : "aria-label") + "=\\"" + CSS.escape(attr) + "\\"]";
          return "[data-agenticify-debugger-index=\\"" + index + "\\"]";
        };
        const interactiveNodes = Array.from(root.querySelectorAll("button, a, input, textarea, select, [role='button']"));
        const interactiveElements = interactiveNodes.slice(0, 80).map((element, index) => {
          element.setAttribute("data-agenticify-debugger-index", String(index));
          const rect = element.getBoundingClientRect();
          return {
            selector: selectorFor(element, index),
            tagName: element.tagName.toLowerCase(),
            label: textOf(element) || element.getAttribute("value") || element.tagName.toLowerCase(),
            role: element.getAttribute("role") || undefined,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
          };
        });
        return {
          source: "debugger",
          title: document.title,
          url: location.href,
          origin: location.origin,
          text: ((document.body && document.body.innerText) || (document.body && document.body.textContent) || "").replace(/\\s+/g, " ").trim().slice(0, 12000),
          selectedText: String(getSelection && getSelection() || "").trim() || undefined,
          headings: Array.from(root.querySelectorAll("h1, h2, h3")).map(textOf).filter(Boolean).slice(0, 30),
          links: Array.from(root.querySelectorAll("a[href]")).map((link) => ({ text: textOf(link), href: link.href })).filter((link) => link.text).slice(0, 50),
          interactiveElements
        };
      })()
    `);

    let accessibilityTree: unknown[] | undefined;
    try {
      const accessibility = await this.sendCommand<{ nodes?: unknown[] }>("Accessibility.getFullAXTree");
      accessibilityTree = accessibility.nodes;
    } catch {
      accessibilityTree = undefined;
    }

    return {
      ok: true,
      message: "Captured debugger page snapshot.",
      observation: { ...page, document, accessibilityTree }
    };
  }

  async captureFullPageScreenshot(title = "page"): Promise<DebuggerActionResult> {
    await this.sendCommand("Page.enable");
    await this.prepareFullPageScreenshot();
    const metrics = await this.sendCommand<LayoutMetricsResult>("Page.getLayoutMetrics");
    const width = Math.ceil(metrics.cssContentSize?.width ?? 0) || 1;
    const height = Math.ceil(metrics.cssContentSize?.height ?? 0) || 1;
    const screenshotParams: ScreenshotParams = {
      format: "png",
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    };
    await this.sendCommand<ScreenshotResult>("Page.captureScreenshot", screenshotParams);
    await sleep(250);
    const captured = await this.sendCommand<ScreenshotResult>("Page.captureScreenshot", screenshotParams);
    const data = captured.data ?? "";

    return {
      ok: true,
      message: "Captured full-page screenshot.",
      screenshot: {
        dataUrl: data.startsWith("data:") ? data : `data:image/png;base64,${data}`,
        mimeType: "image/png",
        width,
        height,
        filename: `${this.slugify(title)}-screenshot.png`
      }
    };
  }

  async collectTextNodes(limit = 120): Promise<Array<{ index: number; text: string }>> {
    return this.evaluate<Array<{ index: number; text: string }>>(`
      (() => {
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        let index = 0;
        while ((node = walker.nextNode()) && nodes.length < ${JSON.stringify(Math.max(1, Math.min(limit, 300)))}) {
          const text = (node.nodeValue || "").replace(/\\s+/g, " ").trim();
          const parent = node.parentElement;
          const tag = parent && parent.tagName ? parent.tagName.toLowerCase() : "";
          if (text.length >= 2 && !["script", "style", "noscript", "template"].includes(tag)) {
            nodes.push({ index, text });
          }
          index += 1;
        }
        return nodes;
      })()
    `);
  }

  async collectArticleParagraphs(limit = 80): Promise<ArticleParagraph[]> {
    return this.evaluate<ArticleParagraph[]>(`
      (() => {
        const root = document.querySelector('article,main,[role="main"]') || document.body || document.documentElement;
        const language = navigator.language || document.documentElement.lang || '';
        const nodes = Array.from(root.querySelectorAll('p,li,blockquote')).filter((element) => {
          const text = (element.textContent || '').replace(/\\s+/g, ' ').trim();
          const rect = element.getBoundingClientRect();
          return text.length >= 40 && rect.width > 120 && rect.height > 8;
        }).slice(0, ${JSON.stringify(Math.max(1, Math.min(limit, 160)))});
        return nodes.map((element, index) => {
          const agenticifyParagraphIndex = String(index);
          element.setAttribute('data-agenticify-paragraph-index', agenticifyParagraphIndex);
          return { index, text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1800), language };
        });
      })()
    `);
  }

  async rewriteTextNodes(sessionId: string, replacements: PageTextReplacement[]): Promise<DebuggerActionResult> {
    const safeReplacements = replacements.filter((replacement) => replacement.replacement !== replacement.original);
    await this.evaluate(`
      (() => {
        const sessionId = ${JSON.stringify(sessionId)};
        const replacements = ${JSON.stringify(safeReplacements)};
        window.__agenticifyRewriteSessions = window.__agenticifyRewriteSessions || {};
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);
        const originals = [];
        for (const item of replacements) {
          const target = textNodes[item.index];
          if (!target || (target.nodeValue || "").replace(/\\s+/g, " ").trim() !== item.original) continue;
          originals.push({ index: item.index, original: target.nodeValue });
          target.nodeValue = String(item.replacement);
        }
        window.__agenticifyRewriteSessions[sessionId] = originals;
        return { changed: originals.length };
      })()
    `);
    this.rewriteCounts.set(sessionId, safeReplacements.length);
    return {
      ok: true,
      message: `Rewrote ${safeReplacements.length} text nodes.`,
      rewrite: { sessionId, changed: safeReplacements.length, replacements: safeReplacements }
    };
  }

  async restoreRewriteSession(sessionId: string): Promise<DebuggerActionResult> {
    const fallback = this.rewriteCounts.get(sessionId) ?? 0;
    const result = await this.evaluate<{ restored?: number }>(`
      (() => {
        const sessionId = ${JSON.stringify(sessionId)};
        const sessions = window.__agenticifyRewriteSessions || {};
        const originals = sessions[sessionId] || [];
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);
        for (const item of originals) {
          if (textNodes[item.index]) textNodes[item.index].nodeValue = item.original;
        }
        delete sessions[sessionId];
        return { restored: originals.length };
      })()
    `);
    const restored = typeof result?.restored === "number" ? result.restored : fallback;
    this.rewriteCounts.delete(sessionId);
    return { ok: true, message: `Restored ${restored} text nodes.` };
  }

  async fillFormFields(fields: FormFillField[]): Promise<DebuggerActionResult> {
    const result = await this.evaluate<{ filled?: number; skipped?: Array<{ selector: string; reason: string }> }>(`
      (() => {
        const fields = ${JSON.stringify(fields)};
        const skipped = [];
        let filled = 0;
        for (const field of fields) {
          const element = document.querySelector(field.selector);
          if (!element) {
            skipped.push({ selector: field.selector, reason: "not_found" });
            continue;
          }
          const tag = element.tagName.toLowerCase();
          const type = String(element.getAttribute("type") || "").toLowerCase();
          if (["button", "submit", "reset", "file", "password"].includes(type) || tag === "button") {
            skipped.push({ selector: field.selector, reason: "unsafe_field" });
            continue;
          }
          if (tag === "select") {
            element.value = String(field.value);
          } else if ("value" in element) {
            element.value = String(field.value);
          } else {
            skipped.push({ selector: field.selector, reason: "not_fillable" });
            continue;
          }
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          filled += 1;
        }
        return { filled, skipped };
      })()
    `);
    return {
      ok: true,
      message: `Filled ${typeof result?.filled === "number" ? result.filled : fields.length} form fields.`,
      formFill: {
        filled: typeof result?.filled === "number" ? result.filled : fields.length,
        skipped: Array.isArray(result?.skipped) ? result.skipped : []
      }
    };
  }

  async runPageScript(script: { language: "js" | "css"; code: string; scriptId?: string; data?: unknown }): Promise<DebuggerActionResult> {
    const scriptId = script.scriptId || `${script.language}-script`;
    if (script.language === "css") {
      const result = await this.evaluate<PageScriptResult>(`
        (() => {
          const scriptId = ${JSON.stringify(scriptId)};
          const code = ${JSON.stringify(script.code)};
          const id = "agenticify-skill-script-" + scriptId.replace(/[^a-z0-9_-]+/gi, "-");
          let style = document.getElementById(id);
          if (!style) {
            style = document.createElement("style");
            style.id = id;
            style.setAttribute("data-agenticify-skill-script", scriptId);
            document.documentElement.appendChild(style);
          }
          style.textContent = code;
          return { language: "css", scriptId, changed: 1 };
        })()
      `);
      return {
        ok: true,
        message: "Injected CSS script.",
        script: result && result.language === "css" ? result : { language: "css", scriptId, changed: 1 }
      };
    }

    const result = await this.evaluate<unknown>(`
      (() => {
        "use strict";
        const scriptId = ${JSON.stringify(scriptId)};
        const data = ${JSON.stringify(script.data ?? {})};
        const run = new Function("data", ${JSON.stringify(script.code)});
        void scriptId;
        const value = run(data);
        return { language: "js", scriptId, details: value, changed: value && typeof value.changed === "number" ? value.changed : undefined };
      })()
    `);
    const scriptResult = result as PageScriptResult | undefined;
    return {
      ok: true,
      message: "Ran JS script.",
      script: scriptResult && scriptResult.language === "js" ? scriptResult : { language: "js", scriptId, details: result }
    };
  }

  async click(action: Extract<DebuggerAction, { type: "click" }>): Promise<DebuggerActionResult> {
    const point = "selector" in action ? await this.pointForSelector(action.selector) : { x: action.x, y: action.y };
    await this.dispatchMouseClick(point);
    return { ok: true, message: "Clicked active tab with debugger input." };
  }

  async typeText(text: string, selector?: string): Promise<DebuggerActionResult> {
    if (selector) {
      await this.click({ type: "click", selector });
    }
    await this.sendCommand("Input.insertText", { text });
    return { ok: true, message: selector ? `Typed text into ${selector}.` : "Typed text into focused element." };
  }

  async scroll(direction: "up" | "down", amount = 800): Promise<DebuggerActionResult> {
    const top = direction === "down" ? amount : -amount;
    await this.evaluate(`window.scrollBy({ top: ${JSON.stringify(top)}, behavior: "smooth" })`);
    return { ok: true, message: `Scrolled ${direction} with debugger.` };
  }

  async wait(ms = 500): Promise<DebuggerActionResult> {
    await sleep(Math.max(0, Math.min(ms, 30000)));
    return { ok: true, message: `Waited ${Math.max(0, Math.min(ms, 30000))}ms.` };
  }

  async run(action: DebuggerAction): Promise<DebuggerActionResult> {
    if (action.type === "attach") return this.attach();
    if (action.type === "detach") return this.detach();
    if (action.type === "snapshot") return this.snapshot();
    if (action.type === "screenshot") return this.captureFullPageScreenshot();
    if (action.type === "click") return this.click(action);
    if (action.type === "type") return this.typeText(action.text, action.selector);
    if (action.type === "scroll") return this.scroll(action.direction, action.amount);
    return this.wait(action.ms);
  }

  private async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.sendCommand<RuntimeEvaluateResult>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result?.value as T;
  }

  private async prepareFullPageScreenshot(): Promise<void> {
    await this.evaluate(`
      (() => {
        const __agenticifyPrepareScreenshot = async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const root = document.scrollingElement || document.documentElement || document.body;
          const startX = window.scrollX;
          const startY = window.scrollY;
          const pageHeight = () => Math.max(
            root.scrollHeight || 0,
            document.documentElement.scrollHeight || 0,
            document.body ? document.body.scrollHeight : 0
          );
          for (const image of Array.from(document.images || [])) {
            image.loading = "eager";
            image.fetchPriority = "high";
          }
          for (let pass = 0; pass < 2; pass += 1) {
            const viewport = Math.max(window.innerHeight || 0, 600);
            const height = pageHeight();
            const step = Math.max(300, Math.floor(viewport * 0.7));
            for (let y = 0; y < height; y += step) {
              window.scrollTo(0, y);
              await nextFrame();
              await sleep(120);
            }
          }
          const viewport = Math.max(window.innerHeight || 0, 600);
          window.scrollTo(0, Math.max(0, pageHeight() - viewport));
          await nextFrame();
          await sleep(120);
          const images = Array.from(document.images || []);
          await Promise.all(images.slice(0, 120).map((image) => {
            if (image.complete) return Promise.resolve();
            if (typeof image.decode === "function") {
              return image.decode().catch(() => undefined);
            }
            return new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
              setTimeout(resolve, 1500);
            });
          }));
          if (document.fonts && document.fonts.ready) {
            await Promise.race([document.fonts.ready.catch(() => undefined), sleep(1500)]);
          }
          window.scrollTo(startX, startY);
          await nextFrame();
          await sleep(120);
          return true;
        };
        return __agenticifyPrepareScreenshot();
      })()
    `);
  }

  private async pointForSelector(selector: string): Promise<Point> {
    const point = await this.evaluate<Point | undefined>(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()
    `);
    if (!point) throw new DebuggerToolError(`No element found for ${selector}`);
    return point;
  }

  private async dispatchMouseClick(point: Point): Promise<void> {
    const params = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    await this.sendCommand("Input.dispatchMouseEvent", { ...params, type: "mousePressed" });
    await this.sendCommand("Input.dispatchMouseEvent", { ...params, type: "mouseReleased" });
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";
  }

  private targetDescription(): string {
    const target = "tabId" in this.target ? `tab ${this.target.tabId}` : `target ${this.target.targetId}`;
    return this.targetLabel ? `${target} (${this.targetLabel})` : target;
  }
}

export function createDebuggerTools(target: number | DebuggerTarget, api?: ChromeDebuggerLike, targetUrl?: string, targetLabel?: string): DebuggerTools {
  return new DebuggerTools(target, api, targetUrl, targetLabel);
}
