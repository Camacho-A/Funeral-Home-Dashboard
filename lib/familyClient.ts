import type { PortalCaseView } from '@/domain/portal/portalCaseView';
import type { PortalDocumentView } from '@/domain/portal/portalDocumentView';
import type { PortalAppointmentView } from '@/domain/portal/portalAppointmentView';
import type { PortalPaymentView } from '@/domain/portal/portalPaymentView';
import type { PortalActivityView } from '@/domain/portal/portalActivityView';
import type { PortalSignatureRequestView } from '@/domain/portal/portalSignatureView';
import type { PortalMessage } from '@/types/portalMessage';
import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';
import type { NotificationPreference } from '@/types/notificationPreference';

/**
 * Phase 29 (Family Portal & External Collaboration). Client-side fetch
 * wrappers around every `/api/family/*` route — same `parseJsonOrThrow`
 * convention as every other `lib/*Client.ts` module (see
 * `lib/appointmentsClient.ts`'s own header comment). Deliberately its own
 * file, never importing from or imported by any staff-side `lib/*Client.ts`
 * module — the family UI's data layer is as structurally separate from
 * the staff UI's as the session/auth layer underneath it.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

// --- Auth ---------------------------------------------------------------

export async function familyLogin(params: { email: string; password: string }): Promise<void> {
  const response = await fetch('/api/family/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

export async function familyLogout(): Promise<void> {
  const response = await fetch('/api/family/logout', { method: 'POST' });
  await parseJsonOrThrow(response);
}

export async function familyAcceptInvitation(params: { token: string; password: string }): Promise<void> {
  const response = await fetch('/api/family/accept-invitation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

export async function familyForgotPassword(email: string): Promise<void> {
  const response = await fetch('/api/family/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  await parseJsonOrThrow(response);
}

export async function familyResetPassword(params: { token: string; password: string }): Promise<void> {
  const response = await fetch('/api/family/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await parseJsonOrThrow(response);
}

// --- Cases ----------------------------------------------------------------

export async function fetchFamilyCases(): Promise<PortalCaseView[]> {
  const response = await fetch('/api/family/cases');
  const body = await parseJsonOrThrow(response);
  return (body.cases as PortalCaseView[]) ?? [];
}

export async function fetchFamilyCase(caseId: string): Promise<PortalCaseView> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}`);
  const body = await parseJsonOrThrow(response);
  return body.case as PortalCaseView;
}

export async function fetchFamilyTimeline(caseId: string): Promise<{ events: PortalActivityView[]; nextCursor: string | null }> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/timeline`);
  const body = await parseJsonOrThrow(response);
  return { events: (body.events as PortalActivityView[]) ?? [], nextCursor: (body.nextCursor as string | null) ?? null };
}

// --- Documents --------------------------------------------------------------

export async function fetchFamilyDocuments(caseId: string): Promise<PortalDocumentView[]> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/documents`);
  const body = await parseJsonOrThrow(response);
  return (body.documents as PortalDocumentView[]) ?? [];
}

/** Not a fetch wrapper — the download route streams a real file, same
    reasoning as `lib/caseDocumentsClient.ts`'s own `buildCaseDocumentDownloadUrl`. */
export function buildFamilyDocumentDownloadUrl(caseId: string, documentId: string): string {
  return `/api/family/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/download`;
}

/** Phase 34 (Scheduling Integrations, Calendar Sync & Automated
    Reminders). Same "not a fetch wrapper" reasoning as
    `buildFamilyDocumentDownloadUrl` above — an `<a href>` navigation to
    this URL streams a real .ics file, authenticated by the browser's
    existing family session cookie. */
export function buildFamilyAppointmentIcsUrl(caseId: string, appointmentId: string): string {
  return `/api/family/cases/${encodeURIComponent(caseId)}/appointments/${encodeURIComponent(appointmentId)}/ics`;
}

// --- Signatures ---------------------------------------------------------

export async function fetchFamilySignatureRequests(caseId: string): Promise<PortalSignatureRequestView[]> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/signature-requests`);
  const body = await parseJsonOrThrow(response);
  return (body.requests as PortalSignatureRequestView[]) ?? [];
}

export async function completeFamilySignatureRequest(params: { caseId: string; requestId: string; signedName: string }): Promise<PortalSignatureRequestView> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(params.caseId)}/signature-requests/${encodeURIComponent(params.requestId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedName: params.signedName }),
  });
  const body = await parseJsonOrThrow(response);
  return body.request as PortalSignatureRequestView;
}

export async function declineFamilySignatureRequest(params: { caseId: string; requestId: string; reason?: string }): Promise<PortalSignatureRequestView> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(params.caseId)}/signature-requests/${encodeURIComponent(params.requestId)}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: params.reason }),
  });
  const body = await parseJsonOrThrow(response);
  return body.request as PortalSignatureRequestView;
}

// --- Appointments ---------------------------------------------------------

export async function fetchFamilyAppointments(caseId: string): Promise<PortalAppointmentView[]> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/appointments`);
  const body = await parseJsonOrThrow(response);
  return (body.appointments as PortalAppointmentView[]) ?? [];
}

// --- Payments ---------------------------------------------------------------

export async function fetchFamilyPayments(caseId: string): Promise<PortalPaymentView[]> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/payments`);
  const body = await parseJsonOrThrow(response);
  return (body.payments as PortalPaymentView[]) ?? [];
}

export async function initiateFamilyPaymentCheckout(params: { caseId: string; idempotencyKey: string }): Promise<{ checkoutUrl: string; paymentId: string }> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(params.caseId)}/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: params.idempotencyKey }),
  });
  const body = await parseJsonOrThrow(response);
  return { checkoutUrl: body.checkoutUrl as string, paymentId: body.paymentId as string };
}

export async function fetchFamilyPaymentStatus(caseId: string, paymentId: string): Promise<PortalPaymentView | null> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/payments/return?paymentId=${encodeURIComponent(paymentId)}`);
  if (response.status === 404) return null;
  const body = await parseJsonOrThrow(response);
  return (body.payment as PortalPaymentView | null) ?? null;
}

/** Mock-mode only — see the route's own header comment. */
export async function simulateFamilyPaymentSuccess(caseId: string, paymentId: string): Promise<PortalPaymentView | null> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/payments/${encodeURIComponent(paymentId)}/simulate`, { method: 'POST' });
  const body = await parseJsonOrThrow(response);
  return (body.payment as PortalPaymentView | null) ?? null;
}

export async function cancelFamilyPayment(caseId: string, paymentId: string): Promise<PortalPaymentView | null> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/payments/${encodeURIComponent(paymentId)}/cancel`, { method: 'POST' });
  const body = await parseJsonOrThrow(response);
  return (body.payment as PortalPaymentView | null) ?? null;
}

// --- Messages ---------------------------------------------------------------

export async function fetchFamilyMessages(caseId: string): Promise<PortalMessage[]> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(caseId)}/messages`);
  const body = await parseJsonOrThrow(response);
  return (body.messages as PortalMessage[]) ?? [];
}

export async function sendFamilyMessageRequest(params: { caseId: string; body: string }): Promise<PortalMessage> {
  const response = await fetch(`/api/family/cases/${encodeURIComponent(params.caseId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: params.body }),
  });
  const body = await parseJsonOrThrow(response);
  return body.message as PortalMessage;
}

// --- Notifications ------------------------------------------------------

export type FamilyNotificationInboxItem = { notification: Notification; recipient: NotificationRecipient };

export async function fetchFamilyNotifications(params: { cursor?: string | null } = {}): Promise<{ items: FamilyNotificationInboxItem[]; nextCursor: string | null }> {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  const response = await fetch(`/api/family/notifications?${search.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { items: (body.items as FamilyNotificationInboxItem[]) ?? [], nextCursor: (body.nextCursor as string | null) ?? null };
}

export async function fetchFamilyUnreadNotificationCount(): Promise<number> {
  const response = await fetch('/api/family/notifications/unread-count');
  const body = await parseJsonOrThrow(response);
  return (body.count as number) ?? 0;
}

export async function setFamilyNotificationRecipientAction(params: { notificationRecipientId: string; action: 'read' | 'archive' }): Promise<NotificationRecipient> {
  const response = await fetch(`/api/family/notifications/recipients/${encodeURIComponent(params.notificationRecipientId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: params.action }),
  });
  const body = await parseJsonOrThrow(response);
  return body.recipient as NotificationRecipient;
}

export async function fetchFamilyNotificationPreferences(): Promise<NotificationPreference | { emailEnabled: boolean; inAppEnabled: boolean }> {
  const response = await fetch('/api/family/notifications/preferences');
  const body = await parseJsonOrThrow(response);
  return body.preferences as NotificationPreference;
}

export async function updateFamilyNotificationPreferences(patch: { emailEnabled?: boolean; inAppEnabled?: boolean }): Promise<NotificationPreference> {
  const response = await fetch('/api/family/notifications/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await parseJsonOrThrow(response);
  return body.preferences as NotificationPreference;
}
