import type { Scope, SitePermission } from "./types";

export function canUseScopes(
  permissions: SitePermission[],
  origin: string,
  requestedScopes: Scope[],
  requireAutoRun: boolean
): boolean {
  const permission = permissions.find((entry) => entry.origin === origin && !entry.revokedAt);
  if (!permission) return false;
  if (requireAutoRun && !permission.autoRun) return false;
  return requestedScopes.every((scope) => permission.scopes.includes(scope));
}

export function canUseDebuggerControl(permissions: SitePermission[], origin: string): boolean {
  return canUseScopes(permissions, origin, ["debugger.control"], false);
}

export function grantSitePermission(
  permissions: SitePermission[],
  grant: Pick<SitePermission, "origin" | "scopes" | "autoRun"> & Partial<Pick<SitePermission, "appName">>,
  now = new Date().toISOString()
): SitePermission[] {
  const existing = permissions.find((entry) => entry.origin === grant.origin);
  const next: SitePermission = {
    origin: grant.origin,
    appName: grant.appName ?? existing?.appName,
    scopes: [...grant.scopes],
    autoRun: grant.autoRun,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revokedAt: undefined
  };

  return [next, ...permissions.filter((entry) => entry.origin !== grant.origin)];
}

export function revokeSitePermission(
  permissions: SitePermission[],
  origin: string,
  now = new Date().toISOString()
): SitePermission[] {
  return permissions.map((entry) => (
    entry.origin === origin ? { ...entry, revokedAt: now, updatedAt: now } : entry
  ));
}

export function touchSitePermission(
  permissions: SitePermission[],
  origin: string,
  now = new Date().toISOString()
): SitePermission[] {
  return permissions.map((entry) => (
    entry.origin === origin ? { ...entry, lastUsedAt: now, updatedAt: now } : entry
  ));
}
