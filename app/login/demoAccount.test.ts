import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginDemoAccount } from './demoAccount';
import { GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD } from '@/services/__mocks__/gusFixtures';
import { MOCK_LOGIN_EMAIL } from '@/services/__mocks__/authFixtures';

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'LOGIN_ORGANIZATION_ID'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('loginDemoAccount', () => {
  it('points a local Gus run (identity over mock data) at the Gus demo administrator', () => {
    process.env.DATA_ADAPTER = 'mock';
    process.env.AUTH_ADAPTER = 'identity';
    process.env.LOGIN_ORGANIZATION_ID = 'gus-camacho-jr';
    expect(loginDemoAccount()).toEqual({ email: GUS_ADMIN_EMAIL, password: GUS_DEMO_PASSWORD });
  });

  it("falls back to Manors' demo administrator for any other login organization", () => {
    process.env.DATA_ADAPTER = 'mock';
    process.env.AUTH_ADAPTER = 'identity';
    expect(loginDemoAccount()?.email).toBe(MOCK_LOGIN_EMAIL);
  });

  it('shows nothing with real Wix data', () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.AUTH_ADAPTER = 'identity';
    process.env.LOGIN_ORGANIZATION_ID = 'gus-camacho-jr';
    expect(loginDemoAccount()).toBeNull();
  });

  it('shows nothing for the mock login provider (it has its own hint)', () => {
    process.env.DATA_ADAPTER = 'mock';
    process.env.AUTH_ADAPTER = 'mock';
    expect(loginDemoAccount()).toBeNull();
  });

  it('shows nothing in a production build', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATA_ADAPTER = 'mock';
    process.env.AUTH_ADAPTER = 'identity';
    expect(loginDemoAccount()).toBeNull();
  });
});
