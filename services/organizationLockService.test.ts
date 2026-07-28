import { describe, it, expect } from 'vitest';
import { withOrganizationRoleLock, assertFenceStillCurrent, commitProtectedWrite, OrganizationLockError, LockLeaseLostError } from './organizationLockService';
import { organizationRoleLockFixtures, organizationRoleWriteClaimFixtures } from './__mocks__/rbacFixtures';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('withOrganizationRoleLock', () => {
  it('runs the callback and releases the lease afterward', async () => {
    const orgId = 'lease-test-basic';
    const result = await withOrganizationRoleLock(orgId, 'mock', async () => 'done');
    expect(result).toBe('done');
    expect(organizationRoleLockFixtures.some((l) => l.organizationId === orgId)).toBe(false);
  });

  it('releases the lease even if the callback throws', async () => {
    const orgId = 'lease-test-throws';
    await expect(
      withOrganizationRoleLock(orgId, 'mock', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(organizationRoleLockFixtures.some((l) => l.organizationId === orgId)).toBe(false);
  });

  it('serializes two concurrent callers — only one runs at a time, both eventually complete', async () => {
    const orgId = 'lease-test-concurrent';
    const order: string[] = [];

    const first = withOrganizationRoleLock(orgId, 'mock', async () => {
      order.push('first-start');
      await sleep(30);
      order.push('first-end');
    });
    const second = withOrganizationRoleLock(orgId, 'mock', async () => {
      order.push('second-start');
      await sleep(10);
      order.push('second-end');
    });

    await Promise.all([first, second]);

    const firstIsFirst = order[0] === 'first-start';
    if (firstIsFirst) {
      expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    } else {
      expect(order).toEqual(['second-start', 'second-end', 'first-start', 'first-end']);
    }
  });

  it('throws OrganizationLockError if the lease cannot be acquired within the retry budget', async () => {
    const orgId = 'lease-test-exhausted';
    const now = Date.now();
    organizationRoleLockFixtures.push({ id: orgId, organizationId: orgId, lockToken: 'held-forever', fenceToken: 1, lockedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() });

    await expect(withOrganizationRoleLock(orgId, 'mock', async () => 'unreachable')).rejects.toThrow(OrganizationLockError);

    const index = organizationRoleLockFixtures.findIndex((l) => l.organizationId === orgId);
    if (index !== -1) organizationRoleLockFixtures.splice(index, 1);
  }, 10_000);

  describe('renewable lease — the second security-correction round', () => {
    it('an operation running longer than the original lease TTL completes safely via renewal', async () => {
      const orgId = 'lease-test-long-op';
      const result = await withOrganizationRoleLock(
        orgId,
        'mock',
        async (handle) => {
          // Deliberately longer than leaseTtlMs (100ms) below.
          await sleep(250);
          // Still valid — the renewal heartbeat (every 30ms) kept extending
          // the lease well past its original 100ms expiry.
          await assertFenceStillCurrent(handle, 'mock');
          return 'completed-past-original-ttl';
        },
        { leaseTtlMs: 100, renewIntervalMs: 30 },
      );
      expect(result).toBe('completed-past-original-ttl');
    });

    it('a competing acquisition during that long operation is refused until the first genuinely releases', async () => {
      const orgId = 'lease-test-competing-during-long-op';
      const order: string[] = [];

      const first = withOrganizationRoleLock(
        orgId,
        'mock',
        async () => {
          order.push('first-start');
          await sleep(250); // longer than the 100ms TTL
          order.push('first-end');
        },
        { leaseTtlMs: 100, renewIntervalMs: 30 },
      );

      await sleep(20); // ensure first has already acquired
      const second = withOrganizationRoleLock(
        orgId,
        'mock',
        async () => {
          order.push('second-start');
          order.push('second-end');
        },
        { leaseTtlMs: 100, renewIntervalMs: 30 },
      );

      await Promise.all([first, second]);

      // Without renewal, `second` would have reclaimed the lease around
      // t=100ms, while `first` was still running — this is exactly the
      // race this correction closes.
      expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    });

    it("an owner whose lease has been reclaimed cannot pass the ownership check release/renewal rely on, and cannot disturb the new owner's active lease", async () => {
      const orgId = 'lease-test-release-safety';
      const now = Date.now();
      // Simulate an abandoned holder ("A") whose lease already expired,
      // unaware its lease has lapsed.
      organizationRoleLockFixtures.push({
        id: orgId,
        organizationId: orgId,
        lockToken: 'holder-a-token',
        fenceToken: 1,
        lockedAt: new Date(now - 20_000).toISOString(),
        expiresAt: new Date(now - 10_000).toISOString(),
      });
      const staleHandleForA = { organizationId: orgId, lockToken: 'holder-a-token', fenceToken: 1 };

      let signalBToFinish!: () => void;
      const bMayFinish = new Promise<void>((resolve) => {
        signalBToFinish = resolve;
      });

      const bPromise = withOrganizationRoleLock(orgId, 'mock', async () => {
        // While B is still the active, holding owner: A's stale handle
        // must fail the exact ownership check release()/renewLease() use.
        await expect(assertFenceStillCurrent(staleHandleForA, 'mock')).rejects.toThrow(LockLeaseLostError);
        await bMayFinish;
        return 'b-completed';
      });

      signalBToFinish();
      const result = await bPromise;
      expect(result).toBe('b-completed');
      // B (the true owner) released cleanly afterward.
      expect(organizationRoleLockFixtures.some((l) => l.organizationId === orgId)).toBe(false);
    });

    it('fails closed if the lease is lost mid-operation, even though the wrapped operation itself "succeeded"', async () => {
      const orgId = 'lease-test-fail-closed';
      await expect(
        withOrganizationRoleLock(
          orgId,
          'mock',
          async (handle) => {
            // Simulate a competing reclaim landing mid-operation — directly
            // overwrite the stored row with a different owner's token, as a
            // genuine competing acquisition would once this lease lapses.
            const index = organizationRoleLockFixtures.findIndex((l) => l.organizationId === orgId);
            organizationRoleLockFixtures[index] = { ...organizationRoleLockFixtures[index], lockToken: 'someone-else', fenceToken: handle.fenceToken + 1 };
            // Give the renewal heartbeat a chance to run and detect this.
            await sleep(60);
            return 'looks-like-success';
          },
          { leaseTtlMs: 500, renewIntervalMs: 20 },
        ),
      ).rejects.toThrow(LockLeaseLostError);
    });

    it('allows a new acquisition once an abandoned lease has genuinely expired (crashed-process recovery), advancing the fence', async () => {
      const orgId = 'lease-test-crash-recovery';
      const now = Date.now();
      organizationRoleLockFixtures.push({
        id: orgId,
        organizationId: orgId,
        lockToken: 'crashed-holder',
        fenceToken: 5,
        lockedAt: new Date(now - 20_000).toISOString(),
        expiresAt: new Date(now - 10_000).toISOString(),
      });

      let observedFence = -1;
      const result = await withOrganizationRoleLock(orgId, 'mock', async (handle) => {
        observedFence = handle.fenceToken;
        return 'recovered';
      });
      expect(result).toBe('recovered');
      expect(observedFence).toBe(6); // advanced past the crashed holder's fence (5)
    });
  });

  describe('write claims — the third security-correction round (stale-writer rejection)', () => {
    it('a live write claim structurally blocks reclaim of an otherwise-expired lease', async () => {
      const orgId = 'write-claim-blocks-reclaim';
      const now = Date.now();
      organizationRoleLockFixtures.push({
        id: orgId,
        organizationId: orgId,
        lockToken: 'holder-a',
        fenceToken: 1,
        lockedAt: new Date(now - 20_000).toISOString(),
        expiresAt: new Date(now - 1_000).toISOString(), // the lease itself is expired
      });
      organizationRoleWriteClaimFixtures.push({
        id: orgId,
        organizationId: orgId,
        lockToken: 'holder-a',
        fenceToken: 1,
        claimedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 5_000).toISOString(), // but A's write claim is still live
      });

      // A second acquirer must be refused for as long as the claim is live,
      // even though the lease's own expiry has long passed — exhausting the
      // acquire retry budget rather than reclaiming out from under A.
      await expect(withOrganizationRoleLock(orgId, 'mock', async () => 'unreachable')).rejects.toThrow(OrganizationLockError);

      const lockIndex = organizationRoleLockFixtures.findIndex((l) => l.organizationId === orgId);
      if (lockIndex !== -1) organizationRoleLockFixtures.splice(lockIndex, 1);
      const claimIndex = organizationRoleWriteClaimFixtures.findIndex((c) => c.organizationId === orgId);
      if (claimIndex !== -1) organizationRoleWriteClaimFixtures.splice(claimIndex, 1);
    }, 10_000);

    it(
      'the exact adversarial sequence: A passes its final fence check, is paused, B reclaims the lease and completes its own write, A resumes — ' +
        "A's stale protected write is rejected by commitProtectedWrite and produces no state change",
      async () => {
        const orgId = 'stale-writer-exact-sequence';
        let target = 'original';
        let resumeA!: () => void;
        const pauseA = new Promise<void>((resolve) => {
          resumeA = resolve;
        });

        const aPromise = withOrganizationRoleLock(orgId, 'mock', async (handleA) => {
          // (1) "holder A successfully performs its final fence check" —
          await assertFenceStillCurrent(handleA, 'mock');
          // (2) "pause A before its protected write" — A is suspended here,
          // having already passed its check but not yet having claimed the
          // write slot or performed any mutation. This reproduces exactly
          // the second round's vulnerable pattern (check, then later,
          // separately, write) that this correction round's write claim
          // exists to catch.
          await pauseA;
          // (6) "resume A" — A now attempts its protected write, exactly as
          // every real guarded mutation in roleService.ts does: routed
          // through commitProtectedWrite.
          return commitProtectedWrite(handleA, 'mock', async () => {
            target = 'set-by-stale-a';
            return 'a-write-completed';
          });
        });

        // Give A's callback a moment to reach and pass its fence check
        // before interfering — well under the 3s renewal heartbeat, so
        // A's own renewal never fires during this window.
        await sleep(20);

        // (3) "allow A's lease to expire" — forced deterministically. A has
        // not yet taken a write claim (it is paused before
        // commitProtectedWrite even runs), so nothing blocks reclaim.
        const lockIndex = organizationRoleLockFixtures.findIndex((l) => l.organizationId === orgId);
        organizationRoleLockFixtures[lockIndex] = { ...organizationRoleLockFixtures[lockIndex], expiresAt: new Date(Date.now() - 1_000).toISOString() };

        // (4) "holder B reclaims the lease and advances the fence"
        // (5) "holder B performs its protected mutation"
        await withOrganizationRoleLock(orgId, 'mock', async (handleB) => {
          expect(handleB.fenceToken).toBe(2); // advanced past A's fenceToken (1)
          return commitProtectedWrite(handleB, 'mock', async () => {
            target = 'set-by-b';
            return 'b-write-completed';
          });
        });

        // (6)/(7) resume A. A is no longer the lease's current owner — its
        // commitProtectedWrite call must reject before ever invoking its
        // performWrite callback.
        resumeA();

        await expect(aPromise).rejects.toThrow(LockLeaseLostError);
        expect(target).toBe('set-by-b'); // A's stale write produced no state change
      },
    );

    it('commitProtectedWrite retries the write claim on contention, succeeding only after the holder releases', async () => {
      const orgId = 'write-claim-retry';
      await withOrganizationRoleLock(orgId, 'mock', async (handle) => {
        let firstReleased = false;

        const first = commitProtectedWrite(handle, 'mock', async () => {
          await sleep(120);
          firstReleased = true;
          return 'first-done';
        });

        await sleep(10); // ensure `first` has already taken the claim
        const second = commitProtectedWrite(handle, 'mock', async () => {
          // If `second` ever proceeds before `first` released, this proves
          // the claim did not actually serialize the two writes.
          expect(firstReleased).toBe(true);
          return 'second-done';
        });

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult).toBe('first-done');
        expect(secondResult).toBe('second-done');
      });
    });

    it('commitProtectedWrite fails closed if the write claim can never be acquired within its retry budget', async () => {
      const orgId = 'write-claim-bounded-failure';
      await withOrganizationRoleLock(orgId, 'mock', async (handle) => {
        const blocker = commitProtectedWrite(handle, 'mock', async () => {
          await sleep(2_000); // far longer than CLAIM_MAX_ATTEMPTS * CLAIM_RETRY_DELAY_MS (10 * 50ms = 500ms)
          return 'blocker-done';
        });

        await sleep(10);
        await expect(commitProtectedWrite(handle, 'mock', async () => 'unreachable')).rejects.toThrow(LockLeaseLostError);
        await blocker;
      });
    }, 10_000);
  });
});
