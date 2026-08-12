import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consoleIdentityMessageSender,
  productionUnconfiguredIdentityMessageSender,
  resendIdentityMessageSender,
  getIdentityMessageSender,
} from './messageSender';

function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.RESEND_API_KEY;
  vi.unstubAllGlobals();
});

describe('getIdentityMessageSender', () => {
  it('returns the console (dev) adapter outside production', () => {
    setNodeEnv('development');
    expect(getIdentityMessageSender()).toBe(consoleIdentityMessageSender);

    setNodeEnv('test');
    expect(getIdentityMessageSender()).toBe(consoleIdentityMessageSender);
  });

  it('returns the production-unconfigured adapter when NODE_ENV=production', () => {
    setNodeEnv('production');
    expect(getIdentityMessageSender()).toBe(productionUnconfiguredIdentityMessageSender);
  });

  it('never throws just by being called, in any environment', () => {
    setNodeEnv('production');
    expect(() => getIdentityMessageSender()).not.toThrow();
  });

  it('Phase 33: returns resendIdentityMessageSender when RESEND_API_KEY is set, outside production', () => {
    process.env.RESEND_API_KEY = 'fake-key';
    setNodeEnv('development');
    expect(getIdentityMessageSender()).toBe(resendIdentityMessageSender);
  });

  it('Phase 33: RESEND_API_KEY takes priority over NODE_ENV=production — a configured key is always used', () => {
    process.env.RESEND_API_KEY = 'fake-key';
    setNodeEnv('production');
    expect(getIdentityMessageSender()).toBe(resendIdentityMessageSender);
  });
});

describe('consoleIdentityMessageSender', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs to the console outside production, never elsewhere', async () => {
    setNodeEnv('development');
    await consoleIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'raw-token-value' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('raw-token-value');
  });

  it('refuses to run at all when NODE_ENV=production — development token access must be impossible there', async () => {
    setNodeEnv('production');
    await expect(
      consoleIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'raw-token-value' }),
    ).rejects.toThrow(/production/i);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('productionUnconfiguredIdentityMessageSender', () => {
  it('always fails to send — no real provider exists in this codebase', async () => {
    await expect(
      productionUnconfiguredIdentityMessageSender.send({ kind: 'email_verification', to: 'x@example.com', token: 'raw-token-value' }),
    ).rejects.toThrow(/no identity message provider/i);
  });

  it('never includes the token in its own error message', async () => {
    try {
      await productionUnconfiguredIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'super-secret-raw-token' });
      throw new Error('unreachable');
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-raw-token');
    }
  });
});

describe('resendIdentityMessageSender (Phase 33)', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'fake-resend-key';
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('builds a real, path-correct reset-password link and sends it via Resend', async () => {
    const fetchMock = stubFetch();
    await resendIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'raw-token' });

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toBe('x@example.com');
    expect(body.html).toContain('/reset-password?token=raw-token');
    expect(body.text).toContain('/reset-password?token=raw-token');
  });

  it('builds an accept-invitation link carrying both token and membershipId', async () => {
    const fetchMock = stubFetch();
    await resendIdentityMessageSender.send({ kind: 'invitation', to: 'x@example.com', token: 'raw-token', organizationId: 'org-1', membershipId: 'membership-1' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('/accept-invitation?token=raw-token&membershipId=membership-1');
  });

  it('builds a family-portal accept-invitation link for portal_invitation', async () => {
    const fetchMock = stubFetch();
    await resendIdentityMessageSender.send({ kind: 'portal_invitation', to: 'x@example.com', token: 'raw-token', organizationId: 'org-1', caseId: 'case-1', invitationId: 'inv-1' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('/family/accept-invitation?token=raw-token');
  });

  it('reuses the already-built signLink verbatim for a signature_request, never constructing its own', async () => {
    const fetchMock = stubFetch();
    await resendIdentityMessageSender.send({
      kind: 'signature_request',
      to: 'x@example.com',
      signerName: 'Jordan',
      caseDisplayName: 'Case B2026-001',
      signLink: 'https://beacon.app/sign?token=abc',
      expiresAt: null,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('https://beacon.app/sign?token=abc');
  });

  it('includes every recovery code, not just the first, for mfa_recovery_codes', async () => {
    const fetchMock = stubFetch();
    await resendIdentityMessageSender.send({ kind: 'mfa_recovery_codes', to: 'x@example.com', codes: ['code-1', 'code-2', 'code-3'] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain('code-1');
    expect(body.text).toContain('code-2');
    expect(body.text).toContain('code-3');
  });
});
