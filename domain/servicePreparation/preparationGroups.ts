import type { PreparationChoiceDefinition, PreparationGroupDefinition } from './types';

/**
 * Reusable preparation groups (Gus Phase 5B, 2026-11). A service picks the
 * groups it needs (serviceDefinitions.ts); a group or item that depends on
 * the family's choices applies only once that choice is made — nothing is
 * assumed (a Final Goodbye does not imply embalming or a casket; a Mass
 * does not imply the body is present).
 *
 * Optional groups (casket spray, prayer cards, …) are asked about with a
 * Requested / Not requested choice (`requestedBy`): until the family
 * answers they show as a decision to make; Not requested marks their items
 * Not requested, which never blocks readiness and never counts as done.
 *
 * The labels describe the work, not a funeral home's policy: whether a
 * group is part of a service, and any requirement beyond what a choice
 * switches on, is decided per service and approved by the funeral home.
 */

const REQUESTED = { value: 'requested', label: 'Requested' } as const;
const NOT_REQUESTED = { value: 'not_requested', label: 'Not requested' } as const;
const requestedChoice = (key: string, label: string): PreparationChoiceDefinition => ({ key, label, options: [REQUESTED, NOT_REQUESTED] });

export const PREPARATION_CHOICES = {
  embalming: {
    key: 'embalming',
    label: 'Embalming',
    options: [
      { value: 'embalmed', label: 'Embalmed' },
      { value: 'not_embalmed', label: 'Not embalmed (refrigerated)' },
    ],
  },
  clothing: {
    key: 'clothing',
    label: 'Clothing',
    options: [
      { value: 'family_provides', label: 'Family provides clothing' },
      { value: 'none', label: 'No clothing' },
    ],
  },
  casket: {
    key: 'casket',
    label: 'Casket',
    options: [
      { value: 'purchase', label: 'Purchase' },
      { value: 'rental', label: 'Rental' },
      { value: 'none', label: 'No casket' },
    ],
  },
  casketSpray: requestedChoice('casketSpray', 'Casket spray'),
  prayerCards: requestedChoice('prayerCards', 'Prayer cards'),
  registerBook: requestedChoice('registerBook', 'Register book'),
  crucifix: requestedChoice('crucifix', 'Crucifix'),
  clergy: requestedChoice('clergy', 'Priest or pastor'),
  /** Mass only, and unresolved: whether the body or the cremated remains
      are present decides whether cremation waits for the Mass. */
  massPresence: {
    key: 'massPresence',
    label: 'At the Mass',
    options: [
      { value: 'body_present', label: 'Body present (cremation after the Mass)' },
      { value: 'cremated_remains', label: 'Cremated remains present (Memorial Mass)' },
      { value: 'neither', label: 'Neither (Mass of remembrance)' },
    ],
  },
} as const satisfies Record<string, PreparationChoiceDefinition>;

const when = (choice: { key: string }, ...equals: string[]) => ({ choice: choice.key, equals });

export const PREPARATION_GROUPS = {
  service_schedule: {
    key: 'service_schedule',
    label: 'Service date and time',
    items: [
      { id: 'prep.service.family_confirmed', label: 'Date, time and place confirmed with the family', requirement: 'required', kind: 'confirmation', dateDependent: true, beforeFamilyArrives: true },
    ],
  },
  crematory_hold: {
    key: 'crematory_hold',
    label: 'Crematory hold',
    items: [
      { id: 'prep.crematory.notified', label: 'Crematory told about the service', requirement: 'required', kind: 'task', dateDependent: true, target: 'crematory_notification', beforeFamilyArrives: true },
      {
        id: 'prep.crematory.hold_confirmed',
        label: 'Crematory confirmed it will not cremate until released',
        requirement: 'required',
        kind: 'confirmation',
        dateDependent: true,
        target: 'crematory_notification',
        beforeFamilyArrives: true,
        supportingDocument: 'The crematory’s written hold confirmation',
      },
    ],
  },
  embalming: {
    key: 'embalming',
    label: 'Embalming',
    appliesWhen: when(PREPARATION_CHOICES.embalming, 'embalmed'),
    items: [
      {
        id: 'prep.embalming.written_permission',
        label: 'Written embalming permission on file',
        requirement: 'required',
        kind: 'task',
        dateDependent: false,
        beforeFamilyArrives: true,
        supportingDocument: 'Signed embalming permission',
      },
      { id: 'prep.embalming.arranged', label: 'Embalming arranged', requirement: 'required', kind: 'confirmation', dateDependent: true, beforeFamilyArrives: true },
    ],
  },
  clothing: {
    key: 'clothing',
    label: 'Clothing',
    appliesWhen: when(PREPARATION_CHOICES.clothing, 'family_provides'),
    items: [
      { id: 'prep.clothing.received', label: 'Clothing received from the family', requirement: 'required', kind: 'task', dateDependent: false, beforeFamilyArrives: true },
      { id: 'prep.clothing.delivered', label: 'Clothing delivered for dressing', requirement: 'required', kind: 'task', dateDependent: false, beforeFamilyArrives: true },
    ],
  },
  casket: {
    key: 'casket',
    label: 'Casket',
    appliesWhen: when(PREPARATION_CHOICES.casket, 'purchase', 'rental'),
    items: [
      { id: 'prep.casket.selected', label: 'Casket selected with the family', requirement: 'required', kind: 'task', dateDependent: false, beforeFamilyArrives: true },
      { id: 'prep.casket.ordered', label: 'Casket ordered', requirement: 'required', kind: 'task', dateDependent: false, target: 'casket_order', beforeFamilyArrives: true, supportingDocument: 'Casket order' },
      { id: 'prep.casket.delivery_confirmed', label: 'Casket delivery confirmed', requirement: 'required', kind: 'confirmation', dateDependent: true, target: 'casket_order', beforeFamilyArrives: true },
    ],
  },
  casket_spray: {
    key: 'casket_spray',
    label: 'Casket spray',
    requestedBy: PREPARATION_CHOICES.casketSpray.key,
    items: [
      { id: 'prep.casket_spray.ordered', label: 'Casket spray ordered', requirement: 'optional', kind: 'confirmation', dateDependent: true, target: 'casket_spray', beforeFamilyArrives: true, supportingDocument: 'Florist order' },
    ],
  },
  prayer_cards: {
    key: 'prayer_cards',
    label: 'Prayer cards',
    requestedBy: PREPARATION_CHOICES.prayerCards.key,
    details: [
      {
        key: 'prayerCards.language',
        label: 'Language',
        kind: 'select',
        options: [
          { value: 'english', label: 'English' },
          { value: 'spanish', label: 'Spanish' },
        ],
      },
      { key: 'prayerCards.image', label: 'Image', kind: 'text' },
    ],
    items: [
      { id: 'prep.prayer_cards.proof_approved', label: 'Proof approved by the family', requirement: 'optional', kind: 'confirmation', dateDependent: false, target: 'prayer_card_printing', beforeFamilyArrives: true, supportingDocument: 'Approved proof' },
      { id: 'prep.prayer_cards.printed', label: 'Prayer cards printed', requirement: 'optional', kind: 'task', dateDependent: false, target: 'prayer_card_printing', beforeFamilyArrives: true },
    ],
  },
  register_book: {
    key: 'register_book',
    label: 'Register book',
    requestedBy: PREPARATION_CHOICES.registerBook.key,
    items: [
      { id: 'prep.register_book.proof_approved', label: 'Register book details approved by the family', requirement: 'optional', kind: 'confirmation', dateDependent: false, beforeFamilyArrives: true },
      { id: 'prep.register_book.prepared', label: 'Register book prepared', requirement: 'optional', kind: 'task', dateDependent: false, beforeFamilyArrives: true },
    ],
  },
  crucifix: {
    key: 'crucifix',
    label: 'Crucifix',
    requestedBy: PREPARATION_CHOICES.crucifix.key,
    details: [
      {
        key: 'crucifix.type',
        label: 'Type',
        kind: 'select',
        options: [
          { value: 'plain', label: 'Plain cross' },
          { value: 'with_christ', label: 'With Christ' },
        ],
      },
    ],
    items: [{ id: 'prep.crucifix.prepared', label: 'Crucifix prepared', requirement: 'optional', kind: 'task', dateDependent: false, beforeFamilyArrives: true }],
  },
  clergy: {
    key: 'clergy',
    label: 'Priest or pastor',
    requestedBy: PREPARATION_CHOICES.clergy.key,
    details: [
      { key: 'clergy.name', label: 'Name', kind: 'text' },
      { key: 'clergy.phone', label: 'Phone', kind: 'phone' },
      { key: 'clergy.parish', label: 'Parish or church', kind: 'text' },
    ],
    items: [
      { id: 'prep.clergy.confirmed', label: 'Priest or pastor confirmed for the date and time', requirement: 'optional', kind: 'confirmation', dateDependent: true, target: 'clergy_confirmation', beforeFamilyArrives: true },
    ],
  },
  church: {
    key: 'church',
    label: 'Church',
    details: [
      { key: 'church.name', label: 'Church', kind: 'text' },
      { key: 'church.address', label: 'Address', kind: 'text' },
      { key: 'church.phone', label: 'Phone', kind: 'phone' },
      { key: 'church.contact', label: 'Contact person', kind: 'text' },
    ],
    items: [
      { id: 'prep.church.confirmed', label: 'Church confirmed the date and time', requirement: 'required', kind: 'confirmation', dateDependent: true, target: 'church_coordination', beforeFamilyArrives: true },
      { id: 'prep.church.requirements_recorded', label: 'Parish requirements recorded', requirement: 'required', kind: 'task', dateDependent: false, target: 'church_coordination', beforeFamilyArrives: true },
    ],
  },
  transportation_staffing: {
    key: 'transportation_staffing',
    label: 'Transportation and staff',
    items: [
      { id: 'prep.transport.scheduled', label: 'Transportation scheduled', requirement: 'required', kind: 'task', dateDependent: true, beforeFamilyArrives: true },
      { id: 'prep.staffing.assigned', label: 'Staff assigned', requirement: 'required', kind: 'task', dateDependent: true, beforeFamilyArrives: true },
    ],
  },
  day_of_service: {
    key: 'day_of_service',
    label: 'Day of the service',
    items: [
      { id: 'prep.day_of.identification_verified', label: 'Identification checked on the remains', requirement: 'required', kind: 'task', dateDependent: true, beforeFamilyArrives: true },
      { id: 'prep.day_of.room_ready', label: 'Room and requested items in place', requirement: 'required', kind: 'task', dateDependent: true, beforeFamilyArrives: true },
    ],
  },
} as const satisfies Record<string, PreparationGroupDefinition>;
