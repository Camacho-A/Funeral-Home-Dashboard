import type { Case, PaymentStatus } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import type { CaseTask } from '../../types/task';
import type { CaseLogEntry } from '../../types/caseLogEntry';
import type { CaseDocument } from '../../types/document';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import { standardCremationWorkflowTemplateFixture } from './workflowTemplates';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../../domain/workflow/snapshot';

/**
 * Re-exported from ./organizationIds (not declared here) so
 * workflowTemplates.ts can depend on the same constant without a circular
 * import back to this file — see organizationIds.ts's own comment. Existing
 * callers (hooks/useOrganization.tsx, tests) keep importing it from here
 * unchanged.
 */
export { DEFAULT_ORGANIZATION_ID };

export const staffFixtures: StaffProfile[] = [
  {
    id: 'staff-dana',
    organizationId: DEFAULT_ORGANIZATION_ID,
    displayName: 'Dana',
    role: 'funeral_director',
    isActive: true,
  },
  {
    id: 'staff-chris',
    organizationId: DEFAULT_ORGANIZATION_ID,
    displayName: 'Chris',
    role: 'funeral_director',
    isActive: true,
  },
  {
    id: 'staff-priya',
    organizationId: DEFAULT_ORGANIZATION_ID,
    displayName: 'Priya',
    role: 'staff',
    isActive: true,
  },
];

function staffIdForOwnerName(ownerName: string): string | null {
  if (ownerName === '—') return null;
  const staff = staffFixtures.find((s) => s.displayName === ownerName);
  return staff?.id ?? null;
}

function toPaymentStatus(label: string): PaymentStatus {
  return label === 'Paid in full' ? 'paid_in_full' : 'awaiting_payment';
}

type RawSeedCase = {
  id: string;
  name: string;
  dob: string;
  dod: string;
  tod: string;
  location: string;
  weight: string;
  nok: string;
  nokPhone: string;
  owner: string;
  stage: number;
  daysWaiting: number;
  stalled: boolean;
  stalledReason?: string;
  paymentStatus: string;
  seedFields?: Record<number, string>;
};

/**
 * Ported verbatim from design/support.js's RAW_CASES (8 cases). `seedFields`
 * (only present on case 1046 in the original, to demonstrate a case with
 * First Call & Payment data already on file) is merged directly into
 * `fieldValues` here — in the original prototype these were two separate
 * layers (a fallback default vs. live-edited session state) only because
 * that architecture had no real persistence; here, a case's field values
 * are simply its real, persisted data from the start.
 */
const RAW_SEED_CASES: RawSeedCase[] = [
  {
    id: '1042',
    name: 'Robert Ellison',
    dob: '03/14/1951',
    dod: '07/09/2026',
    tod: '06:12',
    location: "St. Mary's Hospital",
    weight: '178 lb',
    nok: 'Karen Ellison',
    nokPhone: '(555) 201-4432',
    owner: 'Dana',
    stage: 3,
    daysWaiting: 6,
    stalled: true,
    stalledReason: 'Waiting on ME release — 6 days',
    paymentStatus: 'Paid in full',
  },
  {
    id: '1043',
    name: 'Marie Suarez',
    dob: '11/02/1938',
    dod: '07/12/2026',
    tod: '23:40',
    location: 'Hillcrest Hospice',
    weight: '142 lb',
    nok: 'Luis Suarez',
    nokPhone: '(555) 330-8871',
    owner: 'Chris',
    stage: 2,
    daysWaiting: 1,
    stalled: false,
    paymentStatus: 'Paid in full',
  },
  {
    id: '1044',
    name: 'Walter Boone',
    dob: '06/22/1945',
    dod: '07/13/2026',
    tod: '14:05',
    location: 'Riverside Nursing Facility',
    weight: '165 lb',
    nok: 'Diane Boone',
    nokPhone: '(555) 442-0093',
    owner: 'Dana',
    stage: 0,
    daysWaiting: 0,
    stalled: false,
    paymentStatus: 'Awaiting payment',
  },
  {
    id: '1045',
    name: 'Helen Tran',
    dob: '09/30/1960',
    dod: '07/05/2026',
    tod: '08:50',
    location: 'Family home',
    weight: '120 lb',
    nok: 'Michael Tran',
    nokPhone: '(555) 118-2200',
    owner: 'Chris',
    stage: 6,
    daysWaiting: 2,
    stalled: false,
    paymentStatus: 'Paid in full',
  },
  {
    id: '1046',
    name: 'George Alvarez',
    dob: '01/09/1955',
    dod: '06/28/2026',
    tod: '04:30',
    location: 'County Medical Examiner',
    weight: '215 lb',
    nok: 'Sofia Alvarez',
    nokPhone: '(555) 771-6620',
    owner: 'Priya',
    stage: 3,
    daysWaiting: 9,
    stalled: true,
    stalledReason: 'Death cert not yet filed by physician — 9 days',
    paymentStatus: 'Paid in full',
    seedFields: {
      0: 'George Robert Alvarez',
      1: 'County Medical Examiner — 1500 Grant Ave, San Jose — (408) 555-2231',
      2: '01/09/1955',
      3: '215 lb',
      4: '06/28/2026',
      5: '04:30',
      6: 'Dr. Linda Choi — (408) 555-8890',
      7: 'Sofia Alvarez — (555) 771-6620 — sofia.alvarez@email.com',
      8: 'George R. Alvarez — •••• •••• •••• 4471 — 09/28 — 94112',
    },
  },
  {
    id: '1047',
    name: 'Nancy Whitfield',
    dob: '04/18/1948',
    dod: '07/14/2026',
    tod: '21:22',
    location: "St. Mary's Hospital",
    weight: '—',
    nok: 'Tom Whitfield',
    nokPhone: '(555) 902-1145',
    owner: '—',
    stage: 0,
    daysWaiting: 0,
    stalled: false,
    paymentStatus: 'Awaiting payment',
  },
  {
    id: '1048',
    name: 'Arthur Kim',
    dob: '12/05/1942',
    dod: '07/01/2026',
    tod: '13:15',
    location: 'Third-party crematory',
    weight: '156 lb',
    nok: 'Grace Kim',
    nokPhone: '(555) 665-3390',
    owner: 'Priya',
    stage: 6,
    daysWaiting: 1,
    stalled: false,
    paymentStatus: 'Paid in full',
  },
  {
    id: '1049',
    name: 'Linda Ferro',
    dob: '08/27/1958',
    dod: '06/30/2026',
    tod: '07:05',
    location: 'Office',
    weight: '—',
    nok: 'Anna Ferro',
    nokPhone: '(555) 553-7712',
    owner: 'Dana',
    stage: 7,
    daysWaiting: 0,
    stalled: false,
    paymentStatus: 'Paid in full',
  },
];

const standardCremationV1 = latestTemplateVersion(standardCremationWorkflowTemplateFixture);

/**
 * Phase 11 migration (see docs/TEMPLATE_VERSIONING.md's migration notes):
 * every pre-existing seed case is backfilled onto the Managed Cremations
 * v1 template — the only workflow that has ever existed for this
 * organization's data, so there's nothing ambiguous to migrate. Each case
 * gets its own structuredClone (via buildCaseWorkflowSnapshot) rather than
 * one shared object, so nothing could ever leak a mutation from one case's
 * snapshot into another's even though none is ever mutated in practice.
 */
export const caseFixtures: Case[] = RAW_SEED_CASES.map((raw) => ({
  id: raw.id,
  organizationId: DEFAULT_ORGANIZATION_ID,
  decedentName: raw.name,
  dateOfBirth: raw.dob,
  dateOfDeath: raw.dod,
  timeOfDeath: raw.tod,
  placeOfDeath: raw.location,
  weight: raw.weight,
  rawStage: raw.stage,
  assignedStaffId: staffIdForOwnerName(raw.owner),
  nextOfKinName: raw.nok,
  nextOfKinPhone: raw.nokPhone,
  paymentStatus: toPaymentStatus(raw.paymentStatus),
  isVeteran: false,
  vaStepsState: {},
  vaPublishChoice: null,
  checklistState: {},
  fieldValues: raw.seedFields ?? {},
  daysWaitingInStage: raw.daysWaiting,
  isStalled: raw.stalled,
  stalledReason: raw.stalledReason ?? null,
  createdBy: null,
  intakeOwnerId: null, // predates this field — who actually took these historical calls is genuinely unknown, not backfilled
  createdAt: raw.dod, // no separate case-creation timestamp in the original seed data
  isDeleted: false,
  workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
  workflowTemplateVersion: standardCremationV1.version,
  caseType: 'cremation',
  workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, standardCremationV1),
}));

/**
 * Ported verbatim from design/support.js's initial `tasks` state (3 seed
 * tasks, none case-linked in the source data).
 */
export const taskFixtures: CaseTask[] = [
  {
    id: 'task-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    text: "Call ME's office re: George Alvarez release",
    assigneeStaffId: 'staff-priya',
    isDone: false,
    caseId: null,
    createdAt: '07/14/2026',
  },
  {
    id: 'task-2',
    organizationId: DEFAULT_ORGANIZATION_ID,
    text: 'Order more wooden urns — running low',
    assigneeStaffId: 'staff-dana',
    isDone: false,
    caseId: null,
    createdAt: '07/14/2026',
  },
  {
    id: 'task-3',
    organizationId: DEFAULT_ORGANIZATION_ID,
    text: 'Follow up voicemail — Tran family',
    assigneeStaffId: 'staff-chris',
    isDone: true,
    caseId: null,
    createdAt: '07/14/2026',
  },
];

/**
 * The Dashboard's "Recent activity" feed, ported verbatim from
 * design/support.js's renderVals(). This is static, decorative content in
 * the prototype itself — not derived from any case's real state changes
 * (there's no activity-log service backing it) — so it's kept here as mock
 * content, same as the other fixtures, rather than invented as "real" data
 * with no actual source.
 */
export const activityFeedFixtures: Array<{ who: string; what: string; when: string }> = [
  { who: 'Chris', what: 'confirmed payment for Marie Suarez', when: '10 min ago' },
  { who: 'Removal team', what: 'confirmed pickup for Walter Boone', when: '1 hr ago' },
  { who: 'Priya', what: 'marked ashes ready for Arthur Kim', when: '3 hrs ago' },
  { who: 'System', what: 'flagged George Alvarez — 9 days awaiting cert', when: 'Today, 8:00am' },
];

/**
 * Both start empty — matching design/support.js's initial `logState: {}`
 * and `uploadedDocs: {}` exactly: no case in the prototype's seed data has
 * any case log entries or uploaded documents until a user adds them.
 */
export const caseLogFixtures: CaseLogEntry[] = [];
export const documentFixtures: CaseDocument[] = [];

/**
 * Uploaded documents' actual browser File objects, keyed by document id —
 * kept out of the CaseDocument type itself (a real backend would store
 * bytes in object storage, not a JS File reference; see
 * docs/ARCHITECTURE.md). Used only by documentsService's mock
 * implementation to support the Print feature (utils/print.ts's printFile).
 */
export const documentFilesById = new Map<string, File>();
