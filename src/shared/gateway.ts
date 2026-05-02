import { canUseScopes } from "./permissions";
import { getActiveProvider } from "./storage";
import type {
  BrowserAgentResponse,
  ExtensionSettings,
  AgentControlMode,
  GatewayErrorCode,
  Scope,
  SitePermission
} from "./types";

export const GATEWAY_PROTOCOL_VERSION = "1";

const validScopes: Scope[] = ["model.chat", "page.read", "page.act", "agent.run", "debugger.control"];
const baseRunScopes: Scope[] = ["model.chat", "page.read", "page.act", "agent.run"];

export class GatewayProtocolError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "GatewayProtocolError";
  }
}

export function createGatewaySuccess(requestId: string, result: unknown): BrowserAgentResponse {
  return {
    id: requestId,
    requestId,
    source: "agenticify-extension",
    ok: true,
    result
  };
}

export function createGatewayError(
  requestId: string,
  code: GatewayErrorCode,
  message: string,
  details?: unknown
): BrowserAgentResponse {
  return {
    id: requestId,
    requestId,
    source: "agenticify-extension",
    ok: false,
    code,
    error: details === undefined ? { code, message } : { code, message, details }
  };
}

export function normalizeGatewayError(error: unknown): { code: GatewayErrorCode; message: string; details?: unknown } {
  if (error instanceof GatewayProtocolError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof Error) {
    if (/configure an enabled openai or anthropic provider|api key is missing|provider is disabled/i.test(error.message)) {
      return { code: "model_not_configured", message: "No enabled model provider is configured." };
    }
    if (/no active tab|regular http\/https webpages|could not observe active page/i.test(error.message)) {
      return { code: "page_unavailable", message: "The current page is not available to BrowserAgent." };
    }
    if (/debugger mode requires explicit|debugger command|could not attach debugger|could not detach debugger|chrome debugger api is unavailable/i.test(error.message)) {
      return { code: "debugger_control_unavailable", message: error.message };
    }
    if (/privacy policy|privacy blocked|blocked by local privacy/i.test(error.message)) {
      return { code: "privacy_blocked", message: "External model call was blocked by the local privacy policy." };
    }
    return { code: "internal_error", message: error.message };
  }

  return { code: "internal_error", message: "Unknown gateway error" };
}

export function normalizeRequestedScopes(scopes: unknown): Scope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new GatewayProtocolError("invalid_request", "At least one scope is required.");
  }

  const normalized = scopes.map((scope) => {
    if (typeof scope !== "string" || !validScopes.includes(scope as Scope)) {
      throw new GatewayProtocolError("invalid_request", "Requested scopes include an unknown scope.", { scope });
    }
    return scope as Scope;
  });

  return [...new Set(normalized)];
}

export function requiredRunScopes(mode?: AgentControlMode): Scope[] {
  return mode === "debugger" ? [...baseRunScopes, "debugger.control"] : [...baseRunScopes];
}

export function debuggerAccessScopes(): Scope[] {
  return [...baseRunScopes, "debugger.control"];
}

export function resolveApprovedScopes(scopes: readonly Scope[], allowDebuggerControl: boolean): Scope[] {
  return scopes.filter((scope) => scope !== "debugger.control" || allowDebuggerControl);
}

export function getGrantedScopes(permissions: SitePermission[], origin: string): Scope[] {
  return permissions.find((entry) => entry.origin === origin && !entry.revokedAt)?.scopes ?? [];
}

export function ensureGatewayAccess(
  settings: ExtensionSettings,
  origin: string | undefined,
  scopes: Scope[],
  requireAutoRun: boolean
): void {
  if (!origin) throw new GatewayProtocolError("invalid_request", "Missing request origin.");
  if (!settings.gateway.enabled) {
    throw new GatewayProtocolError("gateway_disabled", "BrowserAgent Gateway is turned off.");
  }
  if (!canUseScopes(settings.permissions, origin, scopes, requireAutoRun)) {
    throw new GatewayProtocolError(
      "permission_denied",
      `Site Access does not include ${scopes.join(", ")}${requireAutoRun ? " with auto-run" : ""}.`,
      { origin, scopes, requireAutoRun }
    );
  }
}

export function buildGatewayStatus(settings: ExtensionSettings, origin: string | undefined) {
  const provider = getActiveProvider(settings);
  return {
    version: GATEWAY_PROTOCOL_VERSION,
    enabled: settings.gateway.enabled,
    origin,
    grantedScopes: origin ? getGrantedScopes(settings.permissions, origin) : [],
    autoRun: origin ? Boolean(settings.permissions.find((entry) => entry.origin === origin && !entry.revokedAt)?.autoRun) : false,
    modelConfigured: Boolean(provider),
    defaultModel: provider?.defaultModel
  };
}

export function listGatewayModels(settings: ExtensionSettings) {
  return settings.providers
    .filter((provider) => provider.enabled && provider.apiKey.trim())
    .map((provider) => ({
      provider: provider.provider,
      models: provider.models,
      defaultModel: provider.defaultModel
    }));
}
