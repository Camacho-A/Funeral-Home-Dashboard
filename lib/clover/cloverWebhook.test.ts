import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyCloverSignature } from './cloverWebhook';

const SECRET = 'test-webhook-secret';

function signatureFor(rawBody: string, timestamp: number, secret: string = SECRET): string {
  const hash = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${hash}`;
}

describe('verifyCloverSignature', () => {
  it('accepts a correctly-computed signature within the tolerance window', () => {
    const body = JSON.stringify({ status: 'APPROVED' });
    const now = 1_700_000_000;
    const header = signatureFor(body, now);
    expect(verifyCloverSignature(body, header, SECRET, now).valid).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = JSON.stringify({ status: 'APPROVED' });
    const now = 1_700_000_000;
    const header = signatureFor(body, now, 'wrong-secret');
    const result = verifyCloverSignature(body, header, SECRET, now);
    expect(result.valid).toBe(false);
  });

  it('rejects a signature computed over a different (tampered) body', () => {
    const now = 1_700_000_000;
    const header = signatureFor(JSON.stringify({ status: 'APPROVED' }), now);
    const tamperedBody = JSON.stringify({ status: 'DECLINED' });
    expect(verifyCloverSignature(tamperedBody, header, SECRET, now).valid).toBe(false);
  });

  it('rejects a missing header', () => {
    const result = verifyCloverSignature('{}', null, SECRET, 1_700_000_000);
    expect(result.valid).toBe(false);
    expect(result.valid ? '' : result.reason).toMatch(/missing/i);
  });

  it('rejects a malformed header missing the v1 component', () => {
    const result = verifyCloverSignature('{}', 't=1700000000', SECRET, 1_700_000_000);
    expect(result.valid).toBe(false);
  });

  it('rejects a timestamp outside the tolerance window (replay protection)', () => {
    const body = JSON.stringify({ status: 'APPROVED' });
    const oldTimestamp = 1_700_000_000;
    const header = signatureFor(body, oldTimestamp);
    const muchLaterNow = oldTimestamp + 3600; // 1 hour later
    const result = verifyCloverSignature(body, header, SECRET, muchLaterNow);
    expect(result.valid).toBe(false);
    expect(result.valid ? '' : result.reason).toMatch(/tolerance/i);
  });

  it('accepts a timestamp just within the 5-minute tolerance window', () => {
    const body = JSON.stringify({ status: 'APPROVED' });
    const timestamp = 1_700_000_000;
    const header = signatureFor(body, timestamp);
    const fourMinutesLater = timestamp + 4 * 60;
    expect(verifyCloverSignature(body, header, SECRET, fourMinutesLater).valid).toBe(true);
  });

  it('rejects a signature with a different length than expected (never throws)', () => {
    const result = verifyCloverSignature('{}', 't=1700000000,v1=abc', SECRET, 1_700_000_000);
    expect(result.valid).toBe(false);
  });
});
