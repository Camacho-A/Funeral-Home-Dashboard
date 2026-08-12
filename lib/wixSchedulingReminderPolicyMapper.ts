import type { SchedulingReminderPolicy } from '../types/schedulingReminderPolicy';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). Standard mapper pair for the `schedulingReminderPolicies`
 * collection — one row per organization, `id = organizationId`.
 * `leadTimesMinutes` is stored as JSON-serialized Text, mirroring
 * `notificationPreferences.categoryOverrides`'s exact Phase 33
 * precedent (a small, bounded array/object that doesn't warrant a
 * dedicated Wix array field type) — parsed/stringified only inside this
 * file, degrading gracefully (never throwing) on malformed data.
 */
export type WixSchedulingReminderPolicyItem = {
  organizationId?: unknown;
  leadTimesMinutes?: unknown;
  notifyOwner?: unknown;
  notifyFamily?: unknown;
  updatedAt?: unknown;
};

function parseLeadTimesMinutes(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'number') ? parsed : [];
  } catch {
    return [];
  }
}

export function mapWixSchedulingReminderPolicyItem(item: WixSchedulingReminderPolicyItem | undefined): SchedulingReminderPolicy | null {
  if (!item || typeof item.organizationId !== 'string' || typeof item.notifyOwner !== 'boolean' || typeof item.notifyFamily !== 'boolean' || typeof item.updatedAt !== 'string') {
    return null;
  }

  return {
    organizationId: item.organizationId,
    leadTimesMinutes: parseLeadTimesMinutes(item.leadTimesMinutes),
    notifyOwner: item.notifyOwner,
    notifyFamily: item.notifyFamily,
    updatedAt: item.updatedAt,
  };
}

export function buildWixSchedulingReminderPolicyData(policy: SchedulingReminderPolicy): WixSchedulingReminderPolicyItem {
  return {
    organizationId: policy.organizationId,
    leadTimesMinutes: JSON.stringify(policy.leadTimesMinutes),
    notifyOwner: policy.notifyOwner,
    notifyFamily: policy.notifyFamily,
    updatedAt: policy.updatedAt,
  };
}

export function applySchedulingReminderPolicyUpdateToWixData(
  existing: WixSchedulingReminderPolicyItem,
  patch: { leadTimesMinutes?: number[]; notifyOwner?: boolean; notifyFamily?: boolean; updatedAt: string },
): WixSchedulingReminderPolicyItem {
  const next = { ...existing, updatedAt: patch.updatedAt };
  if (patch.leadTimesMinutes !== undefined) next.leadTimesMinutes = JSON.stringify(patch.leadTimesMinutes);
  if (patch.notifyOwner !== undefined) next.notifyOwner = patch.notifyOwner;
  if (patch.notifyFamily !== undefined) next.notifyFamily = patch.notifyFamily;
  return next;
}
