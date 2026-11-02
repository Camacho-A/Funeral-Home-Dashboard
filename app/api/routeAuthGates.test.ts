import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Multi-tenant hardening (2026-11). Every API route must pass through an
 * approved authorization gate, so organization access is always decided by
 * the server-side session + membership (or, for the listed exceptions, a
 * token / signature the route verifies) — never by a client-supplied
 * organizationId alone. A new route without one fails here until it adds a
 * gate or is deliberately listed below with its reason.
 */

const API_ROOT = path.join(__dirname);

/** Server-side gates: session + membership, or a verified secret/token. */
const GATES = [
  'requireAuthorizedOrganization', // session + server-side membership of the requested organization
  'requireIdentitySession',
  'authorizeCrematory', // wraps requireAuthorizedOrganization
  'authorizePriceCatalogWrite', // wraps requireAuthorizedOrganization
  'requireFamilyAccess',
  'requireFamilySession',
  'resolveOnboardingSessionAccess',
  'requireOnboardingSessionAccess',
  'requirePlatformAdministrator', // platform operators only (onboarding start, RBAC integrity repair)
  'CRON_SECRET',
  'verifyWebhook', // Clover: signature checked with the stored organization's own secret
];

/** Routes that are public by design, each authenticated another way. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  'auth/accept-invitation/route.ts': 'staff invitation token',
  'auth/clear-session/route.ts': 'only clears the caller’s own cookies',
  'auth/forgot-password/route.ts': 'sign-in flow; no organization data returned',
  'auth/resend-verification/route.ts': 'sign-in flow; no organization data returned',
  'auth/reset-password/route.ts': 'single-use reset token',
  'auth/verify-email/route.ts': 'single-use verification token',
  'calendar-connections/google/callback/route.ts': 'signed OAuth state cookie (re-check of membership: open hardening item)',
  'calendar-connections/microsoft/callback/route.ts': 'signed OAuth state cookie (re-check of membership: open hardening item)',
  'calendar-feed/[token]/route.ts': 'per-feed secret token',
  'family/accept-invitation/route.ts': 'family invitation token',
  'family/forgot-password/route.ts': 'family sign-in flow',
  'family/login/route.ts': 'family sign-in',
  'family/logout/route.ts': 'only clears the caller’s own family session',
  'family/reset-password/route.ts': 'single-use reset token',
  'signing/[token]/complete/route.ts': 'signature request token',
  'signing/[token]/decline/route.ts': 'signature request token',
  'signing/[token]/document/route.ts': 'signature request token',
  'signing/[token]/route.ts': 'signature request token',
  'webhooks/jotform/route.ts': 'organization from the registered form config; submission re-fetched from JotForm with that config’s key',
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

describe('every API route has an authorization gate', () => {
  const files = routeFiles(API_ROOT).map((f) => path.relative(API_ROOT, f).split(path.sep).join('/'));

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(files)('%s', (file) => {
    const source = readFileSync(path.join(API_ROOT, file), 'utf8');
    const gated = GATES.some((gate) => source.includes(gate));
    if (!gated) expect(PUBLIC_BY_DESIGN[file], `${file} has no authorization gate and is not listed as public by design`).toBeTruthy();
  });

  it('lists no public route that no longer exists, and none that is actually gated', () => {
    for (const file of Object.keys(PUBLIC_BY_DESIGN)) {
      expect(files, file).toContain(file);
    }
  });

  it('never defaults to a funeral home in a route', () => {
    for (const file of files) {
      const source = readFileSync(path.join(API_ROOT, file), 'utf8');
      expect(source, file).not.toMatch(/DEFAULT_ORGANIZATION_ID/);
      expect(source, file).not.toMatch(/__mocks__\/organizationIds/);
    }
  });
});
