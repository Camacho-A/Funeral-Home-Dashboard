import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem } from '../lib/wixDataApi';
import {
  mapWixLoginActivityEventItem,
  buildWixLoginActivityEventData,
  type WixLoginActivityEventItem,
} from '../lib/wixLoginActivityEventMapper';
import type { LoginActivityEvent, LoginActivityEventType } from '../types/loginActivityEvent';
import {
  FAILED_ATTEMPT_WINDOW_MS,
  isLockExpired,
  shouldLockAccount,
} from '../domain/identity/lockoutPolicy';
import { getIdentityById, updateIdentity } from './identityService';
import { loginActivityEventFixtures } from './__mocks__/identityFixtures';

/**
 * Phase 21 (Identity, Authentication & Session Management). Brute-force
 * protection, account lockout, and login-activity recording — all backed
 * by the same `loginActivityEvents` collection ("Track: identityId,
 * organizationId, timestamp, ipAddress, userAgent, eventType"), rather
 * than a separate failed-attempt counter field: the count *is* the number
 * of recent `login_failed` events, so the audit trail and the lockout
 * decision can never drift apart from each other.
 */
function nowIso(): string {
  return new Date().toISOString();
}

export async function recordLoginActivity(
  params: { identityId: string | null; organizationId?: string | null; eventType: LoginActivityEventType; ipAddress?: string | null; userAgent?: string | null; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<LoginActivityEvent> {
  const event: LoginActivityEvent = {
    id: params.idFactory(),
    identityId: params.identityId,
    organizationId: params.organizationId ?? null,
    eventType: params.eventType,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    timestamp: nowIso(),
  };

  if (dataAdapterMode === 'mock') {
    loginActivityEventFixtures.push(event);
    return event;
  }

  await insertWixDataItem<WixLoginActivityEventItem>('loginActivityEvents', buildWixLoginActivityEventData(event), event.id);
  return event;
}

/** Counts `login_failed` events for this identity within the lockout
    window. Fetches every event for the identity and filters by timestamp
    in application code — deliberately not relying on an unverified Wix
    Data range-filter operator (`$gte`) that no other part of this
    codebase has ever empirically confirmed works. */
export async function countRecentFailedAttempts(identityId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const windowStart = Date.now() - FAILED_ATTEMPT_WINDOW_MS;

  const all =
    dataAdapterMode === 'mock'
      ? loginActivityEventFixtures.filter((e) => e.identityId === identityId && e.eventType === 'login_failed')
      : await (async () => {
          const response = await queryWixDataItems<WixLoginActivityEventItem>('loginActivityEvents', {
            filter: { identityId, eventType: 'login_failed' },
          });
          return response.dataItems.map((item) => mapWixLoginActivityEventItem(item.data)).filter((e): e is LoginActivityEvent => e !== null);
        })();

  return all.filter((e) => new Date(e.timestamp).getTime() >= windowStart).length;
}

/** Called after a failed login attempt for a *known* identity (an unknown
    email is logged via `recordLoginActivity` with `identityId: null`
    directly by the caller — this function never runs for one, since
    there's no account to lock). Locks the account once the recent-failure
    threshold is reached. */
export async function checkAndApplyLockout(identityId: string, dataAdapterMode: DataAdapterMode): Promise<{ locked: boolean }> {
  const recentFailures = await countRecentFailedAttempts(identityId, dataAdapterMode);
  if (!shouldLockAccount(recentFailures)) return { locked: false };

  await updateIdentity(identityId, { status: 'locked' }, dataAdapterMode);
  return { locked: true };
}

/** A lock is not a one-way trip — reactivates an identity whose lockout
    window has naturally expired. Returns the (possibly updated)
    identity's current status via a fresh read. */
export async function unlockIfExpired(identityId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const identity = await getIdentityById(identityId, dataAdapterMode);
  if (!identity || identity.status !== 'locked') return false;
  if (!isLockExpired(identity.updatedAt)) return false;

  await updateIdentity(identityId, { status: 'active' }, dataAdapterMode);
  return true;
}
