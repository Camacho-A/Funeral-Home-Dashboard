import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession, clearSession: vi.fn() }));

const { POST } = await import('./route');

const ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = ORIGIN) =>
  POST(new Request('http://localhost/api/rbac/integrity/reconcile', { method: 'POST', headers, body: JSON.stringify(body) }));

let priorEnv: string | undefined;
beforeEach(() => {
  mockSession = null;
  priorEnv = process.env.PLATFORM_ADMIN_USER_IDS;
});
afterEach(() => {
  if (priorEnv === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS;
  else process.env.PLATFORM_ADMIN_USER_IDS = priorEnv;
});

describe('POST /api/rbac/integrity/reconcile', () => {
  it('403 (cross-origin) without a valid Origin header', async () => {
    const response = await post({ mode: 'dry_run' }, { host: 'localhost', 'content-type': 'application/json' });
    expect(response.status).toBe(403);
  });

  it('401 with no session', async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'platform-admin-1';
    expect((await post({ mode: 'dry_run' })).status).toBe(401);
  });

  it('403 for a signed-in NON-platform-admin', async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'someone-else';
    mockSession = { user: { id: 'regular-user', email: 'a@b.c', displayName: 'A', source: 'identity' } };
    expect((await post({ mode: 'dry_run' })).status).toBe(403);
  });

  it('400 for an invalid mode', async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'platform-admin-1';
    mockSession = { user: { id: 'platform-admin-1', email: 'a@b.c', displayName: 'A', source: 'identity' } };
    expect((await post({ mode: 'nope' })).status).toBe(400);
  });

  it('200 + dry-run record for a platform admin (read-only, converged → 0 changes)', async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'platform-admin-1';
    mockSession = { user: { id: 'platform-admin-1', email: 'a@b.c', displayName: 'A', source: 'identity' } };
    const response = await post({ mode: 'dry_run' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.record.mode).toBe('dry_run');
    expect(body.record.scopeMarker).toBe('PLATFORM');
    expect(body.record.summary.requiredChanges).toBe(0);
  });
});
