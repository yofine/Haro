import { beforeEach, describe, expect, it } from "vitest";
import { observePage, runDomAction } from "./domTools";

describe("DOM tools", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <h1>Pricing</h1>
        <p>Starter is $9 and Pro is $29.</p>
        <a href="/docs">Docs</a>
        <button id="buy">Buy</button>
        <input id="name" aria-label="Name" />
      </main>
    `;
    window.history.replaceState({}, "", "https://example.com/pricing");
  });

  it("observes page text and interactive elements", () => {
    const observation = observePage();

    expect(observation.title).toBe("");
    expect(observation.url).toBe("https://example.com/pricing");
    expect(observation.headings).toContain("Pricing");
    expect(observation.text).toContain("Starter is $9");
    expect(observation.interactiveElements.map((element) => element.label)).toContain("Buy");
    expect(observation.interactiveElements.map((element) => element.label)).toContain("Name");
  });

  it("types into inputs and clicks matching elements", () => {
    const inputResult = runDomAction({ type: "type", selector: "#name", value: "Ada" });
    const clickResult = runDomAction({ type: "click", selector: "#buy" });

    expect(inputResult.ok).toBe(true);
    expect((document.querySelector("#name") as HTMLInputElement).value).toBe("Ada");
    expect(clickResult.ok).toBe(true);
  });
});
