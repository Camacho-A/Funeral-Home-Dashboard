import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyMockCredentials } from './mockAuth';
import { resolveAuthorizationContext } from './authorize';
import { createSessionToken, verifySessionToken } from './sessionToken';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD, mockDefaultUser } from '../../services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

const WIX_ENV_KEYS = ['WIX_API_KEY', 'WIX_SITE_ID', 'WIX_OAUTH_CLIENT_ID', 'DATA_ADAPTER'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(WIX_ENV_KEYS.map((key) => [key, process.env[key]]));
  WIX_ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterEach(() => {
  WIX_ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('mock mode works with zero Wix credentials present', () => {
  it('mock credential verification and session issuance need no Wix environment variable at all', async () => {
    // WIX_API_KEY / WIX_SITE_ID / WIX_OAUTH_CLIENT_ID / DATA_ADAPTER are all
    // deliberately unset above — this is the actual environment `npm run
    // dev`/`npm test`/`npm run build` run under for mock mode today.
    const loginResult = verifyMockCredentials(MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD);
    expect(loginResult).toEqual({ success: true, user: mockDefaultUser });

    if (!loginResult.success) throw new Error('unreachable');
    const token = await createSessionToken(loginResult.user);
    const session = await verifySessionToken(token);
    expect(session?.user).toEqual(mockDefaultUser);

    const authz = resolveAuthorizationContext(session!);
    expect(authz.granted).toBe(true);
    if (authz.granted) expect(authz.context.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });
});

describe('no sensitive tokens in ordinary client-visible payloads', () => {
  it('AuthenticatedUser never carries a password, access token, or refresh token field', () => {
    const serialized = JSON.stringify(mockDefaultUser).toLowerCase();
    expect(serialized).not.toMatch(/password|accesstoken|refreshtoken|apikey/);
  });

  it('a resolved AuthorizationContext carries only userId/organizationId/role — nothing token-shaped', () => {
    const session = { user: mockDefaultUser, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    const result = resolveAuthorizationContext(session);
    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(Object.keys(result.context).sort()).toEqual(['organizationId', 'role', 'userId']);
    }
  });

  it('a signed session token, once decoded, contains no token/secret-shaped field', async () => {
    const token = await createSessionToken(mockDefaultUser);
    const [payloadPart] = token.split('.');
    const decoded = Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    expect(Object.keys(parsed).sort()).toEqual(['expiresAt', 'issuedAt', 'user']);
    expect(Object.keys(parsed.user).sort()).toEqual(['displayName', 'email', 'id', 'source']);
  });
});
