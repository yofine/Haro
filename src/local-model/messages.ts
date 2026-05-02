import type { ChatMessage, LocalModelProfile } from "../shared/types";

export type LocalModelProgress = {
  text?: string;
  progress?: number;
  timeElapsed?: number;
};

export type LocalModelHostStatus = {
  loaded: boolean;
  loading: boolean;
  profileId?: string;
  modelId?: string;
  progress?: LocalModelProgress;
  error?: string;
};

export type LocalModelHostRequest =
  | { target: "haro-local-model-host"; type: "local-model:status" }
  | { target: "haro-local-model-host"; type: "local-model:load"; profile: LocalModelProfile }
  | { target: "haro-local-model-host"; type: "local-model:classify"; messages: ChatMessage[]; maxTokens?: number; temperature?: number };

export type LocalModelHostResponse =
  | { ok: true; status: LocalModelHostStatus; text?: string; raw?: unknown }
  | { ok: false; status: LocalModelHostStatus; error: string };
