import { describe, expect, it, beforeEach } from 'vitest';
import {
  purchaseOrderLeaseKey,
  vendorBillLeaseKey,
  withAggregateLease,
  commitLeasedWrite,
} from './aggregateLeaseService';
import { inventoryLockFixtures, inventoryWriteClaimFixtures } from './__mocks__/merchandiseFixtures';

beforeEach(() => {
  inventoryLockFixtures.length = 0;
  inventoryWriteClaimFixtures.length = 0;
});

describe('aggregateLeaseService key helpers', () => {
  it('PO / bill keys are prefixed so they can never collide with a stock-line key', () => {
    expect(purchaseOrderLeaseKey('org1', 'po1')).toBe('po-org1-po1');
    expect(vendorBillLeaseKey('org1', 'bill1')).toBe('bill-org1-bill1');
    // A stock-line key is `${org}-${loc}-${product}` (no po-/bill- prefix).
    expect(purchaseOrderLeaseKey('org1', 'po1').startsWith('po-')).toBe(true);
    expect(vendorBillLeaseKey('org1', 'bill1').startsWith('bill-')).toBe(true);
  });
});

describe('aggregateLeaseService leasing (mock)', () => {
  it('serializes writes on the same aggregate key', async () => {
    const key = vendorBillLeaseKey('org1', 'bill1');
    const order: string[] = [];
    async function guarded(tag: string) {
      return withAggregateLease(key, 'mock', async (handle) =>
        commitLeasedWrite(handle, 'mock', async () => {
          order.push(`${tag}:start`);
          await new Promise((r) => setTimeout(r, 5));
          order.push(`${tag}:end`);
        }),
      );
    }
    await Promise.all([guarded('A'), guarded('B')]);
    // Whichever ran first fully completed before the other started — no interleave.
    const startA = order.indexOf('A:start');
    const endA = order.indexOf('A:end');
    const startB = order.indexOf('B:start');
    const endB = order.indexOf('B:end');
    const aFirst = startA < startB;
    expect(aFirst ? endA < startB : endB < startA).toBe(true);
  });

  it('different aggregate keys do not contend (run concurrently)', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    async function guarded(key: string) {
      return withAggregateLease(key, 'mock', async (handle) =>
        commitLeasedWrite(handle, 'mock', async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 5));
          concurrent--;
        }),
      );
    }
    await Promise.all([
      guarded(vendorBillLeaseKey('org1', 'billA')),
      guarded(vendorBillLeaseKey('org1', 'billB')),
      guarded(purchaseOrderLeaseKey('org1', 'poA')),
    ]);
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});
