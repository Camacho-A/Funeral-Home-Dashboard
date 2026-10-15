import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSubmissionAnswers, fetchSubmissionPdf, isValidJotformApiKeyReference, JotformClientError } from './jotformClient';

/**
 * Per-integration Jotform API key (2026-10 multi-tenant hardening). A
 * config names an env var; the key itself never leaves the server env.
 */
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: { form_id: '1', answers: {}, created_at: null } }), { status: 200 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  process.env.JOTFORM_API_KEY = 'default-key';
  process.env.JOTFORM_API_KEY_GUS_CAMACHO_JR = 'gus-key';
  process.env.NOT_A_JOTFORM_SECRET = 'must-never-be-sent';
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  delete process.env.JOTFORM_API_KEY_GUS_CAMACHO_JR;
  delete process.env.NOT_A_JOTFORM_SECRET;
});

function sentApiKey(): string | undefined {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return (init.headers as Record<string, string>).APIKEY;
}

describe('Jotform API key reference', () => {
  it('defaults to JOTFORM_API_KEY (Manors behaviour unchanged)', async () => {
    await fetchSubmissionAnswers('123');
    expect(sentApiKey()).toBe('default-key');
  });

  it('uses the referenced per-organization key when a config names one', async () => {
    await fetchSubmissionAnswers('123', { apiKeyReference: 'JOTFORM_API_KEY_GUS_CAMACHO_JR' });
    expect(sentApiKey()).toBe('gus-key');
  });

  it('refuses a reference outside the JOTFORM_API_KEY family without calling Jotform', async () => {
    await expect(fetchSubmissionPdf('1', '2', { apiKeyReference: 'NOT_A_JOTFORM_SECRET' })).rejects.toMatchObject({
      category: 'missing_api_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly when the referenced variable is unset', async () => {
    const error = await fetchSubmissionAnswers('123', { apiKeyReference: 'JOTFORM_API_KEY_UNSET_ORG' }).catch((e) => e);
    expect(error).toBeInstanceOf(JotformClientError);
    expect(error.category).toBe('missing_api_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates names', () => {
    expect(isValidJotformApiKeyReference('JOTFORM_API_KEY')).toBe(true);
    expect(isValidJotformApiKeyReference('JOTFORM_API_KEY_GUS_CAMACHO_JR')).toBe(true);
    expect(isValidJotformApiKeyReference('JOTFORM_API_KEYX')).toBe(false);
    expect(isValidJotformApiKeyReference('WIX_API_KEY')).toBe(false);
    expect(isValidJotformApiKeyReference('jotform_api_key')).toBe(false);
  });
});
