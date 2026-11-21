import { isGusDeployment, MANORS_ORGANIZATION_ID } from '../gusDeployment';

/**
 * Unified portal (Phase 5N, approved 2026-11-20). During the transition
 * Manors' integrations — its Outlook crematory mailbox and fax, calendar
 * sync, reminders and notifications, email, Clover, JotForm and document
 * storage — stay on MANORS PRODUCTION. When the unified portal (the
 * `gus-solis` project, a Gus deployment that also serves Manors) acts on a
 * Manors case, none of those may run, and none of the shared rows that
 * Manors Production's own sweeps would later act on may be written
 * (calendar sync markers, digest-queued notifications, reminder rows).
 * Nor may anything here disconnect or invalidate Manors' live connections.
 *
 * This is the one place that says so. It answers per organization, from
 * the deployment's own configuration — never from the request. On any other
 * deployment (Manors Production, the sandboxes, local development) it
 * allows everything, so their behavior is unchanged.
 *
 * Moving a Manors integration to the unified portal is a separately
 * approved step (docs/UNIFIED_PORTAL.md › integration migration plan).
 */
export type IntegrationChannel =
  | 'crematory_mailbox'
  | 'calendar_sync'
  | 'appointment_reminders'
  | 'notification_delivery'
  | 'email'
  | 'payments'
  | 'jotform'
  | 'document_storage';

const WHAT: Record<IntegrationChannel, string> = {
  crematory_mailbox: 'Outlook sending to the crematory and fax',
  calendar_sync: 'calendar sync',
  appointment_reminders: 'appointment reminders',
  notification_delivery: 'email and text notifications',
  email: 'email',
  payments: 'card payments and refunds',
  jotform: 'JotForm',
  document_storage: 'document storage',
};

/** Whether this process is the unified portal serving Manors as well as Gus. */
export function isUnifiedPortalServingManors(env: Record<string, string | undefined> = process.env): boolean {
  return isGusDeployment(env) && (env.DEPLOYMENT_ORGANIZATION_IDS ?? '').split(',').some((id) => id.trim() === MANORS_ORGANIZATION_ID);
}

/** Why this integration cannot run for this organization on this deployment — null when it may. */
export function integrationUnavailableReason(organizationId: string, channel: IntegrationChannel, env: Record<string, string | undefined> = process.env): string | null {
  if (organizationId !== MANORS_ORGANIZATION_ID || !isUnifiedPortalServingManors(env)) return null;
  return `Manors' ${WHAT[channel]} still runs from the Manors portal during the transition, so it is not available here. Nothing was sent or changed.`;
}

export class OrganizationIntegrationUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = 'OrganizationIntegrationUnavailableError';
  }
}

export function assertIntegrationAvailable(organizationId: string, channel: IntegrationChannel): void {
  const reason = integrationUnavailableReason(organizationId, channel);
  if (reason) throw new OrganizationIntegrationUnavailableError(reason);
}
