import { describe, expect, it } from "vitest";
import {
  canUseDebuggerControl,
  canUseScopes,
  grantSitePermission,
  revokeSitePermission
} from "./permissions";
import type { SitePermission } from "./types";

describe("site permissions", () => {
  it("allows auto-run only when origin matches, permission is active, and all scopes are granted", () => {
    const permissions: SitePermission[] = [
      {
        origin: "https://app.example.com",
        scopes: ["model.chat", "page.read", "page.act"],
        autoRun: true,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z"
      }
    ];

    expect(canUseScopes(permissions, "https://app.example.com", ["model.chat", "page.read"], true)).toBe(true);
    expect(canUseScopes(permissions, "https://other.example.com", ["model.chat"], true)).toBe(false);
    expect(canUseScopes(permissions, "https://app.example.com", ["debugger.control"], true)).toBe(false);
    expect(canUseScopes(permissions, "https://app.example.com", ["page.act"], false)).toBe(true);
    expect(canUseDebuggerControl(permissions, "https://app.example.com")).toBe(false);
  });

  it("requires explicit auto-run authorization for automatic gateway calls", () => {
    const permissions: SitePermission[] = [
      {
        origin: "https://app.example.com",
        scopes: ["model.chat", "page.read", "page.act", "agent.run"],
        autoRun: false,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z"
      }
    ];

    expect(canUseScopes(permissions, "https://app.example.com", ["model.chat"], false)).toBe(true);
    expect(canUseScopes(permissions, "https://app.example.com", ["model.chat"], true)).toBe(false);
  });

  it("gates debugger control separately from auto-run", () => {
    const permissions: SitePermission[] = [
      {
        origin: "https://app.example.com",
        scopes: ["debugger.control"],
        autoRun: false,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z"
      }
    ];

    expect(canUseDebuggerControl(permissions, "https://app.example.com")).toBe(true);
    expect(canUseScopes(permissions, "https://app.example.com", ["debugger.control"], true)).toBe(false);
  });

  it("upserts grants and revokes active site permissions", () => {
    const first = grantSitePermission([], {
      origin: "https://app.example.com",
      scopes: ["model.chat"],
      autoRun: false,
      appName: "Example"
    }, "2026-04-25T00:00:00.000Z");

    const updated = grantSitePermission(first, {
      origin: "https://app.example.com",
      scopes: ["model.chat", "page.read"],
      autoRun: true
    }, "2026-04-25T00:01:00.000Z");

    expect(updated).toHaveLength(1);
    expect(updated[0].scopes).toEqual(["model.chat", "page.read"]);
    expect(updated[0].autoRun).toBe(true);
    expect(updated[0].createdAt).toBe("2026-04-25T00:00:00.000Z");
    expect(updated[0].updatedAt).toBe("2026-04-25T00:01:00.000Z");

    const revoked = revokeSitePermission(updated, "https://app.example.com", "2026-04-25T00:02:00.000Z");

    expect(revoked[0].revokedAt).toBe("2026-04-25T00:02:00.000Z");
    expect(canUseScopes(revoked, "https://app.example.com", ["model.chat"], false)).toBe(false);
  });
});
