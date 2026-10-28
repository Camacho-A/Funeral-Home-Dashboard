import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlookMailError, sendOutlookMessage } from './outlookMail';

/** Send to Crematory (2026-10). Microsoft Graph faked; fictional recipients only. */
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const message = (sizes: number[]) => ({
  to: ['intake@crematory.example'],
  cc: ['office@funeralhome.example'],
  subject: 'Manors Cremation — 2 Cases for Crematory',
  bodyText: 'Hello',
  attachments: sizes.map((size, i) => ({ name: `Case_${i}_11-06-2026.pdf`, contentType: 'application/pdf', bytes: new Uint8Array(size).fill(7) })),
});

describe('sendOutlookMessage', () => {
  it('creates a draft, attaches each PDF, then sends — and returns the message id', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/me/messages') && init?.method === 'POST') return json({ id: 'draft-1', internetMessageId: '<m1@outlook>' }, 201);
      if (url.endsWith('/attachments')) return json({}, 201);
      if (url.endsWith('/send')) return new Response(null, { status: 202 });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);

    expect(await sendOutlookMessage('token', message([10, 20]))).toEqual({ draftId: 'draft-1', internetMessageId: '<m1@outlook>' });
    const draftBody = JSON.parse(String(fetch.mock.calls[0][1]!.body));
    expect(draftBody).toMatchObject({ subject: 'Manors Cremation — 2 Cases for Crematory', toRecipients: [{ emailAddress: { address: 'intake@crematory.example' } }] });
    const attachments = fetch.mock.calls.filter(([url]) => String(url).endsWith('/attachments')).map(([, init]) => JSON.parse(String(init!.body)));
    expect(attachments.map((a) => a.name)).toEqual(['Case_0_11-06-2026.pdf', 'Case_1_11-06-2026.pdf']);
    expect(Buffer.from(attachments[0].contentBytes, 'base64')).toHaveLength(10);
    expect(fetch.mock.calls.at(-1)![0]).toBe('https://graph.microsoft.com/v1.0/me/messages/draft-1/send');
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('uploads a large PDF in chunks through an upload session, without the bearer token', async () => {
    const puts: Array<{ range: string; auth?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/me/messages')) return json({ id: 'draft-2' }, 201);
      if (url.endsWith('/createUploadSession')) return json({ uploadUrl: 'https://upload.example/session' });
      if (url === 'https://upload.example/session') {
        const headers = init!.headers as Record<string, string>;
        puts.push({ range: headers['Content-Range'], auth: headers.Authorization });
        return json({}, 200);
      }
      if (url.endsWith('/send')) return new Response(null, { status: 202 });
      throw new Error(`unexpected ${url}`);
    }));
    await sendOutlookMessage('token', message([5 * 1024 * 1024]));
    expect(puts.map((p) => p.range)).toEqual(['bytes 0-3276799/5242880', 'bytes 3276800-5242879/5242880']);
    expect(puts.every((p) => p.auth === undefined)).toBe(true);
  });

  it('a failed attachment deletes the draft and sends nothing', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/me/messages') && init?.method === 'POST') return json({ id: 'draft-3' }, 201);
      if (url.endsWith('/attachments')) return json({ error: { code: 'ErrorQuotaExceeded' } }, 507);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const error = await sendOutlookMessage('token', message([10])).catch((e) => e);
    expect(error).toBeInstanceOf(OutlookMailError);
    expect(error).toMatchObject({ mayHaveSent: false, message: 'Outlook could not attach Case_0_11-06-2026.pdf (ErrorQuotaExceeded).' });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('a send call failing with a server error is reported as possibly sent — never as not sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/me/messages')) return json({ id: 'draft-4' }, 201);
      if (url.endsWith('/attachments')) return json({}, 201);
      return json({ error: { code: 'ServiceUnavailable' } }, 503);
    }));
    await expect(sendOutlookMessage('token', message([10]))).rejects.toMatchObject({ mayHaveSent: true });
  });

  it('refuses a message with no recipient before calling Outlook', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(sendOutlookMessage('token', { ...message([10]), to: [] })).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
