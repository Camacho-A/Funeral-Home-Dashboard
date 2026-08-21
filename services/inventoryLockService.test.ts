import { beforeEach, describe, expect, it } from 'vitest';
import { inventoryLockFixtures, inventoryWriteClaimFixtures } from './__mocks__/merchandiseFixtures';
import { withInventoryLock, commitProtectedWrite, stockLineLockKey, InventoryLockLeaseLostError } from './inventoryLockService';

beforeEach(() => {
  inventoryLockFixtures.length = 0;
  inventoryWriteClaimFixtures.length = 0;
});

describe('inventoryLockService', () => {
  it('serializes two operations on the SAME stock line', async () => {
    const key = stockLineLockKey('org-1', 'loc-1', 'p-1');
    const order: string[] = [];

    const first = withInventoryLock(key, 'mock', async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('first-end');
    });
    // Small stagger so `first` acquires before `second` attempts.
    await new Promise((r) => setTimeout(r, 5));
    const second = withInventoryLock(key, 'mock', async () => {
      order.push('second-start');
      order.push('second-end');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('runs operations on DIFFERENT stock lines in parallel (no cross-line serialization)', async () => {
    const keyA = stockLineLockKey('org-1', 'loc-1', 'p-A');
    const keyB = stockLineLockKey('org-1', 'loc-1', 'p-B');
    const order: string[] = [];

    const a = withInventoryLock(keyA, 'mock', async () => {
      order.push('A-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('A-end');
    });
    const b = withInventoryLock(keyB, 'mock', async () => {
      order.push('B-start');
      order.push('B-end');
    });

    await Promise.all([a, b]);
    // B (different line) does not wait for A to finish.
    expect(order.indexOf('B-start')).toBeLessThan(order.indexOf('A-end'));
  });

  it('releases the lease so a later operation can acquire it', async () => {
    const key = stockLineLockKey('org-1', 'loc-1', 'p-1');
    await withInventoryLock(key, 'mock', async () => {
      expect(inventoryLockFixtures).toHaveLength(1);
    });
    expect(inventoryLockFixtures).toHaveLength(0); // released
    // Second acquisition succeeds cleanly.
    await expect(withInventoryLock(key, 'mock', async () => 'ok')).resolves.toBe('ok');
  });

  it('commitProtectedWrite serializes and releases the write claim', async () => {
    const key = stockLineLockKey('org-1', 'loc-1', 'p-1');
    const result = await withInventoryLock(key, 'mock', async (handle) => {
      return commitProtectedWrite(handle, 'mock', async () => {
        expect(inventoryWriteClaimFixtures).toHaveLength(1);
        return 42;
      });
    });
    expect(result).toBe(42);
    expect(inventoryWriteClaimFixtures).toHaveLength(0); // claim released
  });

  it('exports a typed lease-lost error', () => {
    expect(new InventoryLockLeaseLostError('x')).toBeInstanceOf(Error);
  });
});
