import type { DataAdapterMode } from '../lib/env';
import { listAllQueuedForDigestDeliveries, flushDigestGroup, getPreferences } from './notificationService';
import { getForOrganization as getOrganizationForDigest } from './organizationsService';
import { isDigestGroupEligible } from '../domain/notifications/digestTiming';
import type { NotificationDelivery } from '../types/notificationDelivery';

/**
 * Phase 33 (Real Notification Delivery). The thin, cron-triggered
 * orchestrator behind digest batching and quiet-hours deferral — see
 * docs/adr/ADR-037-real-notification-delivery.md's own "Finding" section
 * for why this exists at all (Beacon has no background/scheduled-job
 * mechanism anywhere else; `vercel.json` + `app/api/cron/notification-digest/route.ts`
 * are the two other pieces of this same primitive).
 *
 * Deliberately thin: every actual read/write of the 5 notification
 * collections, and every channel send, happens inside
 * `notificationService.ts` — `listAllQueuedForDigestDeliveries` and
 * `flushDigestGroup` are the only two functions this file calls into it
 * (structurally enforced, see `notificationService.test.ts`'s own
 * boundary tests). This file's own job is purely: group, decide
 * eligibility, and call the flush.
 */

export type DigestSweepResult = {
  groupsConsidered: number;
  groupsFlushed: number;
  groupsSkipped: number;
  deliveriesFlushed: number;
};

function groupByOrganizationAndIdentity(deliveries: NotificationDelivery[]): Map<string, NotificationDelivery[]> {
  const groups = new Map<string, NotificationDelivery[]>();
  for (const delivery of deliveries) {
    const key = `${delivery.organizationId}::${delivery.identityId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(delivery);
    } else {
      groups.set(key, [delivery]);
    }
  }
  return groups;
}

/**
 * Runs one sweep: finds every queued delivery across every organization,
 * groups by (organizationId, identityId), re-checks each group's
 * eligibility against that identity's *current* preference (never a
 * snapshot taken when the row was queued), and flushes every group
 * that's actually due. A group not yet eligible is left untouched,
 * exactly as queued, for a later sweep — never force-flushed just
 * because a sweep happened to run.
 */
export async function runNotificationDigestSweep(dataAdapterMode: DataAdapterMode, now?: string): Promise<DigestSweepResult> {
  const nowIso = now ?? new Date().toISOString();
  const queued = await listAllQueuedForDigestDeliveries(dataAdapterMode);
  const groups = groupByOrganizationAndIdentity(queued);

  const result: DigestSweepResult = { groupsConsidered: groups.size, groupsFlushed: 0, groupsSkipped: 0, deliveriesFlushed: 0 };

  for (const [key, deliveries] of groups) {
    const [organizationId, identityId] = key.split('::');
    const [preference, organization] = await Promise.all([
      getPreferences(organizationId, identityId, dataAdapterMode),
      getOrganizationForDigest(organizationId, dataAdapterMode),
    ]);

    const eligible = isDigestGroupEligible({
      digestFrequency: preference.digestFrequency,
      lastDigestSentAt: preference.lastDigestSentAt,
      quietHoursStart: preference.quietHoursStart,
      quietHoursEnd: preference.quietHoursEnd,
      timezone: organization?.timezone,
      nowIso,
    });

    if (!eligible) {
      result.groupsSkipped += 1;
      continue;
    }

    await flushDigestGroup(organizationId, identityId, deliveries, dataAdapterMode);
    result.groupsFlushed += 1;
    result.deliveriesFlushed += deliveries.length;
  }

  return result;
}
