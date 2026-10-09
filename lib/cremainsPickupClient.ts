import type { Appointment } from '@/types/appointment';

/**
 * Expected Cremains Pickup — client fetch wrappers (2026-10). Mirrors
 * every other `lib/*Client.ts`: a Client Component can never reach
 * `services/cremainsPickupService.ts` directly.
 *
 * `organizationId` is sent as a CLAIM; the route resolves the caller's
 * actual authorized organization and uses that, so this value can never
 * widen access.
 */

export class CremainsPickupError extends Error {
  constructor(
    message: string,
    /** True when the date is off-schedule and the server needs a reason
        before it will accept it. */
    public readonly requiresReason: boolean = false,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'CremainsPickupError';
  }
}

async function send(
  method: 'POST' | 'PATCH',
  caseId: string,
  body: { organizationId: string; expectedDate: string; notes?: string | null; reason?: string | null },
): Promise<Appointment> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/cremains-pickup`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CremainsPickupError(
      payload?.error ?? 'Could not save the expected pickup.',
      payload?.requiresReason === true,
      response.status,
    );
  }
  return payload.appointment as Appointment;
}

export function createExpectedPickup(
  caseId: string,
  body: { organizationId: string; expectedDate: string; notes?: string | null; reason?: string | null },
): Promise<Appointment> {
  return send('POST', caseId, body);
}

export function updateExpectedPickupDate(
  caseId: string,
  body: { organizationId: string; expectedDate: string; reason?: string | null },
): Promise<Appointment> {
  return send('PATCH', caseId, body);
}
