/**
 * Phase 27 (Scheduling & Resource Management). The stable, machine-readable
 * appointment-type taxonomy every `Appointment.appointmentType` picks
 * exactly one entry from — mirrors `domain/documents/documentTypeRegistry.ts`'s
 * `DOCUMENT_TYPES` convention exactly: dot-notation identifiers, a
 * separate `displayName` (never derived from the key), and this registry
 * (not a hardcoded union on `Appointment` itself) is the source of truth
 * for what an appointment type "is." `category` groups entries into three
 * broad, UI-facing buckets (family-facing, operational, internal) — the
 * Calendar's type-filter groups by `category`; anything needing an
 * appointment's precise identity (permission gating, a future
 * witness-cremation integration keying off "this is specifically a
 * witness cremation") reads `appointmentType` directly.
 *
 * This list is deliberately extensible — adding an appointment type later
 * is a new entry here, never a data-model change (the same "reserved slot
 * in the registry" discipline `ACTIVITY_EVENT_TYPES`/`DOCUMENT_TYPES`
 * already established).
 */
export type AppointmentTypeCategory = 'family_facing' | 'operational' | 'internal';

export const APPOINTMENT_TYPES = {
  ARRANGEMENT_CONFERENCE: { key: 'arrangement.conference', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Arrangement Conference' },
  FAMILY_MEETING: { key: 'family.meeting', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Family Meeting' },
  VIEWING: { key: 'viewing', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Viewing' },
  VISITATION: { key: 'visitation', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Visitation' },
  FUNERAL_SERVICE: { key: 'funeral.service', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Funeral Service' },
  GRAVESIDE_SERVICE: { key: 'graveside.service', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Graveside Service' },
  // Gus Phase 5B (2026-11): offered only to organizations with service
  // preparation (see SERVICE_PREPARATION_APPOINTMENT_TYPE_KEYS below).
  FINAL_GOODBYE: { key: 'final.goodbye', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Final Goodbye' },
  FUNERAL_MASS: { key: 'funeral.mass', category: 'family_facing' as AppointmentTypeCategory, displayName: 'Mass' },

  WITNESS_CREMATION: { key: 'witness.cremation', category: 'operational' as AppointmentTypeCategory, displayName: 'Witness Cremation' },
  CREMATORY_APPOINTMENT: { key: 'crematory.appointment', category: 'operational' as AppointmentTypeCategory, displayName: 'Crematory Appointment' },
  CEMETERY_APPOINTMENT: { key: 'cemetery.appointment', category: 'operational' as AppointmentTypeCategory, displayName: 'Cemetery Appointment' },
  /** Expected Cremains Pickup (2026-10). The date an organization expects
      to collect a case's cremains from its crematory, derived from when
      the crematory paperwork was completed — see
      domain/scheduling/cremainsPickupSchedule.ts. Operational, like the
      other crematory-facing entries: it is internal logistics, never a
      family-facing appointment. Added as a registry entry exactly as this
      file's own header describes, so no data-model change was needed. */
  EXPECTED_CREMAINS_PICKUP: { key: 'cremains.pickup.expected', category: 'operational' as AppointmentTypeCategory, displayName: 'Expected Cremains Pickup' },

  STAFF_MEETING: { key: 'staff.meeting', category: 'internal' as AppointmentTypeCategory, displayName: 'Staff Meeting' },
  INTERNAL_EVENT: { key: 'internal.event', category: 'internal' as AppointmentTypeCategory, displayName: 'Internal Event' },
} as const;

export type AppointmentTypeDefinition = (typeof APPOINTMENT_TYPES)[keyof typeof APPOINTMENT_TYPES];
export type AppointmentTypeKey = AppointmentTypeDefinition['key'];

const APPOINTMENT_TYPES_BY_KEY: Record<string, AppointmentTypeDefinition> = Object.fromEntries(
  Object.values(APPOINTMENT_TYPES).map((entry) => [entry.key, entry]),
);

export function isValidAppointmentTypeKey(key: string): key is AppointmentTypeKey {
  return key in APPOINTMENT_TYPES_BY_KEY;
}

export function getAppointmentTypeDefinition(key: string): AppointmentTypeDefinition | null {
  return APPOINTMENT_TYPES_BY_KEY[key] ?? null;
}

/** Gus Phase 5B (2026-11). Appointment types that exist only for service
    preparation (domain/servicePreparation/): an organization without it
    (Manors) is never offered them and cannot create one. */
export const SERVICE_PREPARATION_APPOINTMENT_TYPE_KEYS: ReadonlySet<string> = new Set([APPOINTMENT_TYPES.FINAL_GOODBYE.key, APPOINTMENT_TYPES.FUNERAL_MASS.key]);

export function isAppointmentTypeOffered(key: string, features: { servicePreparation: boolean }): boolean {
  return isValidAppointmentTypeKey(key) && (features.servicePreparation || !SERVICE_PREPARATION_APPOINTMENT_TYPE_KEYS.has(key));
}

/** Display labels for the three broad `AppointmentTypeCategory` values —
    a domain decision, kept out of UI components per `Badge`'s own
    convention (see `domain/documents/documentTypeRegistry.ts`'s identical
    `DOCUMENT_TEMPLATE_CATEGORY_LABEL` for the same pattern). */
export const APPOINTMENT_TYPE_CATEGORY_LABEL: Record<AppointmentTypeCategory, string> = {
  family_facing: 'Family-Facing',
  operational: 'Operational',
  internal: 'Internal',
};
