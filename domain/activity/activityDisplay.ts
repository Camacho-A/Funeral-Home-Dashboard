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
 * "System" — never inferred from a missing/null `actorRoleKey`, a missing
 * `actorDisplayName`, an "Office"-sounding role, or the event's own
 * description text, per the business rule that a human action must never
 * be silently relabeled System just because some other field looks
 * automatic.
 *
 * Recent Activity name-attribution fix (2026-09): a human event now
 * answers "who actually did this?" with the real employee's current
 * display name — `actorDisplayName`, resolved server-side per request via
 * `services/activityService.ts#attachActorDisplayNames` (from the event's
 * own recorded `actorIdentityId`, the same `getIdentityById` source
 * `GET /api/rbac/members` already trusts), never derived from the
 * currently signed-in viewer. A role was never the right answer to "who" —
 * it answers "what permissions did they have" — so the role-label
 * fallback below now only fires for the genuinely legacy/unresolvable
 * case: `actorDisplayName` is `null` (the identity no longer exists, or
 * the caller's read path didn't attach one) but a role snapshot is still
 * available, resolved through the *existing* role vocabulary — first
 * `legacyRoleAliases.ts` (so a pre-Phase-22 role string like `staff` or
 * `caseManager` still resolves), then `defaultRoles.ts`'s own friendly
 * `name` (e.g. `officeStaff` -> "Office Staff") — the same catalog
 * `TeamMemberList.tsx` already uses, never a second role-label system. A
 * custom, org-defined role key that isn't in that catalog falls back to
 * the raw key itself (exactly `TeamMemberList.tsx`'s own `?? member.role`
 * fallback). With neither a name nor a role to go on, falls back to
 * "Unknown" — never invented, never the viewer.
 */
export function activityActorLabel(event: { isSystemGenerated: boolean; actorRoleKey: string | null; actorDisplayName?: string | null }): string {
  if (event.isSystemGenerated) return 'System';
  if (event.actorDisplayName) return event.actorDisplayName;
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

/**
 * Raw-field-name leak fix (2026-10). `services/activityService.ts#recordCaseUpdated`
 * persists `Case updated (<field>[, <field>...])`, where each `<field>` is
 * literally `Object.keys(changedFields)` from `PATCH /api/cases/[caseId]`
 * — i.e. any key `lib/wixCaseMapper.ts#validateAndPickCaseUpdate` accepts
 * (`certifierPhone`, `nextOfKinEmail`, `tagNumber`, etc.), joined verbatim.
 * The previous fix here only relabeled the single exact string "Case
 * updated (checklistState)" — every OTHER field name (certifierPhone
 * included) still rendered raw on Recent Activity, which is the bug this
 * closes. `CASE_UPDATED_FIELD_LABEL` is the single curated list for every
 * field name `validateAndPickCaseUpdate` actually accepts and that isn't
 * already carved out into its own specific event (the
 * stage/returnMethod/shipping-* fields never reach this generic bucket at
 * all — see that route's own `SHIPPING_EVENT_FIELDS` set). `daysWaitingInStage`
 * and `isDeleted` are deliberately NOT curated — they're system/internal-
 * leaning fields a staff member never directly edits via a form, so they
 * fall through to the safe generic fallback below rather than guessing at
 * user-facing wording for them.
 */
const CASE_UPDATED_FIELD_LABEL: Partial<Record<string, string>> = {
  decedentName: 'Decedent name updated',
  dateOfBirth: 'Date of birth updated',
  dateOfDeath: 'Date of death updated',
  timeOfDeath: 'Time of death updated',
  placeOfDeath: 'Place of death updated',
  weight: 'Weight updated',
  nextOfKinName: 'Next of kin name updated',
  nextOfKinPhone: 'Next of kin phone updated',
  nextOfKinEmail: 'Next of kin email updated',
  nextOfKinRelationship: 'Next of kin relationship updated',
  nextOfKinRelationshipOther: 'Next of kin relationship updated',
  certifierName: 'Certifier name updated',
  certifierPhone: 'Certifier phone updated',
  certifierLicenseNumber: 'Certifier license number updated',
  certifierFax: 'Certifier fax updated',
  tagNumber: 'Tag number updated',
  pickupStatus: 'Pickup status updated',
  pickupReleasedTo: 'Pickup release info updated',
  pickupReleasedAt: 'Pickup release info updated',
  pickupNote: 'Pickup note updated',
  isVeteran: 'Veteran status updated',
  isStalled: 'Stalled status updated',
  stalledReason: 'Stalled reason updated',
  assignedStaffId: 'Assigned staff updated',
  checklistState: 'Checklist updated',
  fieldValues: 'Case details updated',
  vaStepsState: 'VA steps updated',
  vaPublishChoice: 'VA publish preference updated',
  vaNotificationResponsibility: 'VA notification responsibility updated',
  paymentStatus: 'Payment status updated',
};

const CASE_UPDATED_PATTERN = /^Case updated \((.+)\)$/;

/**
 * Presentation-only parse of the persisted "Case updated (<fields>)"
 * description — never touches the stored event. A single curated field
 * gets its specific sentence ("Certifier phone updated"); a field with no
 * curated mapping, or more than one changed field at once, falls back to
 * the generic "Case updated" — safe either way, since neither path can
 * ever render a raw field key. Returns `null` when the description isn't
 * this shape at all, so the caller can fall through to its other rules.
 */
function resolveCaseUpdatedDisplay(description: string): string | null {
  const match = CASE_UPDATED_PATTERN.exec(description);
  if (!match) return null;
  const fields = match[1].split(',').map((field) => field.trim());
  if (fields.length === 1) {
    return CASE_UPDATED_FIELD_LABEL[fields[0]] ?? 'Case updated';
  }
  return 'Case updated';
}

export function resolveActivityDisplayDescription(event: Pick<ActivityEvent, 'eventType' | 'description'>): string {
  const caseUpdatedDisplay = resolveCaseUpdatedDisplay(event.description);
  if (caseUpdatedDisplay !== null) return caseUpdatedDisplay;
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
