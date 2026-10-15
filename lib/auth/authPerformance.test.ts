import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWix } from './__tests__/fakeWix';
// ./session is mocked below, so load the request-scope implementation the
// way the real lib/auth/session.ts does.
import '../requestScope';

/**
 * Performance phase 1 (2026-10) — Wix round-trips and security behaviour of
 * the staff authentication path, run against the REAL DATA_ADAPTER=wix code
 * (sessionService, identityService, membershipService, permissionService,
 * requireAuthorizedOrganization, the portal layout) with only the Wix HTTP
 * API replaced by an in-memory fake that counts calls.
 *
 * "calls" = total Wix requests (load on Wix); "waves" = how many of them had
 * to wait for an earlier one (the sequential round-trips a staff member
 * actually waits for, each ~200–500 ms against real Wix).
 *
 * `next/headers` `headers()` returns the object for the current simulated
 * request; `newRequest()` starts the next one. That object is what
 * lib/requestScope.ts scopes its per-request memo to, exactly as the real
 * Next.js request headers are.
 */

const request = vi.hoisted(() => ({ current: {} as object }));
const sessionState = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string; displayName: string; source: 'identity' };
    issuedAt: number;
    expiresAt: number;
    sessionId?: string;
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => request.current,
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock('./session', () => ({
  getSession: async () => sessionState.session,
  createSession: async () => undefined,
  clearSession: async () => undefined,
  clearSessionPath: (reason: string) => `/api/auth/clear-session?reason=${reason}`,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/hooks/useCaseSearch', () => ({
  CaseSearchProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/hooks/useOrganization', () => ({
  OrganizationProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/hooks/useSession', () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

const MANORS = 'managed-cremations';
const OTHER_ORG = 'gus-camacho-jr';
const IDENTITY_ID = 'identity-perf-1';
const SESSION_ID = 'session-perf-1';
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const wix = new FakeWix(5);
const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  'DATA_ADAPTER',
  'AUTH_ADAPTER',
  'WIX_API_KEY',
  'WIX_SITE_ID',
  'DEPLOYMENT_ORGANIZATION_IDS',
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function newRequest(): void {
  request.current = {};
  wix.resetCounts();
}

async function seed(
  options: {
    lastSeenAtOffsetMs?: number;
    memberships?: Array<{ organizationId: string; role: string; status?: string }>;
  } = {},
) {
  const { buildWixIdentitySessionData } = await import('../wixIdentitySessionMapper');
  const { buildWixIdentityData } = await import('../wixIdentityMapper');
  const { buildWixMembershipData } = await import('../wixMembershipMapper');
  const { buildWixRoleData } = await import('../wixRoleMapper');
  const { buildWixRolePermissionData } = await import('../wixRolePermissionMapper');

  wix.collections.clear();
  wix.insert(
    'sessions',
    SESSION_ID,
    buildWixIdentitySessionData({
      id: SESSION_ID,
      identityId: IDENTITY_ID,
      organizationId: MANORS,
      deviceId: 'device-1',
      deviceName: null,
      ipAddress: null,
      userAgent: null,
      expiresAt: iso(60 * 60 * 1000),
      lastSeenAt: iso(options.lastSeenAtOffsetMs ?? -60 * 1000),
      passwordVersionAtIssue: 1,
      revokedAt: null,
      createdAt: iso(-2 * 60 * 60 * 1000),
    }) as Record<string, unknown>,
  );
  wix.insert(
    'identities',
    IDENTITY_ID,
    buildWixIdentityData(
      {
        id: IDENTITY_ID,
        email: 'perf@example.com',
        normalizedEmail: 'perf@example.com',
        displayName: 'Perf Tester',
        phone: null,
        status: 'active',
        emailVerified: true,
        passwordVersion: 1,
        mfaEnabled: false,
        lastLoginAt: null,
        createdAt: iso(-1000),
        updatedAt: iso(-1000),
      },
      {
        passwordHash: null,
        mfaSecretReference: null,
        mfaVerifiedAt: null,
        mfaRecoveryCodeHashes: [],
      },
    ) as Record<string, unknown>,
  );
  for (const [index, membership] of (
    options.memberships ?? [{ organizationId: MANORS, role: 'administrator' }]
  ).entries()) {
    wix.insert(
      'organizationMemberships',
      `membership-${index}`,
      buildWixMembershipData({
        id: `membership-${index}`,
        identityId: IDENTITY_ID,
        organizationId: membership.organizationId,
        role: membership.role,
        status: (membership.status ?? 'active') as 'active',
        invitedBy: null,
        joinedAt: iso(-1000),
        createdAt: iso(-1000),
        updatedAt: iso(-1000),
      }) as Record<string, unknown>,
    );
  }
  wix.insert(
    'roles',
    'role-administrator',
    buildWixRoleData({
      id: 'role-administrator',
      key: 'administrator',
      name: 'Administrator',
      description: '',
      organizationId: null,
      isSystemDefault: true,
      createdAt: iso(-1000),
      updatedAt: iso(-1000),
    }) as Record<string, unknown>,
  );
  for (const permissionKey of ['case.read', 'case.update'] as const) {
    wix.insert(
      'rolePermissions',
      `rp-${permissionKey}`,
      buildWixRolePermissionData({
        id: `rp-${permissionKey}`,
        roleId: 'role-administrator',
        permissionKey,
        createdAt: iso(-1000),
      }) as Record<string, unknown>,
    );
  }

  sessionState.session = {
    user: {
      id: IDENTITY_ID,
      email: 'perf@example.com',
      displayName: 'Perf Tester',
      source: 'identity',
    },
    issuedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    sessionId: SESSION_ID,
  };
}

function report(label: string): void {
  console.info(`[auth-perf] ${label}: calls=${wix.callCount} waves=${wix.waves}`);
}

beforeAll(() => {
  globalThis.fetch = wix.fetch as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
});
beforeEach(async () => {
  process.env.DATA_ADAPTER = 'wix';
  process.env.AUTH_ADAPTER = 'identity';
  process.env.WIX_API_KEY = 'fake-key';
  process.env.WIX_SITE_ID = 'fake-site';
  process.env.DEPLOYMENT_ORGANIZATION_IDS = MANORS;
  await seed();
  newRequest();
});

const auth = () => import('./requireAuthorizedOrganization');
const permissions = () => import('../../services/permissionService');

describe('staff authentication — Wix round-trips', () => {
  it('authorizes a typical API request in 1 sequential round-trip (3 parallel reads) when no session write is due', async () => {
    const { requireAuthorizedOrganization } = await auth();
    const result = await requireAuthorizedOrganization(MANORS);
    report('requireAuthorizedOrganization');

    expect(result.authorized).toBe(true);
    expect(wix.callCount).toBe(3);
    expect(wix.waves).toBe(1);
    expect(wix.calls.filter((c) => c.collection === 'sessions')).toHaveLength(1);
  });

  it('still slides the session forward when the touch throttle has elapsed (read, then the existing read-merge-write)', async () => {
    await seed({ lastSeenAtOffsetMs: -10 * 60 * 1000 });
    newRequest();
    const { requireAuthorizedOrganization } = await auth();
    const result = await requireAuthorizedOrganization(MANORS);
    report('requireAuthorizedOrganization (touch due)');

    expect(result.authorized).toBe(true);
    expect(wix.callCount).toBe(5);
    expect(wix.waves).toBe(3);
    const stored = wix.find('sessions', (d) => d.beaconSessionId === SESSION_ID)!;
    expect(new Date(String(stored.data.lastSeenAt)).getTime()).toBeGreaterThan(NOW - 60 * 1000);
  });

  it('a route with two permission checks resolves the role once per request, with role and overrides read in parallel', async () => {
    const { requireAuthorizedOrganization } = await auth();
    const { hasPermission } = await permissions();
    const result = await requireAuthorizedOrganization(MANORS);
    if (!result.authorized) throw new Error('expected authorized');
    const params = {
      identityId: result.context.userId,
      organizationId: result.context.organizationId,
      roleKey: result.context.role,
    };
    const [canRead, canDelete] = await Promise.all([
      hasPermission(params, 'wix', 'case.read'),
      hasPermission(params, 'wix', 'case.delete' as never),
    ]);
    report('requireAuthorizedOrganization + 2 permission checks');

    expect(canRead).toBe(true);
    expect(canDelete).toBe(false);
    expect(wix.callCount).toBe(6);
    expect(wix.waves).toBe(3);
  });

  it('resolving the same role for many recipients in one request reads it once', async () => {
    const { resolvePermissions } = await permissions();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        resolvePermissions(
          { identityId: `member-${i}`, organizationId: MANORS, roleKey: 'administrator' },
          'wix',
        ),
      ),
    );
    report('5 recipients, same role');

    results.forEach((set) => expect(set.has('case.read')).toBe(true));
    expect(wix.callCount).toBe(3);
  });

  it('the portal layout validates the session and loads memberships in parallel, then the staff profile', async () => {
    const { default: PortalLayout } = await import('@/app/(portal)/layout');
    const element = await PortalLayout({ children: null });
    report('portal layout');

    expect(element).toBeTruthy();
    expect(wix.callCount).toBe(4);
    expect(wix.waves).toBe(2);
  });
});

describe('staff authentication — security is unchanged', () => {
  async function authorize(organizationId = MANORS) {
    const { requireAuthorizedOrganization } = await auth();
    return requireAuthorizedOrganization(organizationId);
  }

  it('rejects a revoked session (401)', async () => {
    wix.find('sessions', (d) => d.beaconSessionId === SESSION_ID)!.data.revokedAt = iso(-1000);
    const result = await authorize();
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
  });

  it('rejects an expired session (401) and never slides it forward', async () => {
    const row = wix.find('sessions', (d) => d.beaconSessionId === SESSION_ID)!;
    row.data.expiresAt = iso(-1000);
    row.data.lastSeenAt = iso(-10 * 60 * 60 * 1000);
    const result = await authorize();
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
    expect(row.data.expiresAt).toBe(iso(-1000));
    expect(wix.calls.some((c) => c.method.startsWith('PUT'))).toBe(false);
  });

  it('rejects a session issued before a password change (401)', async () => {
    wix.find('identities', (d) => d.beaconIdentityId === IDENTITY_ID)!.data.passwordVersion = 2;
    const result = await authorize();
    expect(result.authorized).toBe(false);
  });

  it('rejects a disabled identity (401)', async () => {
    wix.find('identities', (d) => d.beaconIdentityId === IDENTITY_ID)!.data.status = 'disabled';
    const result = await authorize();
    expect(result.authorized).toBe(false);
  });

  it('rejects a cookie whose identity does not own the session row it points at (401)', async () => {
    sessionState.session = {
      ...sessionState.session!,
      user: { ...sessionState.session!.user, id: 'someone-else' },
    };
    const result = await authorize();
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(401);
  });

  it('denies an organization this deployment does not serve (403) before reading anything from Wix', async () => {
    await seed({
      memberships: [
        { organizationId: MANORS, role: 'administrator' },
        { organizationId: OTHER_ORG, role: 'administrator' },
      ],
    });
    newRequest();
    const result = await authorize(OTHER_ORG);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
    expect(wix.callCount).toBe(0);
  });

  it('denies an organization the identity has no membership in (403)', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = `${MANORS},${OTHER_ORG}`;
    const result = await authorize(OTHER_ORG);
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('a removed membership takes effect on the very next request (nothing cached across requests)', async () => {
    expect((await authorize()).authorized).toBe(true);
    wix.find('organizationMemberships', (d) => d.identityId === IDENTITY_ID)!.data.status =
      'removed';
    newRequest();
    const result = await authorize();
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
  });

  it('a revoked session takes effect on the very next request', async () => {
    expect((await authorize()).authorized).toBe(true);
    wix.find('sessions', (d) => d.beaconSessionId === SESSION_ID)!.data.revokedAt = iso(0);
    newRequest();
    expect((await authorize()).authorized).toBe(false);
  });

  it('a permission removed from a role takes effect on the very next request', async () => {
    const { hasPermission } = await permissions();
    const params = { identityId: IDENTITY_ID, organizationId: MANORS, roleKey: 'administrator' };
    expect(await hasPermission(params, 'wix', 'case.update')).toBe(true);
    const rows = wix.rows('rolePermissions');
    rows.splice(
      rows.findIndex((r) => r.data.permissionKey === 'case.update'),
      1,
    );
    newRequest();
    expect(await hasPermission(params, 'wix', 'case.update')).toBe(false);
  });

  it('a Wix write during a request drops what that request memoized, so a re-check sees the change', async () => {
    const { hasPermission } = await permissions();
    const { deleteWixDataItem } = await import('../wixDataApi');
    const params = { identityId: IDENTITY_ID, organizationId: MANORS, roleKey: 'administrator' };
    expect(await hasPermission(params, 'wix', 'case.update')).toBe(true);
    await deleteWixDataItem('rolePermissions', 'rp-case.update');
    expect(await hasPermission(params, 'wix', 'case.update')).toBe(false);
  });

  it('never shares memoized permissions between two requests', async () => {
    const { resolvePermissions } = await permissions();
    await resolvePermissions(
      { identityId: IDENTITY_ID, organizationId: MANORS, roleKey: 'administrator' },
      'wix',
    );
    newRequest();
    await resolvePermissions(
      { identityId: IDENTITY_ID, organizationId: MANORS, roleKey: 'administrator' },
      'wix',
    );
    expect(wix.callCount).toBe(3);
  });

  it('keeps permission sets separate per organization within one request', async () => {
    const { buildWixRoleData } = await import('../wixRoleMapper');
    wix.insert(
      'roles',
      'role-custom',
      buildWixRoleData({
        id: 'role-custom',
        key: 'custom-manors',
        name: 'Custom',
        description: '',
        organizationId: MANORS,
        isSystemDefault: false,
        createdAt: iso(0),
        updatedAt: iso(0),
      }) as Record<string, unknown>,
    );
    const { resolvePermissions } = await permissions();
    const [own, other] = await Promise.all([
      resolvePermissions(
        { identityId: IDENTITY_ID, organizationId: MANORS, roleKey: 'custom-manors' },
        'wix',
      ),
      resolvePermissions(
        { identityId: IDENTITY_ID, organizationId: OTHER_ORG, roleKey: 'custom-manors' },
        'wix',
      ),
    ]);
    expect(other.size).toBe(0);
    expect(own).not.toBe(other);
  });

  it('a caller mutating its returned permission set cannot affect another check in the same request', async () => {
    const { resolvePermissions, hasPermission } = await permissions();
    const params = { identityId: IDENTITY_ID, organizationId: MANORS, roleKey: 'administrator' };
    const first = await resolvePermissions(params, 'wix');
    first.add('case.delete' as never);
    expect(await hasPermission(params, 'wix', 'case.delete' as never)).toBe(false);
  });
});
