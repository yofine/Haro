import { describe, expect, it } from "vitest";
import { createMemory, extractExplicitMemoryContent, getRelevantMemories, normalizeMemories, parseAutoMemoryResponse } from "./memories";

describe("agent memories", () => {
  it("extracts explicit remember instructions into durable content", () => {
    expect(extractExplicitMemoryContent("记住数字1")).toBe("数字1");
    expect(extractExplicitMemoryContent("帮我记住：默认语言是中文")).toBe("默认语言是中文");
    expect(extractExplicitMemoryContent("remember that my invoice name is Ada")).toBe("my invoice name is Ada");
    expect(extractExplicitMemoryContent("What is on this page?")).toBeUndefined();
  });

  it("creates normalized explicit memories", () => {
    expect(createMemory({
      content: "数字1",
      scope: "site",
      layer: "site",
      origin: "https://example.com",
      now: "2026-04-27T00:00:00.000Z"
    })).toMatchObject({
      content: "数字1",
      scope: "site",
      origin: "https://example.com",
      source: "explicit",
      enabled: true,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z"
    });
  });

  it("normalizes stored memories and drops invalid entries", () => {
    expect(normalizeMemories([
      { id: "one", content: "Keep this", scope: "global", layer: "profile", enabled: true, source: "manual", createdAt: "x", updatedAt: "x" },
      { id: "bad", content: "", scope: "global" },
      { id: "two", content: "Site only", scope: "site", origin: "https://example.com" }
    ])).toEqual([
      expect.objectContaining({ id: "one", content: "Keep this", scope: "global", layer: "profile", enabled: true, source: "manual" }),
      expect.objectContaining({ id: "two", content: "Site only", scope: "site", layer: "site", origin: "https://example.com", enabled: true, source: "manual" })
    ]);
  });

  it("returns enabled global and matching site memories", () => {
    const memories = normalizeMemories([
      { id: "global", content: "Global", scope: "global" },
      { id: "site", content: "Site", scope: "site", origin: "https://example.com" },
      { id: "other", content: "Other", scope: "site", origin: "https://other.example" },
      { id: "off", content: "Off", scope: "global", enabled: false }
    ]);

    expect(getRelevantMemories(memories, "https://example.com").map((memory) => memory.id)).toEqual(["global", "site"]);
    expect(getRelevantMemories(memories).map((memory) => memory.id)).toEqual(["global"]);
  });

  it("parses conservative automatic memory extraction responses", () => {
    expect(parseAutoMemoryResponse(JSON.stringify([
      { content: "User prefers Chinese replies.", layer: "profile", scope: "global" },
      { content: "Example.com checkout requires a company name.", layer: "site", scope: "site" },
      { content: "", layer: "profile" }
    ]), "https://example.com")).toEqual([
      expect.objectContaining({ content: "User prefers Chinese replies.", layer: "profile", scope: "global", source: "auto" }),
      expect.objectContaining({ content: "Example.com checkout requires a company name.", layer: "site", scope: "site", origin: "https://example.com", source: "auto" })
    ]);
    expect(parseAutoMemoryResponse("not json")).toEqual([]);
  });
});
