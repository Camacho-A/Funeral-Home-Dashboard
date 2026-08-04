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

  WITNESS_CREMATION: { key: 'witness.cremation', category: 'operational' as AppointmentTypeCategory, displayName: 'Witness Cremation' },
  CREMATORY_APPOINTMENT: { key: 'crematory.appointment', category: 'operational' as AppointmentTypeCategory, displayName: 'Crematory Appointment' },
  CEMETERY_APPOINTMENT: { key: 'cemetery.appointment', category: 'operational' as AppointmentTypeCategory, displayName: 'Cemetery Appointment' },

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

/** Display labels for the three broad `AppointmentTypeCategory` values —
    a domain decision, kept out of UI components per `Badge`'s own
    convention (see `domain/documents/documentTypeRegistry.ts`'s identical
    `DOCUMENT_TEMPLATE_CATEGORY_LABEL` for the same pattern). */
export const APPOINTMENT_TYPE_CATEGORY_LABEL: Record<AppointmentTypeCategory, string> = {
  family_facing: 'Family-Facing',
  operational: 'Operational',
  internal: 'Internal',
};
