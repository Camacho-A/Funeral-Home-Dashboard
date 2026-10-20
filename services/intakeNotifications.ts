import type { DataAdapterMode } from '../lib/env';
import { boundedRowId, createNotification, getNotification } from './notificationService';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import { listMembershipsForOrganization, isActiveMembership } from './membershipService';
import { resolvePermissions } from './permissionService';
import type { ActivityContext } from './activityService';

/**
 * Intake activation (2026-10) — the first notification trigger for work
 * Manors actually does.
 *
 * A JotForm submission that SOLIS cannot resolve on its own used to
 * produce exactly one signal: a row appearing on the Unmatched Forms page
 * that somebody had to think to visit. B2026-037 sat there unnoticed.
 * This turns that silence into an inbox item.
 *
 * IN-APP ONLY. `channels: ['in_app']` is passed explicitly rather than
 * relying on recipients' saved preferences — in production every staff
 * preference row has `emailEnabled: true` with `digestFrequency:
 * 'instant'`, and one has SMS on, with Resend and Twilio both configured.
 * Without this bound the first stuck submission would have sent real email
 * and a real text message. The caller's list only ever NARROWS what
 * preferences already allow (see notificationService.createNotification),
 * so someone who has turned in-app off still receives nothing.
 *
 * RECIPIENTS ARE RESOLVED BY PERMISSION, not by role name. "Authorized
 * intake staff" means whoever can actually act on the thing — everyone
 * whose role grants `case.create`. Manors' three active staff hold three
 * DIFFERENT roles, so a single role key would have reached one of them;
 * and a permission rule needs no edit when the next organization arrives
 * with its own role names.
 *
 * One notification per recipient (`recipientScope: 'individual'`) rather
 * than one shared row: a membership has exactly one role, so the resolved
 * set is already disjoint, and this keeps the existing recipient
 * resolution completely unchanged.
 *
 * BEST-EFFORT, ALWAYS. The submission is already safely stored by the time
 * this runs; failing to announce it must never be what loses it. Every
 * path here swallows its own errors.
 */

/** The permission that defines "authorized intake staff" — holding it
    means you can act on a stuck submission by creating the case. */
const INTAKE_PERMISSION = 'case.create' as const;

/** Why a submission needs a human. Short, sanitized, and safe to show in
    an inbox — never a raw provider error body. */
export type IntakeAttentionReason =
  | 'Could not be matched to a case'
  | 'Automatic case creation failed'
  | 'Needs manual review before a case is created';

/**
 * Who should hear about intake problems in this organization.
 *
 * Organization-scoped at the source: memberships are read for ONE
 * organization, so another tenant's staff can never enter this list.
 */
export async function resolveIntakeNotificationRecipients(
  organizationId: string,
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
    if (permissions.has(INTAKE_PERMISSION)) recipients.push(membership.identityId);
  }
  // A membership carries one role, but a defensive de-dupe keeps a future
  // multi-membership model from producing two inbox rows for one person.
  return [...new Set(recipients)];
}

/**
 * Deterministic id, so a redelivered webhook cannot produce a second
 * inbox row for the same unresolved submission.
 *
 * The webhook already short-circuits a redelivery before reaching the
 * trigger, but that guard protects the SUBMISSION, not the notification;
 * this one is keyed on exactly what must not duplicate — this submission,
 * this recipient — and holds even if the trigger is ever called from
 * somewhere else.
 */
export function intakeNotificationId(submissionId: string, identityId: string): string {
  // Bounded to Wix's 128-character id cap; an id that fits is unchanged.
  return boundedRowId('n', `intake-attention-${submissionId}-${identityId}`);
}

export type IntakeAttentionParams = {
  submissionId: string;
  /** The form's own label, e.g. "Manors Cremation Arrangement Forms". */
  formLabel: string;
  /** The provider's submission id — what staff would quote when looking
      it up. Never the raw payload. */
  submissionReference: string;
  reason: IntakeAttentionReason;
  receivedAt: string;
};

/**
 * Announce a submission that needs a human.
 *
 * Carries the form, a submission reference and the reason — and
 * deliberately NOT the deceased's or the family's details. Triaging a
 * stuck submission never requires them, and including them would copy
 * personal data into several inboxes for no operational gain.
 */
export async function notifyIntakeSubmissionNeedsAttention(
  ctx: ActivityContext,
  params: IntakeAttentionParams,
  dataAdapterMode: DataAdapterMode,
): Promise<{ notified: number }> {
  try {
    const recipients = await resolveIntakeNotificationRecipients(ctx.organizationId, dataAdapterMode);
    let notified = 0;

    for (const identityId of recipients) {
      const notificationId = intakeNotificationId(params.submissionId, identityId);
      try {
        // Idempotency: an existing row for this (submission, recipient)
        // means this problem has already been announced. The row is left
        // exactly as it is — including whether it has been read — so a
        // redelivery never resurfaces something already dealt with.
        const existing = await getNotification(ctx.organizationId, notificationId, dataAdapterMode);
        if (existing) continue;

        await createNotification(
          {
            notificationType: NOTIFICATION_TYPES.INTAKE_SUBMISSION_NEEDS_ATTENTION.key,
            entityType: 'externalFormSubmission',
            entityId: params.submissionId,
            recipientScope: 'individual',
            recipientIdentityId: identityId,
            actionUrl: '/unmatched-forms',
            channels: ['in_app'],
            tokens: {
              formLabel: params.formLabel,
              submissionReference: params.submissionReference,
              reason: params.reason,
              receivedAt: params.receivedAt,
            },
            idFactory: () => notificationId,
          },
          ctx,
          dataAdapterMode,
        );
        notified += 1;
      } catch (error) {
        console.error(
          `Failed to notify ${identityId} about intake submission ${params.submissionId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return { notified };
  } catch (error) {
    console.error(
      'Failed to resolve intake notification recipients:',
      error instanceof Error ? error.message : error,
    );
    return { notified: 0 };
  }
}
