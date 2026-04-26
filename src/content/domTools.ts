import type { DomAction, DomActionResult, DomObservation, InteractiveElement } from "../shared/types";

function textOf(element: Element): string {
  return (element.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").trim();
}

function cssEscape(value: string): string {
  const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
  return css?.escape ? css.escape(value) : value.replace(/["\\#.[\]\s]/g, "\\$&");
}

function selectorFor(element: Element, index: number): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const attr = element.getAttribute("name") || element.getAttribute("aria-label");
  if (attr) return `${element.tagName.toLowerCase()}[${element.getAttribute("name") ? "name" : "aria-label"}="${cssEscape(attr)}"]`;
  return `[data-agenticify-index="${index}"]`;
}

export function observePage(): DomObservation {
  const interactiveNodes = Array.from(document.querySelectorAll("button, a, input, textarea, select, [role='button']"));
  const interactiveElements: InteractiveElement[] = interactiveNodes.slice(0, 80).map((element, index) => {
    element.setAttribute("data-agenticify-index", String(index));
    return {
      selector: selectorFor(element, index),
      tagName: element.tagName.toLowerCase(),
      label: textOf(element) || element.getAttribute("value") || element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined
    };
  });

  return {
    title: document.title,
    url: location.href,
    origin: location.origin,
    text: ((document.body as HTMLElement | null)?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12000),
    selectedText: String(getSelection?.() || "").trim() || undefined,
    headings: Array.from(document.querySelectorAll("h1, h2, h3")).map(textOf).filter(Boolean).slice(0, 30),
    links: Array.from(document.querySelectorAll("a[href]")).map((link) => ({
      text: textOf(link),
      href: (link as HTMLAnchorElement).href
    })).filter((link) => link.text).slice(0, 50),
    interactiveElements
  };
}

export function runDomAction(action: DomAction): DomActionResult {
  if (action.type === "scroll") {
    const amount = action.amount ?? Math.round(window.innerHeight * 0.8);
    window.scrollBy({ top: action.direction === "down" ? amount : -amount, behavior: "smooth" });
    return { ok: true, status: "success", message: `Scrolled ${action.direction}` };
  }

  const element = document.querySelector(action.selector);
  if (!element) {
    return { ok: false, status: "failed", message: `No element found for ${action.selector}` };
  }

  if (action.type === "click") {
    (element as HTMLElement).click();
    return { ok: true, status: "success", message: `Clicked ${action.selector}` };
  }

  if (action.type === "type") {
    if (!("value" in element)) return { ok: false, status: "failed", message: `Element cannot receive text: ${action.selector}` };
    (element as HTMLInputElement | HTMLTextAreaElement).value = action.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, status: "success", message: `Typed into ${action.selector}` };
  }

  return { ok: false, status: "failed", message: "Unsupported action" };
}
