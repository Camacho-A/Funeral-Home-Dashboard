import type { AppointmentStatus } from '@/types/appointment';
import type { ResourceStatus } from '@/types/resource';
import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Phase 27 (Scheduling & Resource Management). Which `AppointmentStatus`/
 * `ResourceStatus` maps to which display label/Badge variant — a domain
 * decision, kept out of any component per `Badge`'s own convention,
 * mirroring `domain/signatures/signatureRequestDisplay.ts`'s exact shape.
 */
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
};

export function appointmentStatusVariant(status: AppointmentStatus): BadgeVariant {
  if (status === 'completed' || status === 'confirmed') return 'success';
  if (status === 'cancelled' || status === 'no_show') return 'danger';
  if (status === 'scheduled' || status === 'in_progress') return 'brand';
  return 'neutral'; // draft
}

export const RESOURCE_STATUS_LABEL: Record<ResourceStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  out_of_service: 'Out of Service',
  archived: 'Archived',
};

export function resourceStatusVariant(status: ResourceStatus): BadgeVariant {
  if (status === 'active') return 'success';
  if (status === 'out_of_service' || status === 'archived') return 'danger';
  if (status === 'maintenance') return 'brand';
  return 'neutral';
}
