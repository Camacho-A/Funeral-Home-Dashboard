import { SERVICE_TYPE_CODES } from '../workflow/serviceWorkflows';
import { GUS_FINAL_GOODBYE_GROUPS as FG, GUS_VIEWING_GROUPS as GV, PREPARATION_CHOICES as C, PREPARATION_GROUPS as G } from './preparationGroups';
import type { PreparationGroupDefinition, ServicePreparationDefinition } from './types';

/**
 * The preparation for each service held before cremation (Gus Phase 5B,
 * 2026-11). Viewing and Final Goodbye follow the rules Gus confirmed in
 * Phase 5F; Mass is still a DRAFT (its procedure is pending) and is not
 * offered anywhere. They are not workflow templates — the case's workflow
 * (and Direct Cremation) is untouched by them; they are used only where
 * the organization profile turns service preparation on (Gus).
 */

/** Appointment types for the services (domain/scheduling/appointmentTypeRegistry.ts). */
export const SERVICE_APPOINTMENT_TYPES = {
  viewing: 'viewing',
  finalGoodbye: 'final.goodbye',
  mass: 'funeral.mass',
} as const;

/** Provisional service code for Mass — NOT in the live service catalog or
    in SERVICE_TYPE_CODES until the funeral home decides whether Mass is a
    service of its own or part of another. */
export const PROVISIONAL_MASS_SERVICE_TYPE_CODE = 'CREMATION_WITH_MASS';

const massBodyPresent = { choice: C.massPresence.key, equals: ['body_present'] } as const;

export const VIEWING_PREPARATION: ServicePreparationDefinition = {
  key: 'prep.viewing',
  version: 2,
  serviceTypeCode: SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING,
  serviceName: 'Viewing',
  serviceAppointmentType: SERVICE_APPOINTMENT_TYPES.viewing,
  status: 'approved',
  holdsCremation: 'always',
  // Embalming, clothing and casket are not choices for a Viewing (Gus
  // policy: embalming mandatory, no waiver; the crematory embalms, dresses
  // and caskets). The optional extras stay the family's choice.
  choices: [C.casketSpray, C.prayerCards, C.registerBook, C.crucifix],
  groups: [G.service_schedule, G.crematory_hold, GV.embalming, GV.clothing, GV.casket, G.casket_spray, G.prayer_cards, G.register_book, G.crucifix, G.transportation_staffing, G.day_of_service],
  releasePrerequisiteItems: [{ itemId: 'prep.embalming.written_permission', label: 'Embalming authorization signed' }],
  openQuestions: [
    'What happens when the family does not bring clothing?',
    'Rental or purchased casket for viewings, and who supplies it?',
  ],
};

export const FINAL_GOODBYE_PREPARATION: ServicePreparationDefinition = {
  key: 'prep.final_goodbye',
  version: 2,
  serviceTypeCode: SERVICE_TYPE_CODES.CREMATION_WITH_FINAL_GOODBYE,
  serviceName: 'Final Goodbye',
  serviceAppointmentType: SERVICE_APPOINTMENT_TYPES.finalGoodbye,
  status: 'approved',
  holdsCremation: 'always',
  // No embalming, dressing or casket. Prayer cards, register books and
  // crucifixes are not offered until Gus confirms them.
  choices: [C.faceViewing, C.clergy],
  groups: [G.service_schedule, G.crematory_hold, FG.setup, FG.faceViewing, G.clergy, G.transportation_staffing, G.day_of_service],
  serviceLimits: { maxDurationMinutes: 60, durationProvisional: true },
  openQuestions: ['Is 60 minutes the confirmed maximum length of a Final Goodbye?'],
};

const MASS_CREMATORY_HOLD: PreparationGroupDefinition = { ...G.crematory_hold, appliesWhen: massBodyPresent };

/** PROVISIONAL — whether Mass is its own service or an optional part of
    another is not decided; nothing in the catalog or the workflows uses it. */
export const MASS_PREPARATION: ServicePreparationDefinition = {
  key: 'prep.mass',
  version: 1,
  serviceTypeCode: PROVISIONAL_MASS_SERVICE_TYPE_CODE,
  serviceName: 'Mass',
  serviceAppointmentType: SERVICE_APPOINTMENT_TYPES.mass,
  status: 'draft',
  // Cremation waits for the Mass only when the body is present.
  holdsCremation: massBodyPresent,
  choices: [C.massPresence, C.embalming, C.clothing, C.casket, C.clergy, C.casketSpray, C.prayerCards, C.registerBook, C.crucifix],
  groups: [G.service_schedule, MASS_CREMATORY_HOLD, G.church, G.clergy, G.embalming, G.clothing, G.casket, G.casket_spray, G.prayer_cards, G.register_book, G.crucifix, G.transportation_staffing, G.day_of_service],
  openQuestions: [
    'Is Mass a service of its own, or an optional part of a Viewing or Final Goodbye?',
    'Is the Mass held with the body present, with the cremated remains, or both?',
    'Which parishes does the funeral home usually work with, and what do they require?',
  ],
};

export const SERVICE_PREPARATION_DEFINITIONS: readonly ServicePreparationDefinition[] = [VIEWING_PREPARATION, FINAL_GOODBYE_PREPARATION, MASS_PREPARATION];

/** The preparation for a case's service, or null (Direct Cremation and
    every service without one). */
export function servicePreparationFor(serviceTypeCode: string | null | undefined): ServicePreparationDefinition | null {
  if (!serviceTypeCode) return null;
  return SERVICE_PREPARATION_DEFINITIONS.find((d) => d.serviceTypeCode === serviceTypeCode) ?? null;
}
