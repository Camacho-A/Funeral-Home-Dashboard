import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendResendEmail, isResendConfigured, ResendApiError } from './resendClient';

beforeEach(() => {
  process.env.RESEND_API_KEY = 'fake-resend-key';
  process.env.RESEND_FROM_ADDRESS = 'Beacon <test@beacon.app>';
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_ADDRESS;
  vi.unstubAllGlobals();
});

describe('isResendConfigured', () => {
  it('is true only when RESEND_API_KEY is set', () => {
    expect(isResendConfigured()).toBe(true);
    delete process.env.RESEND_API_KEY;
    expect(isResendConfigured()).toBe(false);
  });
});

describe('sendResendEmail', () => {
  it('sends the correct endpoint, headers, and body — a fake transport, never a live Resend call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendResendEmail({ to: 'family@example.com', subject: 'Test', html: '<p>Hi</p>', text: 'Hi' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fake-resend-key', 'Content-Type': 'application/json' }),
      }),
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody).toEqual({
      from: 'Beacon <test@beacon.app>',
      to: 'family@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('falls back to the default from-address when RESEND_FROM_ADDRESS is unset — display name is "SOLIS", matching current product branding', async () => {
    delete process.env.RESEND_FROM_ADDRESS;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.from).toBe('SOLIS <notifications@beacon.app>');
  });

  it('preserves a configured RESEND_FROM_ADDRESS verbatim — the display-name fix never overrides a real production value', async () => {
    process.env.RESEND_FROM_ADDRESS = 'SOLIS <notifications@mail.manorscremation.com>';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.from).toBe('SOLIS <notifications@mail.manorscremation.com>');
  });

  it('throws ResendApiError with the real HTTP status on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }));

    await expect(sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' })).rejects.toThrow(ResendApiError);
    await expect(sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' })).rejects.toMatchObject({ status: 422 });
  });

  it('throws a clear error naming the missing variable when RESEND_API_KEY is unset, never attempting a fetch', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' })).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Reply-To (2026-10, invitation deliverability follow-up). A single,
 * platform-level, optional `RESEND_REPLY_TO_ADDRESS` — see this file's
 * own `getResendReplyToAddress` comment for why no existing env var or
 * `Organization` field was reused instead.
 */
describe('sendResendEmail — Reply-To', () => {
  afterEach(() => {
    delete process.env.RESEND_REPLY_TO_ADDRESS;
  });

  it('omits reply_to entirely when RESEND_REPLY_TO_ADDRESS is unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('reply_to' in sentBody).toBe(false);
  });

  it('includes reply_to when RESEND_REPLY_TO_ADDRESS is a valid, configured email', async () => {
    process.env.RESEND_REPLY_TO_ADDRESS = 'support@manorscremation.com';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.reply_to).toBe('support@manorscremation.com');
  });

  it('a malformed RESEND_REPLY_TO_ADDRESS is silently omitted — never a reason the send fails', async () => {
    process.env.RESEND_REPLY_TO_ADDRESS = 'not-an-email';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('reply_to' in sentBody).toBe(false);
  });

  it('sending still succeeds even when RESEND_REPLY_TO_ADDRESS is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendResendEmail({ to: 'a@b.com', subject: 'S', html: 'H', text: 'T' })).resolves.toBeUndefined();
  });
});
