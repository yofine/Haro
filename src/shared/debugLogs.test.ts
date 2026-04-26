import { describe, expect, it } from "vitest";
import { createDebugLog } from "./debugLogs";

describe("debug logs", () => {
  it("redacts secrets from debug details", () => {
    const log = createDebugLog("Provider test", {
      provider: {
        name: "Local",
        apiKey: "sk-secret"
      },
      headers: {
        Authorization: "Bearer sk-secret",
        "x-api-key": "sk-ant-secret"
      },
      nested: [{ token: "private-token", value: "safe" }]
    });

    expect(JSON.stringify(log.details)).not.toContain("sk-secret");
    expect(JSON.stringify(log.details)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(log.details)).not.toContain("private-token");
    expect(log.details).toMatchObject({
      provider: { apiKey: "[redacted]" },
      headers: {
        Authorization: "[redacted]",
        "x-api-key": "[redacted]"
      },
      nested: [{ token: "[redacted]", value: "safe" }]
    });
  });
});
