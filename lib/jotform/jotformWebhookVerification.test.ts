import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyJotformWebhook } from './jotformWebhookVerification';

const SECRET = 'synthetic-test-secret-value';

beforeEach(() => {
  delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
});
afterEach(() => {
  delete process.env.JOTFORM_WEBHOOK_SHARED_SECRET;
});

describe('verifyJotformWebhook', () => {
  it('fails closed when JOTFORM_WEBHOOK_SHARED_SECRET is not configured, even with a plausible auth value', () => {
    const result = verifyJotformWebhook(SECRET);
    expect(result).toEqual({ valid: false, reason: 'not_configured' });
  });

  it('rejects a null auth value (field missing from the request body)', () => {
    process.env.JOTFORM_WEBHOOK_SHARED_SECRET = SECRET;
    expect(verifyJotformWebhook(null)).toEqual({ valid: false, reason: 'missing_field' });
  });

  it('rejects an incorrect auth value', () => {
    process.env.JOTFORM_WEBHOOK_SHARED_SECRET = SECRET;
    expect(verifyJotformWebhook('wrong-value')).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('accepts the correct auth value', () => {
    process.env.JOTFORM_WEBHOOK_SHARED_SECRET = SECRET;
    expect(verifyJotformWebhook(SECRET)).toEqual({ valid: true });
  });

  it('rejects a value of a different length than the configured secret without throwing', () => {
    process.env.JOTFORM_WEBHOOK_SHARED_SECRET = SECRET;
    expect(verifyJotformWebhook('short')).toEqual({ valid: false, reason: 'mismatch' });
    expect(verifyJotformWebhook(SECRET + 'x')).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('never includes the configured secret or the provided value in its own return shape', () => {
    process.env.JOTFORM_WEBHOOK_SHARED_SECRET = SECRET;
    const result = verifyJotformWebhook('wrong-value');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('wrong-value');
  });
});
