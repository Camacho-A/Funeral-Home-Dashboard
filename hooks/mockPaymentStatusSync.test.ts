import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withMockPaymentStatusSync } from './mockPaymentStatusSync';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import type { Case } from '@/types/case';

/**
 * Mock mode (2026-10): the browser copy of a case takes exactly the Payment
 * change the server made during a payment action — nothing else.
 */

const ORG = 'managed-cremations';
let index = -1;
let original: Case;
let serverStatuses: string[];

beforeEach(() => {
  index = caseFixtures.findIndex((c) => c.organizationId === ORG && c.id === '1044');
  original = caseFixtures[index];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ case: { paymentStatus: serverStatuses.shift() } }), { status: 200 })));
});

afterEach(() => {
  caseFixtures[index] = original;
  vi.unstubAllGlobals();
});

const mock = { organizationId: ORG, dataAdapterMode: 'mock' as const };

describe('withMockPaymentStatusSync', () => {
  it('a payment that made the server mark the case paid shows on the browser copy', async () => {
    serverStatuses = ['awaiting_payment', 'paid_in_full'];
    const result = await withMockPaymentStatusSync(mock, '1044', async () => 'recorded');
    expect(result).toBe('recorded');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
    expect(caseFixtures[index].revision).toBeGreaterThan(original.revision ?? 0);
  });

  it('a payment that did not change the server value leaves a hand-set value alone', async () => {
    caseFixtures[index] = { ...original, paymentStatus: 'paid_in_full' };
    serverStatuses = ['awaiting_payment', 'awaiting_payment'];
    await withMockPaymentStatusSync(mock, '1044', async () => 'partial');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
  });

  it('an unreadable server value changes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await withMockPaymentStatusSync(mock, '1044', async () => null);
    expect(caseFixtures[index]).toBe(original);
  });

  it('a failed payment action throws and changes nothing', async () => {
    serverStatuses = ['awaiting_payment', 'paid_in_full'];
    await expect(withMockPaymentStatusSync(mock, '1044', async () => { throw new Error('declined'); })).rejects.toThrow('declined');
    expect(caseFixtures[index]).toBe(original);
  });

  it('with real data it only runs the action — the server is already the source', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await withMockPaymentStatusSync({ organizationId: ORG, dataAdapterMode: 'wix' }, '1044', async () => 'ok')).toBe('ok');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
