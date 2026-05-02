import { describe, expect, it, vi } from "vitest";
import { createGuardedModelGateway, PrivacyBlockedError } from "./policy";
import type { LocalModelPrivacySettings, ModelGateway, ProviderSettings } from "../shared/types";

const provider: ProviderSettings = {
  id: "openai-main",
  name: "OpenAI",
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.openai.com/v1",
  models: ["gpt-test"],
  defaultModel: "gpt-test",
  enabled: true
};

const privacy: LocalModelPrivacySettings = {
  mode: "redact",
  scanPageText: true,
  scanSelectedText: true,
  scanFormValues: false,
  blockHighConfidenceSecrets: true
};

describe("guarded model gateway", () => {
  it("redacts sensitive message content before external model calls", async () => {
    const external: ModelGateway = {
      chat: vi.fn().mockResolvedValue({ provider: "openai", model: "gpt-test", text: "ok" })
    };
    const gateway = createGuardedModelGateway({ external, provider, privacy });

    await gateway.chat([{ role: "user", content: "Email ada@example.com about this page." }]);

    expect(external.chat).toHaveBeenCalledWith([
      { role: "user", content: "Email [email:redacted] about this page." }
    ]);
  });

  it("blocks high-confidence secrets when configured", async () => {
    const external: ModelGateway = {
      chat: vi.fn().mockResolvedValue({ provider: "openai", model: "gpt-test", text: "ok" })
    };
    const gateway = createGuardedModelGateway({
      external,
      provider,
      privacy: { ...privacy, mode: "block" }
    });

    await expect(gateway.chat([{ role: "user", content: "Use Bearer sk-secret-token-abcdef1234567890" }]))
      .rejects.toBeInstanceOf(PrivacyBlockedError);
    expect(external.chat).not.toHaveBeenCalled();
  });
});
