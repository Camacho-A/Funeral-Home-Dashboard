import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { POST } = await import('./route');

const VALID_BODY = {
  idempotencyKey: 'start-key-1',
  legalName: 'Smith Family Funeral Home, LLC',
  displayName: 'Smith Family Funeral Home',
  primaryEmail: 'staff@smithfamily.test',
  primaryPhone: '(555) 000-1111',
  timezone: 'America/Chicago',
  defaultCurrency: 'usd',
};

function postRequest(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/onboarding/start', { method: 'POST', headers, body: JSON.stringify(body) }));
}

let orgLengthBefore: number;

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  process.env.PLATFORM_ADMIN_USER_IDS = mockDefaultUser.id;
  mockSession = { user: mockDefaultUser };
  orgLengthBefore = mockOrganizationFixtures.length;
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.PLATFORM_ADMIN_USER_IDS;
  mockOrganizationFixtures.length = orgLengthBefore;
});

describe('POST /api/onboarding/start — authorization', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await postRequest(VALID_BODY, { origin: 'https://evil.example.com', host: 'localhost' });
    expect(response.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await postRequest(VALID_BODY)).status).toBe(401);
  });

  it('returns 403 for a non-platform-administrator', async () => {
    delete process.env.PLATFORM_ADMIN_USER_IDS;
    expect((await postRequest(VALID_BODY)).status).toBe(403);
  });
});

describe('POST /api/onboarding/start — validation', () => {
  it('returns 400 for invalid JSON', async () => {
    const response = await POST(
      new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: '{not json' }),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when idempotencyKey is missing', async () => {
    const { idempotencyKey, ...rest } = VALID_BODY;
    void idempotencyKey;
    expect((await postRequest(rest)).status).toBe(400);
  });

  it('returns field-specific errors for an incomplete profile', async () => {
    const response = await postRequest({ idempotencyKey: 'k' });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

describe('POST /api/onboarding/start — success', () => {
  it('creates a new draft-then-onboarding organization for a platform administrator', async () => {
    const response = await postRequest(VALID_BODY);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.organization.status).toBe('onboarding');
    expect(body.organization.slug).toBe('smith-family-funeral-home');
    expect(body.onboardingSession.status).toBe('in_progress');
    expect(body.isNew).toBe(true);
  });

  it('is idempotent — retrying the same idempotencyKey returns 200 with the existing organization, not a new one', async () => {
    const first = await postRequest(VALID_BODY);
    const firstBody = await first.json();

    const second = await postRequest(VALID_BODY);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.organization.id).toBe(firstBody.organization.id);
    expect(secondBody.isNew).toBe(false);
  });
});

describe('POST /api/onboarding/start — chosen organization id (safe onboarding, 2026-10)', () => {
  let priorAllowlist: string | undefined;
  beforeEach(() => {
    priorAllowlist = process.env.DEPLOYMENT_ORGANIZATION_IDS;
    delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  });
  afterEach(() => {
    if (priorAllowlist === undefined) delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
    else process.env.DEPLOYMENT_ORGANIZATION_IDS = priorAllowlist;
  });

  it('creates the organization under the chosen id', async () => {
    const response = await postRequest({ ...VALID_BODY, idempotencyKey: 'chosen-1', organizationId: 'route-chosen-org-a' });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.organization.id).toBe('route-chosen-org-a');
  });

  it('400 for a malformed or non-string id', async () => {
    expect((await postRequest({ ...VALID_BODY, idempotencyKey: 'chosen-2', organizationId: 'Bad Id' })).status).toBe(400);
    expect((await postRequest({ ...VALID_BODY, idempotencyKey: 'chosen-3', organizationId: 12 })).status).toBe(400);
  });

  it('400 for a reserved id (managed-cremations included) and the Manors row is untouched', async () => {
    const manorsBefore = JSON.stringify(mockOrganizationFixtures.find((o) => o.id === 'managed-cremations'));
    const response = await postRequest({ ...VALID_BODY, idempotencyKey: 'chosen-4', organizationId: 'managed-cremations' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('reserved_organization_id');
    expect(JSON.stringify(mockOrganizationFixtures.find((o) => o.id === 'managed-cremations'))).toBe(manorsBefore);
  });

  it('409 for an id that already exists — never merged', async () => {
    const response = await postRequest({ ...VALID_BODY, idempotencyKey: 'chosen-5', organizationId: 'evergreen-memorial-group' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('organization_exists');
  });

  it('403 for an id outside the deployment allowlist', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    const response = await postRequest({ ...VALID_BODY, idempotencyKey: 'chosen-6', organizationId: 'route-chosen-org-b' });
    expect(response.status).toBe(403);
  });

  it('same key + same id → 200 resume; same key + different id → 409', async () => {
    const body = { ...VALID_BODY, idempotencyKey: 'chosen-7', organizationId: 'route-chosen-org-c' };
    expect((await postRequest(body)).status).toBe(201);
    expect((await postRequest(body)).status).toBe(200);
    const conflict = await postRequest({ ...body, organizationId: 'route-chosen-org-d' });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('idempotency_key_conflict');
  });
});
