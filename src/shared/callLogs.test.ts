import { describe, expect, it } from "vitest";
import { appendCallLog, createCallLog } from "./callLogs";

describe("call logs", () => {
  it("creates lightweight call records without raw prompt content", () => {
    const log = createCallLog({
      source: "gateway",
      origin: "https://app.example.com",
      type: "run",
      model: "claude-3-5-sonnet-latest",
      status: "success",
      createdAt: "2026-04-25T00:00:00.000Z",
      prompt: "Sensitive private prompt"
    });

    expect(log).toMatchObject({
      source: "gateway",
      origin: "https://app.example.com",
      type: "run",
      model: "claude-3-5-sonnet-latest",
      status: "success",
      createdAt: "2026-04-25T00:00:00.000Z"
    });
    expect(JSON.stringify(log)).not.toContain("Sensitive private prompt");
  });

  it("keeps the newest bounded log entries first", () => {
    const logs = appendCallLog(
      [
        createCallLog({ source: "sidebar", type: "chat", status: "success", createdAt: "2026-04-25T00:00:00.000Z" }),
        createCallLog({ source: "sidebar", type: "chat", status: "failed", createdAt: "2026-04-25T00:01:00.000Z" })
      ],
      createCallLog({ source: "gateway", origin: "https://app.example.com", type: "run", status: "denied", createdAt: "2026-04-25T00:02:00.000Z" }),
      2
    );

    expect(logs).toHaveLength(2);
    expect(logs[0].createdAt).toBe("2026-04-25T00:02:00.000Z");
    expect(logs[1].createdAt).toBe("2026-04-25T00:01:00.000Z");
  });

  it("records access denials and revocations as audit events", () => {
    const denied = createCallLog({
      source: "gateway",
      origin: "https://app.example.com",
      type: "access",
      status: "denied",
      createdAt: "2026-04-25T00:03:00.000Z",
      summary: "Site Access denied"
    });
    const revoked = createCallLog({
      source: "gateway",
      origin: "https://app.example.com",
      type: "access",
      status: "revoked",
      createdAt: "2026-04-25T00:04:00.000Z",
      summary: "Site Access revoked"
    });

    expect(denied).toMatchObject({ type: "access", status: "denied" });
    expect(revoked).toMatchObject({ type: "access", status: "revoked" });
  });
});
