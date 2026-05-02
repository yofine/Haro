import { describe, expect, it } from "vitest";
import {
  GatewayProtocolError,
  createGatewayError,
  createGatewaySuccess,
  ensureGatewayAccess,
  getGrantedScopes,
  debuggerAccessScopes,
  normalizeGatewayError,
  normalizeRequestedScopes,
  resolveApprovedScopes,
  requiredRunScopes
} from "./gateway";
import { defaultSettings } from "./storage";
import type { ExtensionSettings } from "./types";

const baseSettings: ExtensionSettings = {
  locale: "en",
  providers: [],
  gateway: { enabled: true },
  localModels: defaultSettings.localModels,
  skills: [],
  memories: [],
  permissions: [],
  callLogs: [],
  debugLogs: []
};

describe("gateway v1 protocol", () => {
  it("returns structured success and error envelopes with requestId", () => {
    expect(createGatewaySuccess("req-1", { granted: true })).toEqual({
      id: "req-1",
      requestId: "req-1",
      source: "agenticify-extension",
      ok: true,
      result: { granted: true }
    });

    expect(createGatewayError("req-2", "permission_denied", "Not allowed")).toEqual({
      id: "req-2",
      requestId: "req-2",
      source: "agenticify-extension",
      ok: false,
      code: "permission_denied",
      error: {
        code: "permission_denied",
        message: "Not allowed"
      }
    });
  });

  it("normalizes valid scopes including separately gated debugger control", () => {
    expect(normalizeRequestedScopes(["model.chat", "page.read", "agent.run"])).toEqual([
      "model.chat",
      "page.read",
      "agent.run"
    ]);
    expect(normalizeRequestedScopes(["debugger.control", "debugger.control"])).toEqual(["debugger.control"]);

    expect(() => normalizeRequestedScopes(["unknown"])).toThrow(GatewayProtocolError);
  });

  it("requires debugger control only for explicit debugger run mode", () => {
    expect(requiredRunScopes("debugger")).toEqual([
      "model.chat",
      "page.read",
      "page.act",
      "agent.run",
      "debugger.control"
    ]);
    expect(requiredRunScopes("dom")).toEqual(["model.chat", "page.read", "page.act", "agent.run"]);
    expect(requiredRunScopes("auto")).toEqual(["model.chat", "page.read", "page.act", "agent.run"]);
    expect(requiredRunScopes(undefined)).toEqual(["model.chat", "page.read", "page.act", "agent.run"]);
  });

  it("uses the full debugger access scope set for active-tab authorization", () => {
    expect(debuggerAccessScopes()).toEqual([
      "model.chat",
      "page.read",
      "page.act",
      "agent.run",
      "debugger.control"
    ]);
  });

  it("grants debugger control only after explicit confirmation", () => {
    const requested = ["model.chat", "debugger.control"] as const;

    expect(resolveApprovedScopes(requested, false)).toEqual(["model.chat"]);
    expect(resolveApprovedScopes(requested, true)).toEqual(["model.chat", "debugger.control"]);
  });

  it("reports gateway disabled and permission denied with stable error codes", () => {
    expect(() => ensureGatewayAccess({ ...baseSettings, gateway: { enabled: false } }, "https://app.example", ["model.chat"], false))
      .toThrow(expect.objectContaining({ code: "gateway_disabled" }));

    expect(() => ensureGatewayAccess(baseSettings, "https://app.example", ["model.chat"], false))
      .toThrow(expect.objectContaining({ code: "permission_denied" }));
  });

  it("normalizes local privacy blocks to a stable gateway error code", () => {
    expect(normalizeGatewayError(new Error("External model call blocked by local privacy policy."))).toMatchObject({
      code: "privacy_blocked",
      message: "External model call was blocked by the local privacy policy."
    });
  });

  it("allows authorized origins and exposes only granted gateway status fields", () => {
    const settings: ExtensionSettings = {
      ...baseSettings,
      providers: [{
        id: "openai-1",
        name: "OpenAI",
        provider: "openai",
        apiKey: "sk-secret",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4.1-mini"],
        defaultModel: "gpt-4.1-mini",
        enabled: true
      }],
      permissions: [{
        origin: "https://app.example",
        appName: "Example App",
        scopes: ["model.chat", "page.read", "page.act", "agent.run"],
        autoRun: true,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z"
      }]
    };

    expect(ensureGatewayAccess(settings, "https://app.example", ["model.chat", "agent.run"], true)).toBeUndefined();
    expect(getGrantedScopes(settings.permissions, "https://app.example")).toEqual(["model.chat", "page.read", "page.act", "agent.run"]);
  });
});
