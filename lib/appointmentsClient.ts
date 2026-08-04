import type { Appointment, AppointmentStatus } from '@/types/appointment';
import type { AppointmentResourceAssignment } from '@/types/appointmentResourceAssignment';

/**
 * Phase 27 (Scheduling & Resource Management). Client-side fetch wrappers
 * around `/api/scheduling/appointments/*` and `/api/cases/[caseId]/appointments`
 * — `services/schedulingService.ts` imports server-only `lib/wixDataApi.ts`
 * and can never be called from a Client Component directly, matching every
 * other `lib/*Client.ts` module's reasoning (see `lib/activityClient.ts`'s
 * own header comment).
 */

export type ConflictDetail = {
  resourceId: string;
  resourceName: string;
  reason: string;
  conflictingAppointmentId: string | null;
  conflictingWindow: { startAt: string; endAt: string } | null;
};

/** Thrown instead of a plain Error when the server responds 409 with a
    `conflicts` array — callers (AppointmentDialog) catch this specifically
    to open ConflictResolutionDialog rather than just showing inline text. */
export class SchedulingConflictError extends Error {
  conflicts: ConflictDetail[];
  constructor(message: string, conflicts: ConflictDetail[]) {
    super(message);
    this.name = 'SchedulingConflictError';
    this.conflicts = conflicts;
  }
}

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    if (response.status === 409 && Array.isArray(body.conflicts)) {
      throw new SchedulingConflictError(message, body.conflicts as ConflictDetail[]);
    }
    throw new Error(message);
  }
  return body;
}

export type NewAppointmentParams = {
  organizationId: string;
  caseId?: string;
  appointmentType: string;
  title: string;
  notes?: string;
  locationId?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  resourceIds?: string[];
  saveAsDraft?: boolean;
  recurrence?: { frequency: 'daily' | 'weekly' | 'monthly'; interval: number; byWeekday?: number[]; count?: number; until?: string };
  override?: { reason: string };
};

export async function fetchAppointments(
  organizationId: string,
  filters: { from?: string; to?: string; caseId?: string; resourceId?: string; status?: AppointmentStatus } = {},
): Promise<Appointment[]> {
  const params = new URLSearchParams({ organizationId });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.caseId) params.set('caseId', filters.caseId);
  if (filters.resourceId) params.set('resourceId', filters.resourceId);
  if (filters.status) params.set('status', filters.status);
  const response = await fetch(`/api/scheduling/appointments?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.appointments as Appointment[]) ?? [];
}

export async function fetchCaseAppointments(organizationId: string, caseId: string): Promise<Appointment[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/appointments?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.appointments as Appointment[]) ?? [];
}

export async function fetchAppointment(organizationId: string, appointmentId: string): Promise<{ appointment: Appointment; resourceAssignments: AppointmentResourceAssignment[] }> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/scheduling/appointments/${encodeURIComponent(appointmentId)}?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { appointment: body.appointment as Appointment, resourceAssignments: (body.resourceAssignments as AppointmentResourceAssignment[]) ?? [] };
}

export async function createAppointment(params: NewAppointmentParams): Promise<Appointment> {
  const response = await fetch('/api/scheduling/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.appointment as Appointment;
}

export async function rescheduleAppointment(
  organizationId: string,
  appointmentId: string,
  changes: { startAt: string; endAt: string },
  override?: { reason: string },
): Promise<Appointment> {
  const response = await fetch(`/api/scheduling/appointments/${encodeURIComponent(appointmentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...changes, override }),
  });
  const body = await parseJsonOrThrow(response);
  return body.appointment as Appointment;
}

export async function updateAppointmentResources(
  organizationId: string,
  appointmentId: string,
  changes: { addResourceIds?: string[]; removeResourceIds?: string[] },
  override?: { reason: string },
): Promise<Appointment> {
  const response = await fetch(`/api/scheduling/appointments/${encodeURIComponent(appointmentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, ...changes, override }),
  });
  const body = await parseJsonOrThrow(response);
  return body.appointment as Appointment;
}

export async function confirmAppointment(organizationId: string, appointmentId: string): Promise<Appointment> {
  const response = await fetch(`/api/scheduling/appointments/${encodeURIComponent(appointmentId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body.appointment as Appointment;
}

export async function cancelAppointment(organizationId: string, appointmentId: string, reason?: string): Promise<Appointment> {
  const response = await fetch(`/api/scheduling/appointments/${encodeURIComponent(appointmentId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, reason }),
  });
  const body = await parseJsonOrThrow(response);
  return body.appointment as Appointment;
}

export async function completeAppointment(organizationId: string, appointmentId: string, outcome: 'completed' | 'no_show'): Promise<Appointment> {
  const response = await fetch(`/api/scheduling/appointments/${encodeURIComponent(appointmentId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, outcome }),
  });
  const body = await parseJsonOrThrow(response);
  return body.appointment as Appointment;
}
