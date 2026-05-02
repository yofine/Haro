import { describe, expect, it } from "vitest";
import { applyPrivacyPolicy, redactText, scanSensitiveText } from "./privacy";

describe("local privacy guard", () => {
  it("detects common sensitive spans with rules", () => {
    const result = scanSensitiveText("Email ada@example.com with Bearer sk-live-token-1234567890 and call +1 415 555 0100.");

    expect(result.hasSensitiveData).toBe(true);
    expect(result.maxRisk).toBe("high");
    expect(result.spans.map((span) => span.label)).toEqual(expect.arrayContaining(["email", "token", "phone"]));
  });

  it("redacts sensitive text without leaking original values", () => {
    const text = "Send to ada@example.com using token sk-secret-123456789.";
    const scan = scanSensitiveText(text);
    const redacted = redactText(text, scan.spans);

    expect(redacted).toContain("[email:redacted]");
    expect(redacted).toContain("[token:redacted]");
    expect(redacted).not.toContain("ada@example.com");
    expect(redacted).not.toContain("sk-secret");
  });

  it("applies redact and block privacy modes", () => {
    const text = "Token Bearer sk-secret-token-abcdef1234567890 should not leave the browser.";

    expect(applyPrivacyPolicy(text, { mode: "redact" }).action).toBe("redact");
    expect(applyPrivacyPolicy(text, { mode: "redact" }).text).toContain("[token:redacted]");
    expect(applyPrivacyPolicy(text, { mode: "block" }).action).toBe("block");
  });
});
