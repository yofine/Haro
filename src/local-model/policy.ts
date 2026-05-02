import type { ChatMessage, LocalModelPrivacySettings, ModelGateway, ModelResponse, ProviderSettings } from "../shared/types";
import { applyPrivacyPolicy, type PrivacyScanResult } from "./privacy";

export class PrivacyBlockedError extends Error {
  scan: PrivacyScanResult;

  constructor(scan: PrivacyScanResult) {
    super("External model call blocked by local privacy policy.");
    this.name = "PrivacyBlockedError";
    this.scan = scan;
  }
}

export type GuardedModelGatewayInput = {
  external: ModelGateway;
  provider: ProviderSettings;
  privacy: LocalModelPrivacySettings;
};

function guardMessages(messages: ChatMessage[], privacy: LocalModelPrivacySettings): ChatMessage[] {
  return messages.map((message) => {
    const applied = applyPrivacyPolicy(message.content, { mode: privacy.mode });
    if (applied.action === "block") throw new PrivacyBlockedError(applied.scan);
    if (applied.action === "ask") throw new PrivacyBlockedError(applied.scan);
    return { ...message, content: applied.text };
  });
}

export function createGuardedModelGateway({ external, provider, privacy }: GuardedModelGatewayInput): ModelGateway {
  return {
    async chat(messages: ChatMessage[]): Promise<ModelResponse> {
      const guardedMessages = guardMessages(messages, privacy);
      const response = await external.chat(guardedMessages);
      return {
        ...response,
        model: response.model || provider.defaultModel
      };
    }
  };
}
