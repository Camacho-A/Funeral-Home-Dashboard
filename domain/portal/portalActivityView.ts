import type { ActivityEvent } from '../../types/activityEvent';
import { ACTIVITY_EVENT_TYPES } from '../../types/activityEvent';

/**
 * Phase 29 (Family Portal & External Collaboration). A fixed allowlist —
 * never the full per-case `ActivityEvent` stream, never anything
 * workflow/administrative/internal. Only event types a family member has
 * a legitimate reason to see: a document became available, a signature
 * was completed, a payment was recorded, an appointment was
 * created/rescheduled/cancelled/completed, or a portal message was sent.
 * Case notes, task activity, team/role management, audit-log entries,
 * and every other category never appear here regardless of what
 * `services/activityService.ts`'s own filters would otherwise allow.
 */
export const FAMILY_VISIBLE_EVENT_TYPES: readonly string[] = [
  ACTIVITY_EVENT_TYPES.DOCUMENT_UPLOADED,
  ACTIVITY_EVENT_TYPES.DOCUMENT_GENERATED,
  ACTIVITY_EVENT_TYPES.SIGNATURE_COMPLETED,
  ACTIVITY_EVENT_TYPES.PAYMENT_RECORDED,
  ACTIVITY_EVENT_TYPES.APPOINTMENT_CREATED,
  ACTIVITY_EVENT_TYPES.APPOINTMENT_RESCHEDULED,
  ACTIVITY_EVENT_TYPES.APPOINTMENT_CANCELLED,
  ACTIVITY_EVENT_TYPES.APPOINTMENT_COMPLETED,
  ACTIVITY_EVENT_TYPES.PORTAL_MESSAGE_SENT,
];

export function isFamilyVisibleEventType(eventType: string): boolean {
  return FAMILY_VISIBLE_EVENT_TYPES.includes(eventType);
}

/**
 * An explicit allowlisting DTO — never a raw `ActivityEvent`. Excludes
 * `actorIdentityId`/`actorMembershipId`/`actorRoleKey` and
 * `correlationId` (both named explicitly forbidden on any family-facing
 * response), `resourceId` (an internal id with no family-facing meaning
 * on its own), `previousValue`/`newValue`/`metadata` (structured internal
 * diffs that may themselves reference internal field names), and
 * `organizationId`/`caseId` (redundant — already scoped by the route).
 */
export type PortalActivityView = {
  id: string;
  eventType: string;
  category: string;
  description: string;
  severity: string;
  createdAt: string;
};

export function buildPortalActivityView(event: ActivityEvent): PortalActivityView {
  return {
    id: event.id,
    eventType: event.eventType,
    category: event.category,
    description: event.description,
    severity: event.severity,
    createdAt: event.createdAt,
  };
}
