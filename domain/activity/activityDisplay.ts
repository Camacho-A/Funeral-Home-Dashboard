import type { ActivityEvent, ActivityEventCategory, ActivityEventType, ActivitySeverity } from '@/types/activityEvent';
import type { BadgeVariant } from '@/components/ui/Badge';
import { resolveRoleKeyAlias } from '@/domain/rbac/legacyRoleAliases';
import { isDefaultRoleKey, defaultRoleDefinition } from '@/domain/rbac/defaultRoles';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). Which ActivitySeverity
 * maps to which Badge variant/label — a domain decision, kept out of
 * components/case/CaseActivityTab.tsx and components/settings/ActivityEventList.tsx
 * per Badge's own convention (see components/ui/Badge.tsx's comment) that a
 * UI primitive never decides what a business condition means. Matches
 * domain/cases/paymentDisplay.ts's shape for the same kind of decision.
 */
export const ACTIVITY_SEVERITY_LABEL: Record<ActivitySeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

export function activitySeverityVariant(severity: ActivitySeverity): BadgeVariant {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'brand';
  return 'neutral';
}

/**
 * Item #16 (Case Activity actor attribution). The single, authoritative
 * answer to "who should this event's actor line say performed it?" —
 * shared by every Activity surface so no second, competing formatter can
 * exist. `isSystemGenerated` is the ONLY signal ever consulted to decide
 * "System" — never inferred from a missing/null `actorRoleKey`, an
 * "Office"-sounding role, or the event's own description text, per the
 * business rule that a human action must never be silently relabeled
 * System just because some other field looks automatic.
 *
 * For a genuinely human event, the raw `actorRoleKey` (e.g. `officeStaff`)
 * is resolved through the *existing* role vocabulary — first
 * `legacyRoleAliases.ts` (so a pre-Phase-22 role string like `staff` or
 * `caseManager` still resolves), then `defaultRoles.ts`'s own friendly
 * `name` (e.g. `officeStaff` -> "Office Staff") — the same catalog
 * `TeamMemberList.tsx` already uses, never a second role-label system. A
 * custom, org-defined role key that isn't in that catalog falls back to
 * the raw key itself (exactly `TeamMemberList.tsx`'s own `?? member.role`
 * fallback), rather than inventing a label for a role this function has no
 * definition for.
 */
export function activityActorLabel(event: { isSystemGenerated: boolean; actorRoleKey: string | null }): string {
  if (event.isSystemGenerated) return 'System';
  if (!event.actorRoleKey) return 'Unknown';
  const resolvedKey = resolveRoleKeyAlias(event.actorRoleKey);
  return isDefaultRoleKey(resolvedKey) ? defaultRoleDefinition(resolvedKey).name : event.actorRoleKey;
}

/**
 * Task #4 follow-up (2026-09). Before this fix, `document.regenerated`
 * events persisted their internal supersededId directly in `description`
 * ("Document regenerated (supersedes 1d13e80e-...)") — a document's own
 * UUID is not staff-facing information, and it leaked straight into
 * Dashboard → Recent Activity. `services/activityService.ts#recordDocumentRegenerated`
 * no longer writes the UUID into new events' `description` (the
 * structured relationship still lives in `previousValue`, untouched, for
 * internal audit/document-lineage purposes), but historical rows already
 * persisted with the old text cannot be rewritten (no Production data
 * migration) — this is the presentation-layer safety net that makes
 * those legacy rows display safely too, without ever touching the
 * underlying record. A small, explicit, event-type-keyed allowlist —
 * deliberately never a generic "strip anything UUID-shaped" regex, which
 * could damage legitimate staff-facing text elsewhere. Event types not
 * listed here render their own persisted `description` unchanged.
 */
const CANONICAL_DISPLAY_DESCRIPTION_BY_EVENT_TYPE: Partial<Record<ActivityEventType, string>> = {
  'document.regenerated': 'Document regenerated',
};

export function resolveActivityDisplayDescription(event: Pick<ActivityEvent, 'eventType' | 'description'>): string {
  // ActivityEvent.eventType is persisted/read back as a plain `string`
  // (see its own field comment — never assumed to still match the
  // current ActivityEventType union). The cast is read-only/safe here: an
  // event type outside the union simply finds no match below and falls
  // through to the event's own persisted description, unchanged.
  return CANONICAL_DISPLAY_DESCRIPTION_BY_EVENT_TYPE[event.eventType as ActivityEventType] ?? event.description;
}

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityEventCategory, string> = {
  authentication: 'Authentication',
  team_management: 'Team',
  cases: 'Cases',
  payments: 'Payments',
  documents: 'Documents',
  workflow: 'Workflow',
  scheduling: 'Scheduling',
  inventory: 'Inventory',
  notifications: 'Notifications',
  administration: 'Administration',
  family_portal: 'Family Portal',
  system: 'System',
  financial: 'Financial',
  procurement: 'Procurement',
  external_form: 'External Forms',
};
