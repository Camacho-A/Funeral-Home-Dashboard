import { describe, expect, it } from 'vitest';
import { buildGusCaseFixtures, buildGusStaffFixtures, fictionalDirectorLicense } from '../../services/__mocks__/gusFixtures';
import { GUS_CAMACHO_ORGANIZATION_ID, getRegisteredOrganizationProfile, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { CREMATION_STEPS } from '../workflow/cremationFoundation';
import { findStep } from '../workflow/workflowSteps';
import { checklistItemKey } from '../workflow/checklistItemKey';
import { checkFuneralDirectorLicense, PROPOSED_LICENSE_REVERIFY_DAYS } from '../staff/funeralDirectorLicense';
import { applyPreparationChange, PreparationChangeError, type PreparationChange } from './preparationUpdates';
import { summarizeServiceReadiness } from './readiness';
import { buildCremationReleaseRecord, deathInstant, evaluateReleaseForCremation, type ReleaseApprover } from './releaseForCremation';
import { FINAL_GOODBYE_PREPARATION, VIEWING_PREPARATION } from './serviceDefinitions';
import type { ServiceEvent, ServicePreparationDefinition, ServicePreparationRecord } from './types';
import type { Case } from '../../types/case';

/** Gus Phase 5F — confirmed Viewing / Final Goodbye rules and release safety. Fictional data only. */

const NOW = '2026-12-12T15:00:00.000Z';
const TZ = 'America/New_York';
const actor = { id: 'identity-gus-director', name: 'Jordan Demo' };
let n = 0;
const svc = (overrides: Partial<ServiceEvent> = {}): ServiceEvent => ({
  appointmentId: 'appt-fictional',
  startAt: '2026-12-10T15:00:00.000Z',
  endAt: '2026-12-10T16:00:00.000Z',
  status: 'scheduled',
  bookedAt: '2026-12-01T12:00:00.000Z',
  ...overrides,
});
const apply = (definition: ServicePreparationDefinition, changes: PreparationChange[], service: ServiceEvent | null = svc(), start: ServicePreparationRecord | null = null) =>
  changes.reduce<ServicePreparationRecord | null>(
    (record, change) => applyPreparationChange({ definition, record, service, change, actor, now: '2026-12-02T12:00:00.000Z', eventId: `e-${++n}` }),
    start,
  ) as ServicePreparationRecord;
const readiness = (definition: ServicePreparationDefinition, record: ServicePreparationRecord | null, service: ServiceEvent | null = svc(), now = '2026-12-05T12:00:00.000Z') =>
  summarizeServiceReadiness({ definition, record, service, now });

describe('Cremation with Viewing (Gus)', () => {
  it('embalming, clothing and casket always apply — there is no choice that switches them off', () => {
    const ids = readiness(VIEWING_PREPARATION, null).items.map((i) => i.id);
    for (const id of [
      'prep.embalming.written_permission',
      'prep.embalming.authorization_sent',
      'prep.embalming.completed',
      'prep.clothing.received',
      'prep.clothing.delivered',
      'prep.clothing.dressed',
      'prep.casket.selected',
      'prep.casket.ordered',
      'prep.casket.delivered_to_crematory',
      'prep.casket.casketed',
      'prep.crematory.notified',
    ]) {
      expect(ids).toContain(id);
    }
    expect(VIEWING_PREPARATION.choices.map((c) => c.key)).not.toContain('embalming');
  });

  it('no embalming waiver: the embalming steps can never be marked Not requested, and there is no embalming choice', () => {
    for (const itemId of ['prep.embalming.written_permission', 'prep.embalming.authorization_sent', 'prep.embalming.completed']) {
      expect(() => apply(VIEWING_PREPARATION, [{ kind: 'item', itemId, status: 'not_requested' }])).toThrow(/required/);
    }
    expect(() => apply(VIEWING_PREPARATION, [{ kind: 'choice', choice: 'embalming', value: 'not_embalmed' }])).toThrow(PreparationChangeError);
  });

  it('is not ready until the embalming, dressing and casketing are confirmed', () => {
    const allButCasketing = apply(
      VIEWING_PREPARATION,
      [
        ...['casketSpray', 'prayerCards', 'registerBook', 'crucifix'].map((choice): PreparationChange => ({ kind: 'choice', choice, value: 'not_requested' })),
        ...VIEWING_PREPARATION.groups.flatMap((g) => g.items).filter((i) => i.requirement === 'required' && i.id !== 'prep.casket.casketed').map((i): PreparationChange => ({ kind: 'item', itemId: i.id, status: i.kind === 'task' ? 'completed' : 'confirmed' })),
      ],
    );
    expect(readiness(VIEWING_PREPARATION, allButCasketing).ready).toBe(false);
    const all = apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.casket.casketed', status: 'confirmed' }], svc(), allButCasketing);
    expect(readiness(VIEWING_PREPARATION, all).ready).toBe(true);
  });
});

describe('Cremation with Final Goodbye (Gus)', () => {
  it('Miami chapel, attendees, the covered container and the crematory notice are required; nothing about embalming or a casket', () => {
    const ids = readiness(FINAL_GOODBYE_PREPARATION, null).items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['prep.final_goodbye.chapel_reserved', 'prep.final_goodbye.attendees_confirmed', 'prep.final_goodbye.container_prepared', 'prep.crematory.notified']));
    expect(ids.some((id) => /^prep\.(embalming|casket|clothing|prayer_cards|register_book|crucifix)\./.test(id))).toBe(false);
  });

  it('allows at most six attendees', () => {
    const six = apply(FINAL_GOODBYE_PREPARATION, [{ kind: 'detail', key: 'finalGoodbye.attendees', value: '6' }]);
    expect(six.details['finalGoodbye.attendees'].value).toBe('6');
    expect(() => apply(FINAL_GOODBYE_PREPARATION, [{ kind: 'detail', key: 'finalGoodbye.attendees', value: '7' }])).toThrow(/no more than 6/);
    expect(() => apply(FINAL_GOODBYE_PREPARATION, [{ kind: 'detail', key: 'finalGoodbye.attendees', value: 'six' }])).toThrow(/whole number/);
  });

  it('flags a service booked longer than 60 minutes (provisional) for review, without blocking', () => {
    expect(readiness(FINAL_GOODBYE_PREPARATION, null, svc({ endAt: '2026-12-10T16:00:00.000Z' })).warnings).toEqual([]);
    const long = readiness(FINAL_GOODBYE_PREPARATION, null, svc({ endAt: '2026-12-10T16:30:00.000Z' }));
    expect(long.warnings[0]).toMatch(/90 minutes.*up to 60 minutes \(provisional\)/);
  });

  it('face-only viewing and a priest or pastor are the family’s choice', () => {
    expect(readiness(FINAL_GOODBYE_PREPARATION, null).decisions.map((d) => d.choice)).toEqual(['faceViewing', 'clergy']);
    const declined = apply(FINAL_GOODBYE_PREPARATION, [
      { kind: 'choice', choice: 'faceViewing', value: 'not_requested' },
      { kind: 'choice', choice: 'clergy', value: 'not_requested' },
    ]);
    const items = readiness(FINAL_GOODBYE_PREPARATION, declined).items;
    expect(items.find((i) => i.id === 'prep.final_goodbye.face_prepared')!.status).toBe('not_requested');
    expect(items.find((i) => i.id === 'prep.clergy.confirmed')!.status).toBe('not_requested');
  });

  it('after a reschedule the chapel and the crematory hold must be confirmed again', () => {
    const record = apply(FINAL_GOODBYE_PREPARATION, [
      { kind: 'item', itemId: 'prep.final_goodbye.chapel_reserved', status: 'confirmed' },
      { kind: 'item', itemId: 'prep.crematory.hold_confirmed', status: 'confirmed' },
    ]);
    const moved = readiness(FINAL_GOODBYE_PREPARATION, record, svc({ startAt: '2026-12-11T15:00:00.000Z', endAt: '2026-12-11T16:00:00.000Z' }));
    expect(moved.items.find((i) => i.id === 'prep.final_goodbye.chapel_reserved')!.status).toBe('needs_reconfirmation');
    expect(moved.items.find((i) => i.id === 'prep.crematory.hold_confirmed')!.status).toBe('needs_reconfirmation');
  });
});

describe('funeral director license', () => {
  const director = buildGusStaffFixtures().find((s) => s.displayName === 'Jordan Demo')!;
  const admin = buildGusStaffFixtures().find((s) => s.displayName === 'Avery Demo')!;
  const check = (staff: Parameters<typeof checkFuneralDirectorLicense>[0], now = new Date().toISOString()) =>
    checkFuneralDirectorLicense(staff, { organizationId: GUS_CAMACHO_ORGANIZATION_ID, today: now.slice(0, 10), now, reverifyWithinDays: PROPOSED_LICENSE_REVERIFY_DAYS });

  it('a verified, active, unexpired license passes', () => {
    expect(check(director)).toEqual({ verified: true, problems: [], notes: [] });
  });

  it('a "funeral director" role or display role is not a license', () => {
    expect(admin.role).toBe('funeral_director');
    expect(check(admin)).toMatchObject({ verified: false, problems: ['No funeral director license on file.'] });
  });

  it('expired, inactive, unverified, self-verified or stale licenses fail', () => {
    const base = fictionalDirectorLicense();
    expect(check({ ...director, funeralDirectorLicense: { ...base, expiresOn: '2020-01-31' } }).problems.join()).toMatch(/expired/);
    expect(check({ ...director, funeralDirectorLicense: { ...base, status: 'suspended' } }).problems.join()).toMatch(/suspended/);
    expect(check({ ...director, funeralDirectorLicense: { ...base, verification: null } }).problems.join()).toMatch(/not been verified/);
    expect(check({ ...director, funeralDirectorLicense: { ...base, verification: { ...base.verification!, verifiedBy: director.identityId } } }).problems.join()).toMatch(/someone other than/);
    const old = new Date(Date.now() - (PROPOSED_LICENSE_REVERIFY_DAYS + 1) * 86_400_000).toISOString();
    expect(check({ ...director, funeralDirectorLicense: { ...base, verification: { ...base.verification!, verifiedAt: old } } }).problems.join()).toMatch(/more than 365 days/);
    expect(check({ ...director, isActive: false }).verified).toBe(false);
    expect(checkFuneralDirectorLicense(director, { organizationId: MANORS_ORGANIZATION_ID, today: NOW.slice(0, 10), now: NOW, reverifyWithinDays: null }).verified).toBe(false);
  });
});

describe('release for cremation', () => {
  const viewingCase = buildGusCaseFixtures(new Date('2026-12-01T12:00:00.000Z')).find((c) => c.id === 'gus-case-010')!;
  const staff = buildGusStaffFixtures();
  const director = staff.find((s) => s.displayName === 'Jordan Demo')!;
  const admin = staff.find((s) => s.displayName === 'Avery Demo')!;
  const viewer = staff.find((s) => s.displayName === 'Riley Demo')!;
  const approverRoleKeys = getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.cremationReleaseApproverRoleKeys;
  const asDirector: ReleaseApprover = { identityId: director.identityId, roleKey: 'funeralDirector', staffProfile: { ...director, funeralDirectorLicense: fictionalDirectorLicense(new Date(NOW)) } };

  function legallyReadyCase(overrides: Partial<Case> = {}): Case {
    const stages = viewingCase.workflowSnapshot!.stages;
    const checklistState: Record<string, boolean> = { ...viewingCase.checklistState };
    for (const stepId of [CREMATION_STEPS.arrangementFormCompleted, CREMATION_STEPS.edrsSubmitted, CREMATION_STEPS.causeOfDeath, CREMATION_STEPS.attestation]) {
      const at = findStep(stages, stepId)!;
      checklistState[checklistItemKey(at.displayStage, at.index)] = true;
    }
    return {
      ...viewingCase,
      dateOfDeath: '12/08/2026',
      timeOfDeath: '09:00',
      checklistState,
      crematory: { permitVerification: { documentId: 'doc-permit', checksumSha256: 'fictional', verifiedBy: 'identity-gus-admin', verifiedAt: '2026-12-09T12:00:00.000Z' } },
      ...overrides,
    };
  }
  const prepDone = apply(VIEWING_PREPARATION, [
    { kind: 'item', itemId: 'prep.day_of.identification_verified', status: 'completed' },
    { kind: 'item', itemId: 'prep.embalming.written_permission', status: 'completed' },
    { kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' },
  ]);
  const evaluate = (params: { case_?: Case; record?: ServicePreparationRecord | null; service?: ServiceEvent | null; approver?: ReleaseApprover | null; me?: boolean; now?: string }) =>
    evaluateReleaseForCremation({
      case_: params.case_ ?? legallyReadyCase(),
      definition: VIEWING_PREPARATION,
      readiness: summarizeServiceReadiness({ definition: VIEWING_PREPARATION, record: params.record === undefined ? prepDone : params.record, service: params.service === undefined ? svc({ status: 'completed' }) : params.service, now: params.now ?? NOW }),
      approver: params.approver === undefined ? asDirector : params.approver,
      approverRoleKeys,
      licenseReverifyDays: PROPOSED_LICENSE_REVERIFY_DAYS,
      timeZone: TZ,
      now: params.now ?? NOW,
      medicalExaminerApprovalRecorded: params.me ?? true,
    });
  const unmet = (e: ReturnType<typeof evaluate>) => e.prerequisites.filter((p) => !p.met).map((p) => p.key);

  it('with every prerequisite met and a verified director, release would be allowed — but stays inactive', () => {
    const e = evaluate({});
    expect(unmet(e)).toEqual([]);
    expect(e.allPrerequisitesMet).toBe(true);
    expect(e.canRelease).toBe(false);
    expect(e.unavailableReason).toMatch(/not active yet/);
  });

  it('a state permit alone never unlocks release', () => {
    const permitOnly = { ...viewingCase, crematory: legallyReadyCase().crematory };
    const e = evaluate({ case_: permitOnly, record: null, service: svc(), me: false });
    expect(e.prerequisites.find((p) => p.key === 'state_permit')!.met).toBe(true);
    expect(e.allPrerequisitesMet).toBe(false);
  });

  it('the Viewing must be marked completed; scheduled is not enough', () => {
    expect(unmet(evaluate({ service: svc({ status: 'scheduled' }) }))).toEqual(['service_completed']);
    // With no service at all, the identification check (made for a service date) doesn't count either.
    expect(unmet(evaluate({ service: null }))).toEqual(['service_completed', 'identification']);
  });

  it('telling the crematory about the service is not a prerequisite — and is not a release', () => {
    expect(evaluate({}).prerequisites.map((p) => p.key)).not.toContain('crematory_notified');
    const notifiedOnly = apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.crematory.notified', status: 'completed' }]);
    expect(evaluate({ record: notifiedOnly }).allPrerequisitesMet).toBe(false);
  });

  it('each legal safeguard blocks on its own', () => {
    const ready = legallyReadyCase();
    const at = findStep(ready.workflowSnapshot!.stages, CREMATION_STEPS.attestation)!;
    expect(unmet(evaluate({ case_: { ...ready, checklistState: { ...ready.checklistState, [checklistItemKey(at.displayStage, at.index)]: false } } }))).toEqual(['edrs_complete']);
    const af = findStep(ready.workflowSnapshot!.stages, CREMATION_STEPS.arrangementFormCompleted)!;
    expect(unmet(evaluate({ case_: { ...ready, checklistState: { ...ready.checklistState, [checklistItemKey(af.displayStage, af.index)]: false } } }))).toEqual(['cremation_authorization']);
    expect(unmet(evaluate({ case_: { ...ready, crematory: {} } }))).toEqual(['state_permit']);
    expect(unmet(evaluate({ me: false }))).toEqual(['medical_examiner_approval']);
    expect(unmet(evaluate({ record: apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.embalming.written_permission', status: 'completed' }]) }))).toEqual(['identification']);
    expect(unmet(evaluate({ record: apply(VIEWING_PREPARATION, [{ kind: 'item', itemId: 'prep.day_of.identification_verified', status: 'completed' }]) }))).toEqual(['service_specific']);
  });

  it('the medical examiner approval is never met today: SOLIS has nowhere to record it', () => {
    const e = evaluateReleaseForCremation({
      case_: legallyReadyCase(),
      definition: VIEWING_PREPARATION,
      readiness: summarizeServiceReadiness({ definition: VIEWING_PREPARATION, record: prepDone, service: svc({ status: 'completed' }), now: NOW }),
      approver: asDirector,
      approverRoleKeys,
      licenseReverifyDays: PROPOSED_LICENSE_REVERIFY_DAYS,
      timeZone: TZ,
      now: NOW,
    });
    expect(unmet(e)).toEqual(['medical_examiner_approval']);
  });

  it('at least 48 hours since death, in the funeral home’s time zone; a missing date blocks', () => {
    // Death 12/08 09:00 Eastern = 14:00Z. 47 hours later is 12/10 13:00Z.
    expect(deathInstant('12/08/2026', '09:00', TZ)).toBe(Date.parse('2026-12-08T14:00:00.000Z'));
    expect(deathInstant('12/08/2026', '9:00 PM', TZ)).toBe(Date.parse('2026-12-09T02:00:00.000Z'));
    expect(unmet(evaluate({ now: '2026-12-10T13:00:00.000Z' }))).toEqual(['forty_eight_hours']);
    expect(unmet(evaluate({ now: '2026-12-10T14:00:00.000Z' }))).toEqual([]);
    expect(unmet(evaluate({ case_: legallyReadyCase({ dateOfDeath: '' }) }))).toEqual(['forty_eight_hours']);
    // No time recorded: counted from the end of that day.
    expect(deathInstant('12/08/2026', '', TZ)).toBe(Date.parse('2026-12-09T04:59:00.000Z'));
  });

  it('only an allowed role WITH a verified license may approve', () => {
    const adminApprover: ReleaseApprover = { identityId: admin.identityId, roleKey: 'administrator', staffProfile: admin };
    expect(unmet(evaluate({ approver: adminApprover }))).toEqual(['approver_authorized', 'approver_licensed']);
    const viewerWithLicense: ReleaseApprover = { identityId: viewer.identityId, roleKey: 'readOnly', staffProfile: { ...viewer, funeralDirectorLicense: fictionalDirectorLicense(new Date(NOW)) } };
    expect(unmet(evaluate({ approver: viewerWithLicense }))).toEqual(['approver_authorized']);
    expect(unmet(evaluate({ approver: null }))).toEqual(['approver_authorized', 'approver_licensed']);
    const someoneElsesProfile: ReleaseApprover = { ...asDirector, identityId: 'identity-someone-else' };
    expect(unmet(evaluate({ approver: someoneElsesProfile }))).toEqual(['approver_authorized']);
  });

  it('Gus allows only the Funeral Director role; Administrator is not a release role', () => {
    expect(approverRoleKeys).toEqual(['funeralDirector']);
  });

  // A license for the administrator, verified by someone else (the director).
  const adminLicense = () => {
    const base = fictionalDirectorLicense(new Date(NOW));
    return { ...base, licenseNumber: 'FD-FICTIONAL-0002', verification: { ...base.verification!, verifiedBy: director.identityId, verifiedByName: 'Jordan Demo' } };
  };

  it('a license verified by its own holder never counts, even for an administrator', () => {
    const selfVerified: ReleaseApprover = { identityId: admin.identityId, roleKey: 'administrator', staffProfile: { ...admin, funeralDirectorLicense: fictionalDirectorLicense(new Date(NOW)) } };
    expect(evaluate({ approver: selfVerified }).prerequisites.find((p) => p.key === 'approver_licensed')!.detail).toMatch(/someone other than the licensee/);
  });

  it('an administrator WITH a verified license but no Funeral Director authorization is rejected', () => {
    const licensedAdmin: ReleaseApprover = { identityId: admin.identityId, roleKey: 'administrator', staffProfile: { ...admin, funeralDirectorLicense: adminLicense() } };
    const e = evaluate({ approver: licensedAdmin });
    expect(unmet(e)).toEqual(['approver_authorized']);
    expect(e.prerequisites.find((p) => p.key === 'approver_authorized')!.detail).toMatch(/Administrator, is not enough/);
  });

  it('an administrator separately authorized as Funeral Director (by someone else) AND licensed satisfies the role/license checks', () => {
    const grant = { authorizedAt: '2026-11-17T12:00:00.000Z', authorizedBy: director.identityId, authorizedByName: 'Jordan Demo' };
    const both: ReleaseApprover = { identityId: admin.identityId, roleKey: 'administrator', staffProfile: { ...admin, funeralDirectorLicense: adminLicense(), funeralDirectorAuthorization: grant } };
    expect(unmet(evaluate({ approver: both }))).toEqual([]);
    const authorizedButUnlicensed: ReleaseApprover = { identityId: admin.identityId, roleKey: 'administrator', staffProfile: { ...admin, funeralDirectorAuthorization: grant } };
    expect(unmet(evaluate({ approver: authorizedButUnlicensed }))).toEqual(['approver_licensed']);
    const selfGranted: ReleaseApprover = { ...both, staffProfile: { ...both.staffProfile!, funeralDirectorAuthorization: { ...grant, authorizedBy: admin.identityId } } };
    const e = evaluate({ approver: selfGranted });
    expect(unmet(e)).toEqual(['approver_authorized']);
    expect(e.prerequisites.find((p) => p.key === 'approver_authorized')!.detail).toMatch(/self-granted/);
  });

  it('a Funeral Director with a verified license satisfies the role/license checks, and all other prerequisites still apply', () => {
    const e = evaluate({ me: false, service: svc({ status: 'scheduled' }) });
    expect(e.prerequisites.find((p) => p.key === 'approver_authorized')!.met).toBe(true);
    expect(e.prerequisites.find((p) => p.key === 'approver_licensed')!.met).toBe(true);
    expect(unmet(e)).toEqual(['service_completed', 'medical_examiner_approval']);
    expect(e.allPrerequisitesMet).toBe(false);
  });

  it('the re-verification interval is a pending decision: unset means age is not enforced, and it is reported', () => {
    const stale = { ...director, funeralDirectorLicense: { ...fictionalDirectorLicense(new Date(NOW)), verification: { ...fictionalDirectorLicense(new Date(NOW)).verification!, verifiedAt: '2024-01-01T00:00:00.000Z' } } };
    const unset = checkFuneralDirectorLicense(stale, { organizationId: GUS_CAMACHO_ORGANIZATION_ID, today: NOW.slice(0, 10), now: NOW, reverifyWithinDays: null });
    expect(unset.verified).toBe(true);
    expect(unset.notes).toEqual(['No re-verification interval is set yet (pending approval).']);
    expect(checkFuneralDirectorLicense(stale, { organizationId: GUS_CAMACHO_ORGANIZATION_ID, today: NOW.slice(0, 10), now: NOW, reverifyWithinDays: 365 }).verified).toBe(false);
    expect(getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.funeralDirectorLicenseReverifyDays).toBeNull();
  });

  it('Manors allows nobody to release', () => {
    expect(getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features.cremationReleaseApproverRoleKeys).toEqual([]);
    expect(getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features.funeralDirectorLicenseReverifyDays).toBeNull();
  });

  it('the release record names the director, license, case, time and every satisfied prerequisite — and is refused otherwise', () => {
    const e = evaluate({});
    const record = buildCremationReleaseRecord({ case_: legallyReadyCase(), evaluation: e, approver: asDirector, serviceAppointmentId: 'appt-fictional', now: NOW });
    expect(record).toMatchObject({
      caseId: 'gus-case-010',
      organizationId: GUS_CAMACHO_ORGANIZATION_ID,
      approvedAt: NOW,
      approvedBy: { identityId: director.identityId, name: 'Jordan Demo', roleKey: 'funeralDirector', licenseNumber: 'FD-FICTIONAL-0001', licenseState: 'FL' },
    });
    expect(record.prerequisites.map((p) => p.key)).toEqual(e.prerequisites.map((p) => p.key));
    expect(() => buildCremationReleaseRecord({ case_: legallyReadyCase(), evaluation: evaluate({ me: false }), approver: asDirector, serviceAppointmentId: null, now: NOW })).toThrow(/not every prerequisite/);
  });

  it('the same rules apply to a Final Goodbye (without the embalming step)', () => {
    const fgRecord = apply(FINAL_GOODBYE_PREPARATION, [{ kind: 'item', itemId: 'prep.day_of.identification_verified', status: 'completed' }]);
    const e = evaluateReleaseForCremation({
      case_: legallyReadyCase(),
      definition: FINAL_GOODBYE_PREPARATION,
      readiness: summarizeServiceReadiness({ definition: FINAL_GOODBYE_PREPARATION, record: fgRecord, service: svc({ status: 'completed' }), now: NOW }),
      approver: asDirector,
      approverRoleKeys,
      licenseReverifyDays: PROPOSED_LICENSE_REVERIFY_DAYS,
      timeZone: TZ,
      now: NOW,
      medicalExaminerApprovalRecorded: true,
    });
    expect(e.prerequisites.map((p) => p.key)).not.toContain('service_specific');
    expect(e.allPrerequisitesMet).toBe(true);
    expect(e.canRelease).toBe(false);
  });
});
