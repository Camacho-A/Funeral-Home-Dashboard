import type { Case } from '../../types/case';
import type { Organization } from '../../types/organization';
import type { OrganizationBranding } from '../../types/organizationBranding';
import type { StaffProfile } from '../../types/staffProfile';
import type { CaseTask } from '../../types/task';
import type { Membership } from '../../types/membership';
import type { Identity, IdentitySecrets } from '../../types/identity';
import { GUS_ORGANIZATION_ID } from './organizationIds';
import { gusWorkflowTemplateFixture } from './workflowTemplates';
import { buildCaseWorkflowSnapshot } from '../../domain/workflow/snapshot';
import { formatCaseNumber } from '../../domain/cases/caseNumber';
import { hashPassword } from '../../lib/identity/passwordHashing';

/**
 * Gus Camacho Jr. Funeral Home — LOCAL DEVELOPMENT / DEMO fixtures (2026-10).
 *
 * Everything here is FICTIONAL: the staff, families, decedents, phone
 * numbers (555 exchange) and email addresses (`.test`/`example.test`
 * domains, which can never deliver) are invented for mock mode only. No
 * real Gus Camacho Jr. Funeral Home data, address, phone or license number
 * appears anywhere — those are "To be configured" by the funeral home
 * itself through Settings on the real (Wix) deployment.
 *
 * Only ever read through the `services/__mocks__/*Fixtures.ts` collections
 * the services' MOCK branches use — wix data mode never sees any of it.
 * See docs/LOCAL_DEVELOPMENT.md.
 *
 * Dependency note: this module may import organizationIds.ts and
 * workflowTemplates.ts only — fixtures.ts / authFixtures.ts /
 * identityFixtures.ts / rbacFixtures.ts / onboardingFixtures.ts import
 * FROM here, so importing any of them back would be circular.
 */

export { GUS_ORGANIZATION_ID };

export const GUS_ORGANIZATION_NAME = 'Gus Camacho Jr. Funeral Home';
export const GUS_CASE_NUMBER_PREFIX = 'M';

/** Never a real secret — the fixed, documented demo password for every Gus
    mock identity below (mock data mode only; a wix-mode identity always
    has its own freshly hashed password). */
export const GUS_DEMO_PASSWORD = 'GusDemo123!';

export const GUS_ADMIN_EMAIL = 'admin@gus-camacho-jr.test';
export const GUS_DIRECTOR_EMAIL = 'director@gus-camacho-jr.test';
export const GUS_VIEWER_EMAIL = 'viewer@gus-camacho-jr.test';

export const GUS_ADMIN_IDENTITY_ID = 'identity-gus-admin';
export const GUS_DIRECTOR_IDENTITY_ID = 'identity-gus-director';
export const GUS_VIEWER_IDENTITY_ID = 'identity-gus-viewer';
export const GUS_ADMIN_MEMBERSHIP_ID = 'membership-gus-admin';
export const GUS_DIRECTOR_MEMBERSHIP_ID = 'membership-gus-director';
export const GUS_VIEWER_MEMBERSHIP_ID = 'membership-gus-viewer';
export const GUS_ADMIN_STAFF_ID = 'staff-gus-admin';
export const GUS_DIRECTOR_STAFF_ID = 'staff-gus-director';
export const GUS_VIEWER_STAFF_ID = 'staff-gus-viewer';

const NOW = '2026-10-01T00:00:00.000Z';

export function buildGusOrganizationFixture(): Organization {
  return {
    id: GUS_ORGANIZATION_ID,
    name: GUS_ORGANIZATION_NAME,
    isActive: true,
    slug: GUS_ORGANIZATION_ID,
    status: 'active',
    caseNumberPrefix: GUS_CASE_NUMBER_PREFIX,
  };
}

/** No logo: Gus' real artwork is uploaded through Settings > Branding on
    the real deployment, never shipped in the repo as sample data. With a
    null logo the login card and sidebar show the organization name alone. */
export function buildGusBrandingFixture(): OrganizationBranding {
  return {
    organizationId: GUS_ORGANIZATION_ID,
    logoUrl: null,
    signInLogoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    emailFromName: GUS_ORGANIZATION_NAME,
    documentFooter: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

type GusStaffSeed = {
  identityId: string;
  membershipId: string;
  staffId: string;
  email: string;
  displayName: string;
  /** A Phase 22 default role key — permissions come ONLY from the role
      model (domain/rbac/defaultRoles.ts), never from this fixture. */
  roleKey: 'administrator' | 'funeralDirector' | 'readOnly';
  staffRole: StaffProfile['role'];
};

const GUS_STAFF: readonly GusStaffSeed[] = [
  {
    identityId: GUS_ADMIN_IDENTITY_ID,
    membershipId: GUS_ADMIN_MEMBERSHIP_ID,
    staffId: GUS_ADMIN_STAFF_ID,
    email: GUS_ADMIN_EMAIL,
    displayName: 'Avery Demo',
    roleKey: 'administrator',
    staffRole: 'funeral_director',
  },
  {
    identityId: GUS_DIRECTOR_IDENTITY_ID,
    membershipId: GUS_DIRECTOR_MEMBERSHIP_ID,
    staffId: GUS_DIRECTOR_STAFF_ID,
    email: GUS_DIRECTOR_EMAIL,
    displayName: 'Jordan Demo',
    roleKey: 'funeralDirector',
    staffRole: 'funeral_director',
  },
  {
    identityId: GUS_VIEWER_IDENTITY_ID,
    membershipId: GUS_VIEWER_MEMBERSHIP_ID,
    staffId: GUS_VIEWER_STAFF_ID,
    email: GUS_VIEWER_EMAIL,
    displayName: 'Riley Demo',
    roleKey: 'readOnly',
    staffRole: 'staff',
  },
];

/** Same shape as identityFixtures.ts's MockIdentityRecord (redeclared to
    avoid a circular import). `passwordHash` is a getter for the same
    reason that file documents: hashing uses Node crypto, which must never
    run when this module is evaluated in a browser bundle. */
export function buildGusIdentityFixtures(): Array<Identity & IdentitySecrets> {
  return GUS_STAFF.map((seed) => ({
    id: seed.identityId,
    email: seed.email,
    normalizedEmail: seed.email.toLowerCase(),
    displayName: seed.displayName,
    phone: null,
    status: 'active' as const,
    emailVerified: true,
    passwordVersion: 1,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    get passwordHash() {
      return hashPassword(GUS_DEMO_PASSWORD);
    },
    mfaSecretReference: null,
    mfaVerifiedAt: null,
    mfaRecoveryCodeHashes: [],
  }));
}

/** Memberships ONLY in Gus — no Gus identity can reach any other tenant. */
export function buildGusMembershipFixtures(): Membership[] {
  return GUS_STAFF.map((seed) => ({
    id: seed.membershipId,
    identityId: seed.identityId,
    organizationId: GUS_ORGANIZATION_ID,
    role: seed.roleKey,
    status: 'active' as const,
    invitedBy: seed.identityId === GUS_ADMIN_IDENTITY_ID ? null : GUS_ADMIN_IDENTITY_ID,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

export function buildGusStaffFixtures(): StaffProfile[] {
  return GUS_STAFF.map((seed) => ({
    id: seed.staffId,
    organizationId: GUS_ORGANIZATION_ID,
    identityId: seed.identityId,
    membershipId: seed.membershipId,
    displayName: seed.displayName,
    role: seed.staffRole,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

type GusCaseSeed = {
  decedentName: string;
  dateOfBirth: string;
  /** Days before "today" the death occurred — keeps the demo data current
      whatever day the dev server starts. */
  daysAgo: number;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
  nextOfKinEmail: string | null;
  nextOfKinRelationship: Case['nextOfKinRelationship'];
  assignedStaffId: string | null;
  rawStage: number;
  daysWaitingInStage: number;
  isStalled: boolean;
  stalledReason?: string;
  paymentStatus: Case['paymentStatus'];
};

/** Spread across every raw stage of the standard workflow (0-7), with two
    stalled cases and one unassigned case so "Cases by stage" and "Needs
    attention" both have something to show. */
const GUS_CASE_SEEDS: readonly GusCaseSeed[] = [
  { decedentName: 'EXAMPLE DECEDENT ONE', dateOfBirth: '02/11/1944', daysAgo: 0, timeOfDeath: '05:40', placeOfDeath: 'SAMPLE GENERAL HOSPITAL', weight: '170 lb', nextOfKinName: 'TAYLOR SAMPLE', nextOfKinPhone: '(555) 010-0101', nextOfKinEmail: 'taylor.sample@example.test', nextOfKinRelationship: 'daughter', assignedStaffId: null, rawStage: 0, daysWaitingInStage: 0, isStalled: false, paymentStatus: 'awaiting_payment' },
  { decedentName: 'EXAMPLE DECEDENT TWO', dateOfBirth: '07/23/1950', daysAgo: 1, timeOfDeath: '22:15', placeOfDeath: 'FAMILY HOME', weight: '182 lb', nextOfKinName: 'MORGAN EXAMPLE', nextOfKinPhone: '(555) 010-0102', nextOfKinEmail: 'morgan.example@example.test', nextOfKinRelationship: 'spouse', assignedStaffId: GUS_DIRECTOR_STAFF_ID, rawStage: 1, daysWaitingInStage: 1, isStalled: false, paymentStatus: 'paid_in_full' },
  { decedentName: 'EXAMPLE DECEDENT THREE', dateOfBirth: '12/02/1939', daysAgo: 3, timeOfDeath: '13:05', placeOfDeath: 'SAMPLE HOSPICE CENTER', weight: '138 lb', nextOfKinName: 'CASEY PLACEHOLDER', nextOfKinPhone: '(555) 010-0103', nextOfKinEmail: null, nextOfKinRelationship: 'son', assignedStaffId: GUS_ADMIN_STAFF_ID, rawStage: 2, daysWaitingInStage: 2, isStalled: false, paymentStatus: 'paid_in_full' },
  { decedentName: 'EXAMPLE DECEDENT FOUR', dateOfBirth: '04/30/1948', daysAgo: 8, timeOfDeath: '03:20', placeOfDeath: 'SAMPLE COUNTY MEDICAL EXAMINER', weight: '205 lb', nextOfKinName: 'JAMIE FICTIONAL', nextOfKinPhone: '(555) 010-0104', nextOfKinEmail: 'jamie.fictional@example.test', nextOfKinRelationship: 'sister', assignedStaffId: GUS_DIRECTOR_STAFF_ID, rawStage: 3, daysWaitingInStage: 7, isStalled: true, stalledReason: 'Waiting on medical examiner release — 7 days', paymentStatus: 'paid_in_full' },
  { decedentName: 'EXAMPLE DECEDENT FIVE', dateOfBirth: '09/14/1956', daysAgo: 6, timeOfDeath: '18:45', placeOfDeath: 'SAMPLE NURSING FACILITY', weight: '160 lb', nextOfKinName: 'QUINN DEMO', nextOfKinPhone: '(555) 010-0105', nextOfKinEmail: null, nextOfKinRelationship: 'nephew', assignedStaffId: GUS_ADMIN_STAFF_ID, rawStage: 3, daysWaitingInStage: 4, isStalled: true, stalledReason: 'Death certificate not yet signed by physician — 4 days', paymentStatus: 'awaiting_payment' },
  { decedentName: 'EXAMPLE DECEDENT SIX', dateOfBirth: '01/05/1941', daysAgo: 9, timeOfDeath: '09:10', placeOfDeath: 'SAMPLE GENERAL HOSPITAL', weight: '150 lb', nextOfKinName: 'ROWAN SAMPLE', nextOfKinPhone: '(555) 010-0106', nextOfKinEmail: 'rowan.sample@example.test', nextOfKinRelationship: 'grandchild', assignedStaffId: GUS_DIRECTOR_STAFF_ID, rawStage: 4, daysWaitingInStage: 1, isStalled: false, paymentStatus: 'paid_in_full' },
  { decedentName: 'EXAMPLE DECEDENT SEVEN', dateOfBirth: '06/18/1952', daysAgo: 12, timeOfDeath: '16:30', placeOfDeath: 'FAMILY HOME', weight: '175 lb', nextOfKinName: 'SKYLER EXAMPLE', nextOfKinPhone: '(555) 010-0107', nextOfKinEmail: null, nextOfKinRelationship: 'spouse', assignedStaffId: GUS_ADMIN_STAFF_ID, rawStage: 5, daysWaitingInStage: 2, isStalled: false, paymentStatus: 'paid_in_full' },
  { decedentName: 'EXAMPLE DECEDENT EIGHT', dateOfBirth: '03/27/1935', daysAgo: 15, timeOfDeath: '11:55', placeOfDeath: 'SAMPLE HOSPICE CENTER', weight: '128 lb', nextOfKinName: 'DREW PLACEHOLDER', nextOfKinPhone: '(555) 010-0108', nextOfKinEmail: 'drew.placeholder@example.test', nextOfKinRelationship: 'daughter', assignedStaffId: GUS_DIRECTOR_STAFF_ID, rawStage: 6, daysWaitingInStage: 1, isStalled: false, paymentStatus: 'paid_in_full' },
  { decedentName: 'EXAMPLE DECEDENT NINE', dateOfBirth: '10/09/1947', daysAgo: 21, timeOfDeath: '07:25', placeOfDeath: 'SAMPLE GENERAL HOSPITAL', weight: '190 lb', nextOfKinName: 'HAYDEN FICTIONAL', nextOfKinPhone: '(555) 010-0109', nextOfKinEmail: null, nextOfKinRelationship: 'son', assignedStaffId: GUS_ADMIN_STAFF_ID, rawStage: 7, daysWaitingInStage: 0, isStalled: false, paymentStatus: 'paid_in_full' },
];

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatMmDdYyyy(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

/**
 * Gus' demo cases, numbered `M<year>-001`, `-002`, ... for the CURRENT
 * year (never a hardcoded one), each on Gus' own workflow template's frozen
 * snapshot. Dates are whole UTC days relative to `now`, so the server and
 * browser bundles (both evaluate this module in mock mode) produce
 * identical rows.
 */
export function buildGusCaseFixtures(now: Date = new Date()): Case[] {
  const today = startOfUtcDay(now);
  const year = today.getUTCFullYear();
  const version = gusWorkflowTemplateFixture.versions[gusWorkflowTemplateFixture.versions.length - 1];

  return GUS_CASE_SEEDS.map((seed, index) => {
    const deathDate = new Date(today.getTime() - seed.daysAgo * 24 * 60 * 60 * 1000);
    return {
      id: `gus-case-${String(index + 1).padStart(3, '0')}`,
      organizationId: GUS_ORGANIZATION_ID,
      caseNumber: formatCaseNumber(year, index + 1, GUS_CASE_NUMBER_PREFIX),
      decedentName: seed.decedentName,
      dateOfBirth: seed.dateOfBirth,
      dateOfDeath: formatMmDdYyyy(deathDate),
      timeOfDeath: seed.timeOfDeath,
      placeOfDeath: seed.placeOfDeath,
      weight: seed.weight,
      rawStage: seed.rawStage,
      assignedStaffId: seed.assignedStaffId,
      nextOfKinName: seed.nextOfKinName,
      nextOfKinPhone: seed.nextOfKinPhone,
      nextOfKinEmail: seed.nextOfKinEmail,
      nextOfKinRelationship: seed.nextOfKinRelationship,
      nextOfKinRelationshipOther: null,
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
      tagNumber: null,
      paymentStatus: seed.paymentStatus,
      pickupStatus: 'awaiting_pickup',
      pickupReleasedTo: null,
      pickupReleasedAt: null,
      pickupNote: null,
      returnMethod: 'undecided',
      shippingCarrier: null,
      shippingTrackingNumber: null,
      shippingDateShipped: null,
      shippingDeliveryStatus: null,
      shippingDeliveredAt: null,
      isVeteran: false,
      vaStepsState: {},
      vaPublishChoice: null,
      vaNotificationResponsibility: null,
      checklistState: {},
      fieldValues: {},
      daysWaitingInStage: seed.daysWaitingInStage,
      isStalled: seed.isStalled,
      stalledReason: seed.stalledReason ?? null,
      createdBy: seed.assignedStaffId,
      intakeOwnerId: seed.assignedStaffId,
      createdAt: deathDate.toISOString(),
      isDeleted: false,
      workflowTemplateId: gusWorkflowTemplateFixture.id,
      workflowTemplateVersion: version.version,
      caseType: 'cremation',
      workflowSnapshot: buildCaseWorkflowSnapshot(gusWorkflowTemplateFixture, version),
    };
  });
}

export function buildGusTaskFixtures(now: Date = new Date()): CaseTask[] {
  const created = formatMmDdYyyy(startOfUtcDay(now));
  return [
    { id: 'gus-task-1', organizationId: GUS_ORGANIZATION_ID, text: 'Call medical examiner re: release (demo task)', assigneeStaffId: GUS_DIRECTOR_STAFF_ID, isDone: false, caseId: 'gus-case-004', dueDate: null, createdAt: created },
    { id: 'gus-task-2', organizationId: GUS_ORGANIZATION_ID, text: 'Confirm Gus price list and service catalog (setup)', assigneeStaffId: GUS_ADMIN_STAFF_ID, isDone: false, caseId: null, dueDate: null, createdAt: created },
    { id: 'gus-task-3', organizationId: GUS_ORGANIZATION_ID, text: 'Upload organization logo in Settings (setup)', assigneeStaffId: GUS_ADMIN_STAFF_ID, isDone: true, caseId: null, dueDate: null, createdAt: created },
  ];
}
