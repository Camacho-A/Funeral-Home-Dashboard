/**
 * Phase 24 (Case Activity Timeline & Audit Center). The single, general
 * event envelope every module in Beacon records into — see ADR-028 for the
 * full rationale. `organizationRoleAuditEntries` (Phase 22),
 * `caseOrderAuditEntries` (Phase 19C), `onboardingAuditEntries` (Phase 20),
 * and `loginActivityEvents` (Phase 21) are deliberately left untouched;
 * this is the general shape those four are each a special case of, not a
 * replacement for them in this phase.
 *
 * **Append-only, immutable, permanently.** No route, service function, or
 * UI action ever updates or deletes a row here — see
 * `services/activityService.ts`'s own comment. A correction to a past
 * event is always a *new* event, never an edit to an old one.
 */
export type ActivityEventCategory =
  | 'authentication'
  | 'team_management'
  | 'cases'
  | 'payments'
  | 'documents'
  | 'workflow'
  | 'scheduling'
  | 'inventory'
  | 'notifications'
  | 'administration'
  | 'system';

export type ActivitySeverity = 'info' | 'warning' | 'critical';

export type ActivityEvent = {
  id: string;
  /** Starts at 1. Lets a given `eventType`'s payload shape evolve later
      without breaking how old rows are read. */
  eventVersion: number;
  organizationId: string;
  caseId: string | null;
  /** Null only when `isSystemGenerated` is true. */
  actorIdentityId: string | null;
  actorMembershipId: string | null;
  /** The actor's role *at the time* of the event — snapshotted, since a
      membership's role can change afterward and the historical record
      should reflect what was true when the action happened. */
  actorRoleKey: string | null;
  category: ActivityEventCategory;
  /** A controlled, stable, dot-notation machine identifier — see
      `ACTIVITY_EVENT_TYPES` below. Never used to derive display text;
      `description` carries that separately. */
  eventType: string;
  resourceType: string;
  resourceId: string | null;
  /** JSON-stringified. Changed fields only (or a compact identifying
      subset for creation events) — never a full entity snapshot. See
      `services/activityService.ts`'s `record()` for the enforcement. */
  previousValue: string | null;
  newValue: string | null;
  /** Precomposed, human-readable line — kept fully separate from
      `eventType` so the identifier can stay stable while the copy evolves. */
  description: string;
  /** JSON-stringified free-form context (e.g. a correction event's
      back-reference to the event it corrects). */
  metadata: string | null;
  severity: ActivitySeverity;
  /** Required whenever one user action produces more than one event (e.g.
      one request that both changes a case's stage and auto-completes a
      task) — generated once per request, threaded through every
      `record*` call within it, never invented per-event independently. */
  correlationId: string | null;
  isSystemGenerated: boolean;
  createdAt: string;
};

/**
 * The controlled event-type registry. Every `record*` builder helper in
 * `services/activityService.ts` uses exactly one of these — nothing in
 * this codebase ever passes an ad hoc `eventType` string to `record()`
 * directly. Entries marked "reserved" exist so a future phase only needs
 * to add a builder helper and a call site, never a data-model change; see
 * ADR-028 for exactly which reserved entries have no real emitter yet and
 * why (unimplemented features, or legacy writers intentionally not
 * migrated this phase).
 */
export const ACTIVITY_EVENT_TYPES = {
  CASE_CREATED: 'case.created',
  CASE_UPDATED: 'case.updated',
  CASE_STAGE_CHANGED: 'case.stage.changed',
  /** Reserved — discovered during implementation, not assumed in
      planning: `services/caseLogService.ts` has no server-side or Wix
      integration at all, in any mode (pure client-side mock fixtures,
      zero API route) — there is no real mutation to hook an emitter into
      today. `recordCaseNoteAdded` exists as a builder for when that
      changes. */
  CASE_NOTE_ADDED: 'case.note.added',
  CASE_CONTACT_LOGGED: 'case.contact.logged',
  CASE_TASK_CREATED: 'case.task.created',
  CASE_TASK_COMPLETED: 'case.task.completed',
  CASE_ORDER_CHANGED: 'case.order.changed',

  PAYMENT_CHECKOUT_CREATED: 'payment.checkout.created',
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_CANCELLED: 'payment.cancelled',
  /** Reserved — no refund code path exists in Beacon yet. */
  PAYMENT_REFUNDED: 'payment.refunded',

  /** Reserved — no persisted document backend exists yet
      (`services/documentsService.ts` is mock-fixtures-only). */
  DOCUMENT_UPLOADED: 'document.uploaded',
  /** Reserved — document generation is unimplemented. */
  DOCUMENT_GENERATED: 'document.generated',
  /** Reserved — document signing is unimplemented. */
  DOCUMENT_SIGNED: 'document.signed',

  /** Reserved this phase — `roleService`/`invitationService` keep their
      own `organizationRoleAuditEntries` writer; not migrated (ADR-028). */
  TEAM_MEMBER_INVITED: 'team.member.invited',
  TEAM_MEMBER_ROLE_CHANGED: 'team.member.role.changed',
  TEAM_MEMBER_STATUS_CHANGED: 'team.member.status.changed',
  TEAM_INVITATION_REVOKED: 'team.invitation.revoked',

  /** Reserved — `loginActivityEvents` keeps its own writer. */
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILED: 'auth.login.failed',

  /** Reserved — no integration point built this phase (a same-shape
      fast-follow to `CASE_ORDER_CHANGED`). */
  WORKFLOW_TEMPLATE_UPDATED: 'workflow.template.updated',
  WORKFLOW_TEMPLATE_PUBLISHED: 'workflow.template.published',

  /** Reserved — `onboardingAuditEntries` keeps its own writer. */
  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',

  /** Reserved — no reminder/automation engine exists in Beacon at all yet. */
  SYSTEM_REMINDER_TRIGGERED: 'system.reminder.triggered',
  SYSTEM_WORKFLOW_AUTOMATION_EXECUTED: 'system.workflow_automation.executed',
} as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[keyof typeof ACTIVITY_EVENT_TYPES];

export type NewActivityEventInput = Omit<ActivityEvent, 'id' | 'eventVersion' | 'createdAt'>;
