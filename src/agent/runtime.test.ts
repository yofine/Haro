import { describe, expect, it, vi } from "vitest";
import type { DomObservation, ModelGateway } from "../shared/types";
import { classifyTaskIntent, runAgentTask, runMemoryChat, runPageChat } from "./runtime";

function observation(overrides: Partial<DomObservation> = {}): DomObservation {
  return {
    title: "Pricing",
    url: "https://example.com/pricing",
    origin: "https://example.com",
    text: "Starter is $9. Pro is $29.",
    headings: ["Pricing"],
    links: [],
    interactiveElements: [],
    ...overrides
  };
}

function gateway(...texts: string[]): ModelGateway {
  return {
    chat: vi.fn().mockImplementation(async () => ({
      text: texts.shift() ?? JSON.stringify({ final: "Done.", reason: "No more work.", confidence: 0.9 }),
      provider: "openai",
      model: "gpt-4.1-mini"
    }))
  };
}

describe("Agent runtime", () => {
  it("classifies simple questions as chat and operational requests as run", () => {
    expect(classifyTaskIntent("What is the price on this page?")).toBe("chat");
    expect(classifyTaskIntent("帮我总结一下这个页面")).toBe("chat");
    expect(classifyTaskIntent("记住数字1")).toBe("memory");
    expect(classifyTaskIntent("remember the number 1")).toBe("memory");
    expect(classifyTaskIntent("Click the buy button")).toBe("run");
    expect(classifyTaskIntent("Fill the form with Ada's profile")).toBe("run");
  });

  it("handles memory-only chat without page observation events", async () => {
    const modelGateway = gateway("我记住了数字 1。");

    const result = await runMemoryChat({
      task: "记住数字1",
      modelGateway,
      memory: {
        turns: [
          { role: "user", content: "之前的数字是 0" },
          { role: "assistant", content: "我记住了数字 0。" }
        ]
      }
    });

    expect(result.finalText).toBe("我记住了数字 1。");
    expect(result.events).toEqual([{ type: "final", text: "我记住了数字 1。" }]);
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.not.stringContaining("Page text:") })
    ]));
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining("Long-term memory") })
    ]));
  });

  it("answers simple page chat with page context and conversation memory", async () => {
    const modelGateway = gateway("Starter costs $9.");

    const result = await runPageChat({
      task: "What about the previous answer?",
      observation: observation(),
      modelGateway,
      memory: {
        memories: [{
          id: "m1",
          content: "User prefers concise answers.",
          scope: "global",
          layer: "profile",
          source: "manual",
          enabled: true,
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z"
        }],
        turns: [
          { role: "user", content: "How much is Starter?" },
          { role: "assistant", content: "Starter costs $9." }
        ]
      }
    });

    expect(result.finalText).toBe("Starter costs $9.");
    expect(result.events.map((event) => event.type)).toEqual(["observe", "final"]);
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining("Recent page conversation") })
    ]));
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining("User prefers concise answers.") })
    ]));
  });

  it("answers page questions with observed page context in one turn", async () => {
    const modelGateway = gateway(JSON.stringify({
      final: "Starter costs $9.",
      reason: "The page states the Starter price.",
      confidence: 0.95
    }));

    const result = await runAgentTask({
      task: "How much is Starter?",
      observe: async () => observation(),
      modelGateway,
      memory: {
        turns: [],
        memories: [{
          id: "m1",
          content: "Always answer in Chinese.",
          scope: "global",
          layer: "profile",
          source: "manual",
          enabled: true,
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z"
        }]
      },
      maxSteps: 3
    });

    expect(result.finalText).toBe("Starter costs $9.");
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining("Starter is $9") })
    ]));
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining("Always answer in Chinese.") })
    ]));
    expect(result.events.map((event) => event.type)).toEqual(["observe", "thought", "final"]);
  });

  it("extracts final answers when the model wraps decision JSON in markdown", async () => {
    const modelGateway = gateway([
      "```json",
      JSON.stringify({
        final: "Starter costs $9.",
        reason: "The page states the Starter price.",
        confidence: 0.95
      }),
      "```"
    ].join("\n"));

    const result = await runAgentTask({
      task: "How much is Starter?",
      observe: async () => observation(),
      modelGateway,
      maxSteps: 3
    });

    expect(result.finalText).toBe("Starter costs $9.");
    expect(result.events.at(-1)).toEqual({ type: "final", text: "Starter costs $9." });
  });

  it("extracts final answers when the model surrounds decision JSON with text", async () => {
    const modelGateway = gateway(`Here is the answer:\n${JSON.stringify({
      final: "Starter costs $9.",
      reason: "The page states the Starter price.",
      confidence: 0.95
    })}`);

    const result = await runAgentTask({
      task: "How much is Starter?",
      observe: async () => observation(),
      modelGateway,
      maxSteps: 3
    });

    expect(result.finalText).toBe("Starter costs $9.");
  });

  it("executes a DOM click when the model requests it", async () => {
    const act = vi.fn().mockResolvedValue({ ok: true, status: "success", message: "Clicked #details" });
    const modelGateway = gateway(
      JSON.stringify({
        action: { type: "click", selector: "#details" },
        reason: "Open the details panel.",
        confidence: 0.81
      }),
      JSON.stringify({
        final: "The details panel is open.",
        reason: "The requested click succeeded.",
        confidence: 0.88
      })
    );

    const result = await runAgentTask({
      task: "Open details",
      observe: vi.fn().mockResolvedValue(observation({
        interactiveElements: [{ selector: "#details", tagName: "button", label: "Details" }]
      })),
      act,
      modelGateway
    });

    expect(act).toHaveBeenCalledWith({ type: "click", selector: "#details" });
    expect(result.finalText).toBe("The details panel is open.");
    expect(result.events.map((event) => event.type)).toEqual([
      "observe",
      "thought",
      "action",
      "action-result",
      "observe",
      "thought",
      "final"
    ]);
  });

  it("injects matched skills into the model prompt and can execute skill actions", async () => {
    const act = vi.fn().mockResolvedValue({ ok: true, status: "success", message: "Skill builtin/page-report completed" });
    const modelGateway = gateway(
      JSON.stringify({
        action: { type: "skill", skillId: "builtin/page-report" },
        reason: "Use the built-in report skill.",
        confidence: 0.9
      }),
      JSON.stringify({
        final: "Report generated.",
        reason: "The skill completed.",
        confidence: 0.9
      })
    );

    const result = await runAgentTask({
      task: "Create an HTML report for this page",
      observe: async () => observation(),
      act,
      modelGateway,
      skills: [{
        id: "builtin/page-report",
        name: "page-report",
        description: "Create an HTML analysis report for the current page.",
        skillMarkdown: "---\nname: page-report\ndescription: Create an HTML analysis report for the current page.\n---\nUse the report tool.",
        enabled: true,
        source: "builtin"
      }]
    });

    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringContaining("Available installed skills") })
    ]));
    expect(act).toHaveBeenCalledWith({ type: "skill", skillId: "builtin/page-report" });
    expect(result.finalText).toBe("Report generated.");
  });

  it("injects explicitly selected skills even when the task text does not match them", async () => {
    const modelGateway = gateway(JSON.stringify({
      final: "Used selected skill guidance.",
      reason: "The user selected a skill.",
      confidence: 0.9
    }));

    await runAgentTask({
      task: "Do this for me",
      observe: async () => observation(),
      modelGateway,
      skillIds: ["manual/page-qa"],
      skills: [
        {
          id: "manual/page-qa",
          name: "page-qa",
          description: "Answer questions with a special page QA workflow.",
          skillMarkdown: "---\nname: page-qa\ndescription: Answer questions with a special page QA workflow.\n---\nUse the selected page QA workflow.",
          enabled: true,
          source: "manual"
        },
        {
          id: "manual/unselected",
          name: "unselected",
          description: "Do not include this skill.",
          skillMarkdown: "---\nname: unselected\ndescription: Do not include this skill.\n---\nUnselected guidance.",
          enabled: true,
          source: "manual"
        }
      ]
    });

    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Skill: manual/page-qa")
      })
    ]));
    expect(modelGateway.chat).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.not.stringContaining("Skill: manual/unselected")
      })
    ]));
  });

  it("honors maxSteps with a hard cap of five", async () => {
    const act = vi.fn().mockResolvedValue({ ok: true, status: "success", message: "Scrolled down" });
    const modelGateway = gateway(
      ...Array.from({ length: 8 }, () => JSON.stringify({
        action: { type: "scroll", direction: "down", amount: 120 },
        reason: "Need more page content.",
        confidence: 0.7
      }))
    );

    const result = await runAgentTask({
      task: "Keep reading",
      observe: async () => observation(),
      act,
      modelGateway,
      maxSteps: 99
    });

    expect(modelGateway.chat).toHaveBeenCalledTimes(5);
    expect(act).toHaveBeenCalledTimes(5);
    expect(result.finalText).toContain("Stopped after 5 steps");
    expect(result.events.at(-1)).toMatchObject({ type: "blocked" });
  });

  it("stops after an action failure with the failure reason", async () => {
    const modelGateway = gateway(JSON.stringify({
      action: { type: "click", selector: "#missing" },
      reason: "Try to open the missing element.",
      confidence: 0.6
    }));

    const result = await runAgentTask({
      task: "Open missing",
      observe: async () => observation(),
      act: vi.fn().mockResolvedValue({ ok: false, status: "failed", message: "No element found for #missing" }),
      modelGateway
    });

    expect(result.finalText).toBe("No element found for #missing");
    expect(result.events.map((event) => event.type)).toEqual(["observe", "thought", "action", "action-result", "blocked"]);
  });

  it("blocks high-risk actions before calling DOM tools", async () => {
    const act = vi.fn();
    const modelGateway = gateway(JSON.stringify({
      action: { type: "click", selector: "#buy" },
      reason: "Submit the purchase.",
      confidence: 0.76
    }));

    const result = await runAgentTask({
      task: "Buy this item",
      observe: async () => observation({
        interactiveElements: [{ selector: "#buy", tagName: "button", label: "Buy now" }]
      }),
      act,
      modelGateway
    });

    expect(act).not.toHaveBeenCalled();
    expect(result.finalText).toContain("needs confirmation");
    expect(result.events.at(-1)).toMatchObject({ type: "blocked", status: "needs_confirmation" });
  });
});
