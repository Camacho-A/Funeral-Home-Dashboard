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
    await resendIdentityMessageSender.send({
      kind: 'invitation',
      to: 'x@example.com',
      token: 'raw-token',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      organizationName: "Manor's Cremation",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('/accept-invitation?token=raw-token&membershipId=membership-1');
  });

  /** Staff invitation email copy (2026-10) — see
      lib/identity/messageSender.ts's own comment on why initial invite
      and Resend share this exact message kind/copy. */
  describe('invitation email copy', () => {
    function sendInvitation(overrides: Partial<{ to: string; organizationName: string }> = {}) {
      return resendIdentityMessageSender.send({
        kind: 'invitation',
        to: overrides.to ?? 'new.hire@example.com',
        token: 'raw-token',
        organizationId: 'org-1',
        membershipId: 'membership-1',
        organizationName: overrides.organizationName ?? "Manor's Cremation",
      });
    }

    it('subject includes both the real organization name and SOLIS', async () => {
      const fetchMock = stubFetch();
      await sendInvitation({ organizationName: "Manor's Cremation" });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toBe("You've been invited to join Manor's Cremation on SOLIS");
    });

    it('a different organization name renders correctly — never hardcoded', async () => {
      const fetchMock = stubFetch();
      await sendInvitation({ organizationName: 'Evergreen Memorial Group' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toBe("You've been invited to join Evergreen Memorial Group on SOLIS");
      expect(body.html).toContain('Evergreen Memorial Group');
      expect(body.text).toContain('Evergreen Memorial Group');
    });

    it('organization name appears in the body, not just the subject', async () => {
      const fetchMock = stubFetch();
      await sendInvitation({ organizationName: "Manor's Cremation" });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).toContain("Manor's Cremation has invited you to join their team on SOLIS");
      expect(body.text).toContain("Manor's Cremation has invited you to join their team on SOLIS");
    });

    it('uses a safe "Hello," greeting — Identity has no first-name field to address the invitee by', async () => {
      const fetchMock = stubFetch();
      await sendInvitation();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).toContain('Hello,');
      expect(body.text).toContain('Hello,');
    });

    it('the CTA reads exactly "Accept Invitation"', async () => {
      const fetchMock = stubFetch();
      await sendInvitation();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).toContain('>Accept Invitation<');
    });

    it('the reassurance text names the exact recipient address, not a generic placeholder', async () => {
      const fetchMock = stubFetch();
      await sendInvitation({ to: 'specific.recipient@example.com' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).toContain('This invitation was sent to specific.recipient@example.com');
      expect(body.text).toContain('This invitation was sent to specific.recipient@example.com');
    });

    it('never contains resend/urgency language — a resent invitation must read identically to a fresh one', async () => {
      const fetchMock = stubFetch();
      await sendInvitation();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      for (const forbidden of [/resend/i, /second notice/i, /reminder/i, /urgent/i, /action required/i, /congratulations/i, /don'?t miss out/i, /act now/i]) {
        expect(body.subject).not.toMatch(forbidden);
        expect(body.html).not.toMatch(forbidden);
        expect(body.text).not.toMatch(forbidden);
      }
    });

    it('the invitation URL in the plain-text fallback matches the HTML link exactly', async () => {
      const fetchMock = stubFetch();
      await sendInvitation();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const [, htmlLink] = body.html.match(/href="([^"]+)"/) as [string, string];
      expect(body.text).toContain(htmlLink);
    });
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

  /** Solis rename (2026-09): every transactional email subject uses the
      current product name, never the retired "Beacon" branding. */
  describe('subject lines use Solis branding', () => {
    it('password_reset', async () => {
      const fetchMock = stubFetch();
      await resendIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'raw-token' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toBe('Reset your Solis password');
    });

    it('email_verification', async () => {
      const fetchMock = stubFetch();
      await resendIdentityMessageSender.send({ kind: 'email_verification', to: 'x@example.com', token: 'raw-token' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toBe('Verify your Solis email address');
    });

    it('invitation', async () => {
      const fetchMock = stubFetch();
      await resendIdentityMessageSender.send({
        kind: 'invitation',
        to: 'x@example.com',
        token: 'raw-token',
        organizationId: 'org-1',
        membershipId: 'membership-1',
        organizationName: "Manor's Cremation",
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      // Staff invitation email copy (2026-10): the subject now names the
      // real inviting organization, never a generic "a Solis organization".
      expect(body.subject).toBe("You've been invited to join Manor's Cremation on SOLIS");
    });

    it('mfa_recovery_codes', async () => {
      const fetchMock = stubFetch();
      await resendIdentityMessageSender.send({ kind: 'mfa_recovery_codes', to: 'x@example.com', codes: ['code-1'] });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toBe('Your Solis MFA recovery codes');
    });

    it('portal_invitation', async () => {
      const fetchMock = stubFetch();
      await resendIdentityMessageSender.send({ kind: 'portal_invitation', to: 'x@example.com', token: 'raw-token', organizationId: 'org-1', caseId: 'case-1', invitationId: 'inv-1' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toBe("You've been invited to the Solis family portal");
    });

    it('none of the five subject lines contain the retired "Beacon" branding', async () => {
      const fetchMock = stubFetch();
      const messages = [
        { kind: 'password_reset' as const, to: 'x@example.com', token: 't' },
        { kind: 'email_verification' as const, to: 'x@example.com', token: 't' },
        { kind: 'invitation' as const, to: 'x@example.com', token: 't', organizationId: 'org-1', membershipId: 'm-1', organizationName: "Manor's Cremation" },
        { kind: 'mfa_recovery_codes' as const, to: 'x@example.com', codes: ['c'] },
        { kind: 'portal_invitation' as const, to: 'x@example.com', token: 't', organizationId: 'org-1', caseId: 'case-1', invitationId: 'inv-1' },
      ];
      for (const message of messages) {
        await resendIdentityMessageSender.send(message);
      }
      for (const call of fetchMock.mock.calls) {
        const body = JSON.parse(call[1].body as string);
        expect(body.subject).not.toMatch(/Beacon/);
      }
    });
  });
});
