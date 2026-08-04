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

  /** Phase 25 (Document Generation & Template Management). Wired — a
      real persisted `services/documentService.ts` replaces the old
      mock-only `documentsService.ts` this event type was reserved
      against. */
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_GENERATED: 'document.generated',
  DOCUMENT_DOWNLOADED: 'document.downloaded',
  /** A regeneration is its own event, distinct from DOCUMENT_GENERATED —
      the prior document row is superseded, never edited (see this
      phase's Invariants). */
  DOCUMENT_REGENERATED: 'document.regenerated',
  DOCUMENT_ARCHIVED: 'document.archived',
  /** Reserved by Phase 25 for e-signatures — **superseded, never wired**.
      Phase 26 (Electronic Signatures & Authorization Workflows) uses the
      `document.signature.*` namespace below instead (SIGNATURE_COMPLETED
      in particular), for a consistent dot-notation family alongside
      SIGNATURE_REQUESTED/VIEWED/DECLINED/etc. Kept here rather than
      deleted — this constant already shipped, reviewed, in Phase 25 — but
      no code path anywhere ever emits it. */
  DOCUMENT_SIGNED: 'document.signed',

  /** Phase 26 (Electronic Signatures & Authorization Workflows). A stable,
      machine-readable taxonomy for the signature-request lifecycle —
      human-readable text lives entirely in each event's own
      `description` field, never derived from or mixed into these
      identifiers. All seven use the `'documents'` category (a signature
      is part of a document's own lifecycle, not a separate domain). */
  SIGNATURE_REQUESTED: 'document.signature.requested',
  /** Distinct from SIGNATURE_REQUESTED — fires only once the signer's
      notification actually dispatches successfully (the request's own
      draft -> pending transition), never at request-creation time
      itself, since those two things can fail independently. */
  SIGNATURE_EMAIL_SENT: 'document.signature.email.sent',
  SIGNATURE_VIEWED: 'document.signature.viewed',
  /** The signature-completed event — see DOCUMENT_SIGNED's comment above
      for why this is used instead of that reserved-but-superseded
      constant. */
  SIGNATURE_COMPLETED: 'document.signature.completed',
  SIGNATURE_DECLINED: 'document.signature.declined',
  SIGNATURE_CANCELLED: 'document.signature.cancelled',
  SIGNATURE_EXPIRED: 'document.signature.expired',

  DOCUMENT_TEMPLATE_CREATED: 'document.template.created',
  /** Fires on every edit that produces a new DocumentTemplateVersion —
      never on a metadata-only change (e.g. archiving), which has its own
      event below. */
  DOCUMENT_TEMPLATE_UPDATED: 'document.template.updated',
  DOCUMENT_TEMPLATE_ARCHIVED: 'document.template.archived',
  DOCUMENT_TEMPLATE_RESTORED: 'document.template.restored',

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

  /** Phase 27 (Scheduling & Resource Management). All eight use the
      already-reserved `'scheduling'` category (see `ActivityEventCategory`
      above) — this is its first real emitter. Every one of these is
      recorded exclusively from inside `services/schedulingService.ts`;
      see that file's own header comment and its structural test. */
  APPOINTMENT_CREATED: 'scheduling.appointment.created',
  APPOINTMENT_UPDATED: 'scheduling.appointment.updated',
  APPOINTMENT_RESCHEDULED: 'scheduling.appointment.rescheduled',
  APPOINTMENT_CANCELLED: 'scheduling.appointment.cancelled',
  APPOINTMENT_COMPLETED: 'scheduling.appointment.completed',
  RESOURCE_ASSIGNED: 'scheduling.resource.assigned',
  RESOURCE_RELEASED: 'scheduling.resource.released',
  /** Fires only when a hard conflict was detected and an authorized
      override proceeded anyway — never for a soft (warning-only)
      conflict, which has nothing to "override." Always `severity:
      'critical'`. */
  RESOURCE_CONFLICT_OVERRIDDEN: 'scheduling.resource.conflict_overridden',
} as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[keyof typeof ACTIVITY_EVENT_TYPES];

export type NewActivityEventInput = Omit<ActivityEvent, 'id' | 'eventVersion' | 'createdAt'>;
