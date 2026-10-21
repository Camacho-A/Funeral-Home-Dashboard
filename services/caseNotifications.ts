import type { DataAdapterMode } from '../lib/env';
import { boundedRowId, createNotification, getNotification } from './notificationService';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import { listMembershipsForOrganization, isActiveMembership } from './membershipService';
import { resolvePermissions } from './permissionService';
import type { ActivityContext } from './activityService';

/**
 * Everyday operational notifications (2026-10).
 *
 * The Notification Center had been live with almost nothing to show: a
 * production audit found 30 registered types, 11 wired triggers, and zero
 * notifications ever created. The one intake trigger that existed only
 * fired when something went WRONG, so a normal day produced silence.
 * These are the events a funeral home actually has: a case arrives, a form
 * comes in, a PDF attaches, a payment lands, a case finishes.
 *
 * Built on services/intakeNotifications.ts's established shape rather than
 * beside it — same permission-resolved recipients, same deterministic
 * ids, same in-app binding, same best-effort posture. The differences are
 * only which permission gates which event, and what each one says.
 *
 * IN-APP ONLY. Every call passes `channels: ['in_app']`. Production staff
 * preferences have email on (one has SMS) with Resend and Twilio
 * configured, so without this bound the first new case would have sent
 * real email and a real text. The caller's list only ever NARROWS what a
 * recipient's own preferences already allow, so someone who has turned
 * in-app off for a category still receives nothing.
 *
 * BEST-EFFORT, ALWAYS. The case, the payment and the document are already
 * safely stored by the time any of this runs. Failing to announce
 * something must never be what undoes it, so every path swallows its own
 * errors and returns a count rather than throwing.
 */

/**
 * The permission that gates each event — what you must be able to DO to be
 * told it happened.
 *
 * Permissions, never role names: Manors' three active staff hold three
 * different roles, and the next organization will name its roles
 * differently again. An administrator receives these only because their
 * role grants the permission, never automatically.
 */
const CASE_READ = 'case.read' as const;
const PAYMENT_READ = 'payment.read' as const;
const DOCUMENT_READ = 'document.view' as const;

/** Who in this organization can act on this kind of event. Organization-
    scoped at the source: memberships are read for ONE organization, so
    another tenant's staff can never enter the list. */
type NotificationPermission = typeof CASE_READ | typeof PAYMENT_READ | typeof DOCUMENT_READ;

async function resolveRecipients(
  organizationId: string,
  permission: NotificationPermission,
  dataAdapterMode: DataAdapterMode,
): Promise<string[]> {
  const memberships = await listMembershipsForOrganization(organizationId, dataAdapterMode);
  const active = memberships.filter(isActiveMembership);

  const recipients: string[] = [];
  for (const membership of active) {
    const permissions = await resolvePermissions(
      { identityId: membership.identityId, organizationId, roleKey: membership.role },
      dataAdapterMode,
    );
    if (permissions.has(permission)) recipients.push(membership.identityId);
  }
  return [...new Set(recipients)];
}

/**
 * Deterministic notification id — the whole duplicate-prevention strategy.
 *
 * Keyed on (event, the thing it happened to, recipient). A JotForm webhook
 * redelivery, a PDF import retry, a repeated workflow reconciliation or a
 * double-submitted API request all recompute the SAME id, and the existence
 * check below then makes the second attempt a no-op. The row is left
 * exactly as it was, including whether it has been read, so a retry never
 * resurfaces something already dealt with.
 *
 * `eventKey` must be stable and canonical for the event: a case id for case
 * creation, a submission id for a form, a payment id for a payment.
 */
export function caseNotificationId(event: string, eventKey: string, identityId: string): string {
  // Bounded to Wix's 128-character id cap; an id that fits is unchanged.
  return boundedRowId('n', `${event}-${eventKey}-${identityId}`);
}

type EmitParams = {
  organizationId: string;
  notificationType: string;
  permission: NotificationPermission;
  /** Canonical, stable identifier for the event being announced. */
  eventKey: string;
  entityType: string;
  entityId: string;
  actionUrl: string;
  tokens: Record<string, string>;
};

/**
 * One notification per eligible recipient, created once and only once.
 *
 * `recipientScope: 'individual'` rather than one shared row: a membership
 * carries exactly one role, so the resolved set is already disjoint, and
 * this keeps the existing recipient resolution untouched.
 */
async function emit(ctx: ActivityContext, params: EmitParams, dataAdapterMode: DataAdapterMode): Promise<{ notified: number }> {
  try {
    const recipients = await resolveRecipients(params.organizationId, params.permission, dataAdapterMode);
    let notified = 0;

    for (const identityId of recipients) {
      const notificationId = caseNotificationId(params.notificationType, params.eventKey, identityId);
      try {
        const existing = await getNotification(params.organizationId, notificationId, dataAdapterMode);
        if (existing) continue;

        await createNotification(
          {
            notificationType: params.notificationType,
            entityType: params.entityType,
            entityId: params.entityId,
            recipientScope: 'individual',
            recipientIdentityId: identityId,
            actionUrl: params.actionUrl,
            channels: ['in_app'],
            tokens: params.tokens,
            idFactory: () => notificationId,
          },
          ctx,
          dataAdapterMode,
        );
        notified += 1;
      } catch (error) {
        console.error(
          `Failed to notify ${identityId} of ${params.notificationType} (${params.eventKey}):`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return { notified };
  } catch (error) {
    console.error(
      `Failed to resolve recipients for ${params.notificationType}:`,
      error instanceof Error ? error.message : error,
    );
    return { notified: 0 };
  }
}

/** A case, as these notifications need to describe it. */
export type NotifiableCase = {
  id: string;
  caseNumber: string;
  decedentName: string;
};

function caseUrl(caseId: string): string {
  return `/cases/${caseId}`;
}

/**
 * Where a case came from, in words staff recognise.
 *
 * A single `case.created` type carries its origin in the body rather than
 * fragmenting the inbox into one type per creation path — the staff action
 * is identical whichever way the case arrived.
 */
export type CaseNotificationOrigin = 'the First Call form' | 'the Cremation Arrangement Form' | 'the New Case form' | 'an intake form';

/**
 * A genuinely new case exists.
 *
 * Deliberately NOT called for: a case that failed to be created, an
 * ordinary update to an existing case, a restored archive, a duplicate
 * submission held for review, or a historical backfill. Each of those is
 * either not a new case or not news — see the call sites, which decide.
 *
 * Keyed on the case id, so the same case can only ever be announced once
 * however many times a webhook is redelivered.
 */
export async function notifyCaseCreated(
  ctx: ActivityContext,
  params: { case: NotifiableCase; source: CaseNotificationOrigin },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.CASE_CREATED.key,
      permission: CASE_READ,
      eventKey: params.case.id,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: {
        caseNumber: params.case.caseNumber,
        decedentName: params.case.decedentName,
        sourceLabel: params.source,
      },
    },
    dataAdapterMode,
  );
}

/**
 * A Cremation Arrangement Form landed on a case that already existed.
 *
 * When the form CREATES the case, the call site sends `notifyCaseCreated`
 * instead and this is not called — one combined notification naming the
 * arrangement form as the source, never two for the same arrival.
 *
 * Keyed on the submission, so a webhook redelivery is a no-op.
 */
export async function notifyArrangementReceived(
  ctx: ActivityContext,
  params: { case: NotifiableCase; submissionId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.CASE_ARRANGEMENT_RECEIVED.key,
      permission: CASE_READ,
      eventKey: params.submissionId,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName },
    },
    dataAdapterMode,
  );
}

/** A Vital Statistics submission updated an existing case. Keyed on the
    submission, so retries and replays announce nothing new. */
export async function notifyVitalStatisticsReceived(
  ctx: ActivityContext,
  params: { case: NotifiableCase; submissionId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.CASE_VITAL_STATISTICS_RECEIVED.key,
      permission: CASE_READ,
      eventKey: params.submissionId,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName },
    },
    dataAdapterMode,
  );
}

/**
 * A case reached its completed state for the first time.
 *
 * Keyed on the case id, which is what makes this safe to call from
 * workflow reconciliation: reconciliation runs repeatedly and may
 * re-observe completion many times, but only the first observation can
 * create a row. Restoring an archived case does not pass through here.
 */
export async function notifyCaseCompleted(
  ctx: ActivityContext,
  params: { case: NotifiableCase },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.CASE_COMPLETED.key,
      permission: CASE_READ,
      eventKey: params.case.id,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName },
    },
    dataAdapterMode,
  );
}

/**
 * A form's PDF was attached to its case, or could not be.
 *
 * Success is routine and defaults OFF for ordinary staff; failure is
 * actionable and defaults ON for staff who can see documents. Both are
 * keyed on the submission, so the import's own idempotent retry — which
 * finds the document already attached and returns — announces nothing the
 * second time.
 *
 * The failure body names the form and the case and stops there: no
 * provider error body, no storage path, no credentials.
 */
export async function notifyJotformPdfImported(
  ctx: ActivityContext,
  params: { case: NotifiableCase; submissionId: string; formLabel: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.JOTFORM_PDF_IMPORTED.key,
      permission: DOCUMENT_READ,
      eventKey: params.submissionId,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName, formLabel: params.formLabel },
    },
    dataAdapterMode,
  );
}

export async function notifyJotformPdfImportFailed(
  ctx: ActivityContext,
  params: { case: NotifiableCase; submissionId: string; formLabel: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.JOTFORM_PDF_IMPORT_FAILED.key,
      permission: DOCUMENT_READ,
      eventKey: params.submissionId,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName, formLabel: params.formLabel },
    },
    dataAdapterMode,
  );
}

/**
 * A payment was recorded against a case.
 *
 * Gated on `payment.read`, so only staff who may see money are told about
 * it. Keyed on the payment's own id — a webhook redelivery or a
 * double-submitted form records one payment and announces it once.
 *
 * `amountDisplay` is pre-formatted by the caller, and nothing about the
 * instrument travels with it: no card number, no last four, no token. The
 * body says an amount was recorded, which is what staff need to know.
 */
export async function notifyPaymentReceived(
  ctx: ActivityContext,
  params: { case: NotifiableCase; paymentId: string; amountDisplay: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.PAYMENT_RECEIVED.key,
      permission: PAYMENT_READ,
      eventKey: params.paymentId,
      entityType: 'payment',
      entityId: params.paymentId,
      actionUrl: caseUrl(params.case.id),
      tokens: {
        caseNumber: params.case.caseNumber,
        decedentName: params.case.decedentName,
        amountDisplay: params.amountDisplay,
      },
    },
    dataAdapterMode,
  );
}

/**
 * A payment the PROVIDER reported as failed.
 *
 * Emitted only from a verified provider event — the Clover webhook, after
 * its signature, merchant and event-fingerprint checks. SOLIS never
 * infers a failure from a payment that is merely missing or late, and
 * nothing here changes a transaction's state or retries anything.
 *
 * Keyed on the payment id, so a webhook redelivery announces once.
 */
export async function notifyPaymentFailed(
  ctx: ActivityContext,
  params: { case: NotifiableCase; paymentId: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.PAYMENT_FAILED.key,
      permission: PAYMENT_READ,
      eventKey: params.paymentId,
      entityType: 'payment',
      entityId: params.paymentId,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName },
    },
    dataAdapterMode,
  );
}

/**
 * A generated document succeeded or failed.
 *
 * Success defaults OFF (staff generate documents deliberately and watch it
 * happen); failure defaults ON, because a statement that silently failed
 * to generate is exactly the kind of thing that surfaces days later in
 * front of a family.
 *
 * Keyed on the document id so a regeneration — which produces a NEW
 * document and supersedes the old one — is a genuinely new event, while a
 * repeated callback about the same document is not.
 */
export async function notifyDocumentGenerated(
  ctx: ActivityContext,
  params: { case: NotifiableCase; documentId: string; documentTitle: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.DOCUMENT_GENERATED.key,
      permission: DOCUMENT_READ,
      eventKey: params.documentId,
      entityType: 'document',
      entityId: params.documentId,
      actionUrl: caseUrl(params.case.id),
      tokens: {
        caseNumber: params.case.caseNumber,
        decedentName: params.case.decedentName,
        entityTitle: params.documentTitle,
      },
    },
    dataAdapterMode,
  );
}

export async function notifyDocumentGenerationFailed(
  ctx: ActivityContext,
  params: { case: NotifiableCase; failureKey: string; documentTitle: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.DOCUMENT_GENERATION_FAILED.key,
      permission: DOCUMENT_READ,
      eventKey: params.failureKey,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: {
        caseNumber: params.case.caseNumber,
        decedentName: params.case.decedentName,
        entityTitle: params.documentTitle,
      },
    },
    dataAdapterMode,
  );
}

/**
 * SLA tracking (2026-10). The doctor's attestation arrived, so the
 * same-day Hard Save is now due. Keyed on the case and the attestation
 * time: re-recording the same attestation never notifies twice.
 */
export async function notifySlaHardSaveDue(
  ctx: ActivityContext,
  params: { case: NotifiableCase; attestationAt: string; dueLabel: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: NOTIFICATION_TYPES.CASE_SLA_HARD_SAVE_DUE.key,
      permission: CASE_READ,
      eventKey: `${params.case.id}-${params.attestationAt}`,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: { caseNumber: params.case.caseNumber, decedentName: params.case.decedentName, dueLabel: params.dueLabel },
    },
    dataAdapterMode,
  );
}

export type SlaAlertKind = 'due' | 'overdue' | 'external_overdue';

const SLA_ALERT_TYPE: Record<SlaAlertKind, string> = {
  due: NOTIFICATION_TYPES.CASE_SLA_DUE.key,
  overdue: NOTIFICATION_TYPES.CASE_SLA_OVERDUE.key,
  external_overdue: NOTIFICATION_TYPES.CASE_SLA_EXTERNAL_OVERDUE.key,
};

/**
 * SLA tracking (2026-10). A deadline approaching, missed, or an external
 * party past its target. Keyed on case + milestone + kind + deadline, so
 * each deadline produces at most one alert of each kind however often the
 * sweep runs — no daily repeats.
 */
export async function notifySlaAlert(
  ctx: ActivityContext,
  params: { case: NotifiableCase; kind: SlaAlertKind; milestoneKey: string; milestone: string; deadline: string; dueLabel: string; party: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  return emit(
    ctx,
    {
      organizationId: ctx.organizationId,
      notificationType: SLA_ALERT_TYPE[params.kind],
      permission: CASE_READ,
      eventKey: `${params.case.id}-${params.milestoneKey}-${params.deadline}`,
      entityType: 'case',
      entityId: params.case.id,
      actionUrl: caseUrl(params.case.id),
      tokens: {
        caseNumber: params.case.caseNumber,
        decedentName: params.case.decedentName,
        milestone: params.milestone,
        dueLabel: params.dueLabel,
        party: params.party,
      },
    },
    dataAdapterMode,
  );
}
