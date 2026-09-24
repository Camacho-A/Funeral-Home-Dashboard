import { describe, expect, it } from 'vitest';
import { parseJotformWebhookBody, extractWebhookAuthValue, WEBHOOK_AUTH_FIELD_NAME } from './parseWebhookPayload';

describe('extractWebhookAuthValue', () => {
  it('reads solisWebhookAuth from a bare top-level field', () => {
    expect(extractWebhookAuthValue({ solisWebhookAuth: 'secret-value' })).toBe('secret-value');
  });

  it('reads solisWebhookAuth nested inside a JSON rawRequest blob', () => {
    expect(extractWebhookAuthValue({ rawRequest: JSON.stringify({ solisWebhookAuth: 'secret-value', q1_caseNo: 'B2026-034' }) })).toBe(
      'secret-value',
    );
  });

  it('returns null when the field is absent from both locations', () => {
    expect(extractWebhookAuthValue({ rawRequest: JSON.stringify({ q1_caseNo: 'B2026-034' }) })).toBeNull();
    expect(extractWebhookAuthValue({})).toBeNull();
  });

  it('returns null (never throws) for a malformed rawRequest blob', () => {
    expect(extractWebhookAuthValue({ rawRequest: '{not valid json' })).toBeNull();
  });

  it('treats an empty string as absent, never as a valid (empty) secret', () => {
    expect(extractWebhookAuthValue({ solisWebhookAuth: '' })).toBeNull();
  });

  it('does not fuzzy-match a similarly-named field', () => {
    expect(extractWebhookAuthValue({ solisWebhookAuthorization: 'not-it', solisWebhookAuthValue: 'also-not-it' })).toBeNull();
  });

  it('exports the expected fixed field name', () => {
    expect(WEBHOOK_AUTH_FIELD_NAME).toBe('solisWebhookAuth');
  });
});

describe('parseJotformWebhookBody — solisWebhookAuth is never surfaced as a mapped answer', () => {
  it('a hidden solisWebhookAuth field never appears in the parsed answers map (it has no qid)', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ solisWebhookAuth: 'secret-value', q1_caseNo: 'B2026-034' }),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.answers['solisWebhookAuth']).toBeUndefined();
    expect(Object.values(parsed!.answers).some((a) => a.answer === 'secret-value')).toBe(false);
  });
});
