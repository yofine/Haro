import { describe, expect, it } from "vitest";
import { isBuiltInSkillId, memoryLayerLabel, memoryScopeLabel, memorySourceLabel, skillSourceLabel } from "./App";

describe("options skill helpers", () => {
  it("labels built-in and installed skill sources", () => {
    expect(isBuiltInSkillId("builtin/page-report")).toBe(true);
    expect(isBuiltInSkillId("page-translator")).toBe(false);
    expect(skillSourceLabel("builtin")).toBe("Built-in");
    expect(skillSourceLabel("skills.sh")).toBe("skills.sh");
    expect(skillSourceLabel("manual")).toBe("Manual");
  });
});

describe("options memory helpers", () => {
  it("labels memory scopes and sources", () => {
    expect(memoryScopeLabel("global")).toBe("Global");
    expect(memoryScopeLabel("site")).toBe("Site");
    expect(memoryLayerLabel("profile")).toBe("Profile layer");
    expect(memoryLayerLabel("site")).toBe("Site layer");
    expect(memoryLayerLabel("interaction")).toBe("Interaction layer");
    expect(memorySourceLabel("explicit")).toBe("Remembered");
    expect(memorySourceLabel("auto")).toBe("Auto");
    expect(memorySourceLabel("summary")).toBe("Summary");
    expect(memorySourceLabel("manual")).toBe("Manual");
  });
});
