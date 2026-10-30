import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSandboxIsolation, isSandboxEnabled, isSandboxIsolated, sandboxIsolationProblems } from './sandbox';

/** SOLIS sandbox (2026-10): the sandbox only ever runs fully isolated. */

const ISOLATED = { NEXT_PUBLIC_SOLIS_SANDBOX: 'true', DATA_ADAPTER: 'mock', AUTH_ADAPTER: 'identity', SESSION_JWT_SECRET: 'sandbox-only', DEPLOYMENT_ORGANIZATION_IDS: 'managed-cremations' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sandbox isolation', () => {
  it('a mock-only environment with no live credential is isolated', () => {
    expect(sandboxIsolationProblems(ISOLATED)).toEqual([]);
    expect(isSandboxIsolated(ISOLATED)).toBe(true);
    expect(() => assertSandboxIsolation(ISOLATED)).not.toThrow();
  });

  it.each([
    'WIX_API_KEY', 'WIX_SITE_ID', 'RESEND_API_KEY', 'TWILIO_AUTH_TOKEN', 'MICROSOFT_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET',
    'CLOVER_MANORS_SANDBOX_PRIVATE_KEY', 'TEST_CLOVER_PRIVATE_KEY', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'R2_SECRET_ACCESS_KEY',
    'JOTFORM_API_KEY', 'DATABASE_URL', 'SSN_ENCRYPTION_KEY', 'CALENDAR_TOKEN_ENCRYPTION_KEY',
  ])('any live credential (%s) breaks isolation and the sandbox refuses to start', (name) => {
    const env = { ...ISOLATED, [name]: 'something' };
    expect(sandboxIsolationProblems(env)).toEqual([`live credential ${name} must not be set`]);
    expect(() => assertSandboxIsolation(env)).toThrow(/refused to start/);
  });

  it('an empty credential variable is not a credential', () => {
    expect(isSandboxIsolated({ ...ISOLATED, RESEND_API_KEY: '' })).toBe(true);
  });

  it('the mock Clover simulator settings are allowed — they reach nothing', () => {
    expect(isSandboxIsolated({ ...ISOLATED, CLOVER_MOCK_WEBHOOK_SECRET: 'x', CLOVER_MOCK_MERCHANT_ID: 'y' })).toBe(true);
  });

  it('real data, a non-identity sign-in, or the switch off is never an isolated sandbox', () => {
    expect(sandboxIsolationProblems({ ...ISOLATED, DATA_ADAPTER: 'wix' })).toContain('DATA_ADAPTER must be "mock"');
    expect(sandboxIsolationProblems({ ...ISOLATED, AUTH_ADAPTER: 'mock' })).toContain('AUTH_ADAPTER must be "identity"');
    expect(sandboxIsolationProblems({ ...ISOLATED, AUTH_ADAPTER: undefined })).toContain('AUTH_ADAPTER must be "identity"');
    expect(sandboxIsolationProblems({ ...ISOLATED, NEXT_PUBLIC_SOLIS_SANDBOX: undefined })).toContain('NEXT_PUBLIC_SOLIS_SANDBOX is not "true"');
  });

  it('the switch is off unless set to exactly "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', '');
    expect(isSandboxEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', '1');
    expect(isSandboxEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', 'true');
    expect(isSandboxEnabled()).toBe(true);
  });
});
