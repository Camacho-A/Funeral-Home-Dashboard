import { afterEach, describe, expect, it, vi } from 'vitest';

const FAKE_IDENTITY = {
  id: 'identity-mfa-begin-test',
  email: 'mfa-test@example.com',
  normalizedEmail: 'mfa-test@example.com',
  displayName: 'MFA Test',
  phone: null,
  status: 'active' as const,
  emailVerified: true,
  passwordVersion: 1,
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let mfaEnabled = false;

vi.mock('@/lib/auth/requireIdentitySession', () => ({
  requireIdentitySession: async () => ({
    authorized: true,
    identity: { ...FAKE_IDENTITY, mfaEnabled },
    identitySession: { id: 'session-1' },
    dataAdapterMode: 'mock',
  }),
}));

vi.mock('@/services/mfaService', () => ({
  beginMfaEnrollment: async () => ({ secret: 'FAKESECRETBASE32' }),
}));

const { POST } = await import('./route');

function postRequest() {
  return POST(new Request('http://localhost/api/auth/mfa/begin', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' } }));
}

afterEach(() => {
  mfaEnabled = false;
});

describe('POST /api/auth/mfa/begin', () => {
  it('rejects a cross-site request (CSRF)', async () => {
    const response = await POST(new Request('http://localhost/api/auth/mfa/begin', { method: 'POST', headers: { origin: 'https://evil.example.com', host: 'localhost' } }));
    expect(response.status).toBe(403);
  });

  it('returns 409 when MFA is already enabled', async () => {
    mfaEnabled = true;
    const response = await postRequest();
    expect(response.status).toBe(409);
  });

  /** Solis rename (2026-09): the TOTP issuer/label shown in the user's
      authenticator app on a NEW enrollment must read "Solis", never the
      retired "Beacon" branding. Existing enrollments are untouched by
      this change (see the service-level mfaService — no secret/enrollment
      data migration involved). */
  it('uses the Solis issuer/label for a new enrollment, never Beacon', async () => {
    const response = await postRequest();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.otpauthUri).toContain('issuer=Solis');
    expect(body.otpauthUri).toContain(encodeURIComponent('Solis:mfa-test@example.com'));
    expect(body.otpauthUri).not.toMatch(/Beacon/);
    expect(body.secret).toBe('FAKESECRETBASE32');
  });
});
