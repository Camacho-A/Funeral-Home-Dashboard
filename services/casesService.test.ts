import { afterEach, describe, expect, it, vi } from 'vitest';
import { casesService, matchesSearch, listForOrganization } from './casesService';
import type { OrganizationContext } from '../types/organization';
import type { Session } from '../types/session';
import type { Case } from '../types/case';
import { DEFAULT_ORGANIZATION_ID, caseFixtures, staffFixtures } from './__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '../domain/workflow/snapshot';
import { resolveChecklist } from '../domain/workflow/resolveChecklist';

const organization: OrganizationContext = { organizationId: DEFAULT_ORGANIZATION_ID };
const template = standardCremationWorkflowTemplateFixture;

function sessionFor(staffId: string): Session {
  const staff = staffFixtures.find((s) => s.id === staffId);
  if (!staff) throw new Error(`no such staff fixture: ${staffId}`);
  return { staffId: staff.id, displayName: staff.displayName };
}

describe('casesService.create — intake owner derivation', () => {
  it('sets intakeOwnerId (and createdBy) from the trusted session, never from the input', async () => {
    const session = sessionFor(staffFixtures[1].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Test Decedent', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    expect(newCase.intakeOwnerId).toBe(session.staffId);
    expect(newCase.createdBy).toBe(session.staffId);
  });

  it("defaults assignedStaffId to the session too, matching the approved design's owner:createdBy behavior, without making it immutable like intakeOwnerId", async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Another Decedent', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    expect(newCase.assignedStaffId).toBe(session.staffId);
  });

  it('ignores a client payload that tries to smuggle in its own intakeOwnerId — NewCaseInput has no such field, and the service never reads one even if cast past the type system', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const impersonatedStaffId = staffFixtures[2].id;
    const maliciousInput = {
      decedentName: 'Smuggled Owner Test',
      nextOfKinName: '',
      nextOfKinPhone: '',
      intakeOwnerId: impersonatedStaffId,
    };

    const newCase = await casesService.create(
      organization,
      maliciousInput as unknown as Parameters<typeof casesService.create>[1],
      session,
      template,
    );

    expect(newCase.intakeOwnerId).toBe(session.staffId);
    expect(newCase.intakeOwnerId).not.toBe(impersonatedStaffId);
  });
});

describe('casesService.update — intake owner immutability', () => {
  it('throws when a patch tries to change intakeOwnerId, and leaves the stored case untouched', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Immutable Owner Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    await expect(
      casesService.update(organization, created.id, {
        intakeOwnerId: staffFixtures[1].id,
      } as unknown as Parameters<typeof casesService.update>[2]),
    ).rejects.toThrow(/intakeOwnerId cannot be changed/);

    const fetched = await casesService.get(organization, created.id);
    expect(fetched?.intakeOwnerId).toBe(session.staffId);
  });

  it('still allows reassigning assignedStaffId (the case handler) without touching intakeOwnerId', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Reassignment Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    const reassignedStaffId = staffFixtures[1].id;
    const updated = await casesService.update(organization, created.id, {
      assignedStaffId: reassignedStaffId,
    });

    expect(updated.assignedStaffId).toBe(reassignedStaffId);
    expect(updated.intakeOwnerId).toBe(session.staffId);
  });

  it('allows ordinary updates that never mention intakeOwnerId', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Ordinary Update Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    const updated = await casesService.update(organization, created.id, { isVeteran: true });

    expect(updated.isVeteran).toBe(true);
    expect(updated.intakeOwnerId).toBe(session.staffId);
  });
});

/**
 * Case Information sync fix (2026-09). Mirrors
 * lib/wixCaseMapper.test.ts's identical describe block exactly, against
 * the mock-mode (DATA_ADAPTER=mock) update path, so dev/test behavior
 * never diverges from what DATA_ADAPTER=wix actually does in Production.
 */
describe('casesService.update — Case Information field sync fix (2026-09)', () => {
  it('a checklist-only fieldValues patch (the ChecklistCard/setFieldValue shape) also updates the mapped structured Weight field', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Weight Sync Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const weightIndex = 3;
    expect(created.workflowSnapshot?.intake.sections.flatMap((s) => s.fields).find((f) => f.mapsToCaseField === 'weight')?.checklistItemIndex).toBe(weightIndex);

    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, [weightIndex]: '178 lb' },
    });

    expect(updated.weight).toBe('178 lb');
    expect(updated.fieldValues[weightIndex]).toBe('178 lb');
  });

  it('syncs Time of Death the same way', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Time of Death Sync Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const timeOfDeathIndex = 5;

    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, [timeOfDeathIndex]: '14:30' },
    });

    expect(updated.timeOfDeath).toBe('14:30');
  });

  it('never overrides a structured field the same patch already sets explicitly', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Explicit Win Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const weightIndex = 3;

    const updated = await casesService.update(organization, created.id, {
      weight: '200 lb',
      fieldValues: { ...created.fieldValues, [weightIndex]: '199 lb' },
    });

    expect(updated.weight).toBe('200 lb');
  });

  it('Weight is not lost by an unrelated Case PATCH — a later, unrelated update leaves it exactly as synced', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Weight Preservation Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const weightIndex = 3;
    await casesService.update(organization, created.id, { fieldValues: { ...created.fieldValues, [weightIndex]: '178 lb' } });

    const afterUnrelated = await casesService.update(organization, created.id, { isVeteran: true });

    expect(afterUnrelated.weight).toBe('178 lb');
    expect(afterUnrelated.isVeteran).toBe(true);
  });

  it('does not introduce a duplicate field — Case still has exactly one weight/timeOfDeath property, no new field name', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'No Duplicate Field Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const updated = await casesService.update(organization, created.id, { fieldValues: { ...created.fieldValues, 3: '178 lb' } });
    expect(Object.keys(updated).filter((k) => k.toLowerCase().includes('weight'))).toEqual(['weight']);
  });
});

/**
 * Task #5 root-cause fix (2026-09, NOK name/phone corruption). Family
 * Contact (checklistItemIndex 7) maps BOTH nextOfKinName and nextOfKinPhone
 * to the same index — the ambiguous-index case the Weight/Time of Death
 * sync above was never designed to handle. Before the fix, a legacy
 * combined fieldValues[7] patch (the shape ChecklistCard's old free-text
 * box sends) silently overwrote Case.nextOfKinName with the whole "Name —
 * Phone" string. Mirrors lib/wixCaseMapper.test.ts's identical coverage so
 * mock and Wix modes never diverge.
 */
describe('casesService.update — ambiguous multi-field index (Family Contact) never corrupts nextOfKinName (Task #5 root-cause fix, 2026-09)', () => {
  it('a legacy combined fieldValues[7] patch does not overwrite nextOfKinName with "Name — Phone"', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'NOK Corruption Regression Test', nextOfKinName: 'Emma Morales Silva', nextOfKinPhone: '(954) 901-4165' },
      session,
      template,
    );
    const familyContactIndex = 7;
    expect(
      created.workflowSnapshot?.intake.sections
        .flatMap((s) => s.fields)
        .filter((f) => f.checklistItemIndex === familyContactIndex)
        .map((f) => f.mapsToCaseField),
    ).toEqual(['nextOfKinName', 'nextOfKinPhone']);

    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, [familyContactIndex]: 'Emma Morales Silva — (954) 901-4165' },
    });

    expect(updated.nextOfKinName).toBe(created.nextOfKinName);
    expect(updated.nextOfKinPhone).toBe(created.nextOfKinPhone);
    expect(updated.fieldValues[familyContactIndex]).toBe('EMMA MORALES SILVA — (954) 901-4165');
  });

  it('nextOfKinPhone is equally unaffected by an ambiguous index-7 sync attempt', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'NOK Phone Regression Test', nextOfKinName: 'Jane Doe', nextOfKinPhone: '(555) 000-1111' },
      session,
      template,
    );
    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, 7: 'Someone Else — (555) 999-8888' },
    });

    expect(updated.nextOfKinPhone).toBe(created.nextOfKinPhone);
    expect(updated.nextOfKinName).toBe(created.nextOfKinName);
  });

  it('an ambiguous index-7 patch does not block unrelated unambiguous sync (Weight) in the same request', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Mixed Patch Regression Test', nextOfKinName: 'Emma Morales Silva', nextOfKinPhone: '(954) 901-4165' },
      session,
      template,
    );
    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, 3: '178 lb', 7: 'Emma Morales Silva — (954) 901-4165' },
    });

    expect(updated.weight).toBe('178 lb');
    expect(updated.nextOfKinName).toBe(created.nextOfKinName);
  });

  it('Weight/Time of Death single-field sync continue to work unchanged after the ambiguous-index fix', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Regression Sanity Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, 3: '150 lb', 5: '09:15' },
    });

    expect(updated.weight).toBe('150 lb');
    expect(updated.timeOfDeath).toBe('09:15');
  });
});

/**
 * Task #6 follow-up (2026-09). Reproduces the ACTUAL proven Production
 * shape rather than another synthetic approximation: a case frozen under
 * workflowTemplateVersion 3, whose Time of Death checklist item predates
 * `valueKind: 'time'` — the exact shape the read-only Production
 * diagnostic confirmed for the real Manors case (workflowTemplateId
 * 'workflow-template-standard-cremation', workflowTemplateVersion 3,
 * fieldValues[5] === '11:30AM', Case.timeOfDeath unset). Mirrors
 * lib/wixCaseMapper.test.ts's identical v3-shape coverage, against the
 * mock-mode update path, so the two never diverge.
 */
describe('casesService.update — legacy Time of Death (v3 shape) sync (Task #6 follow-up, 2026-09)', () => {
  function stampV3Snapshot(caseId: string) {
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    const index = caseFixtures.findIndex((c) => c.id === caseId);
    if (index === -1) throw new Error(`Case ${caseId} not found in fixtures`);
    caseFixtures[index] = {
      ...caseFixtures[index],
      workflowTemplateVersion: 3,
      workflowSnapshot: { workflowTemplateId: template.id, workflowTemplateVersion: 3, stages: v1.stages, intake: v1.intake },
      timeOfDeath: '—',
    };
  }

  it('normalizes a real Production-shaped legacy "11:30AM" fieldValues entry into canonical Case.timeOfDeath', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Legacy V3 Time of Death Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    stampV3Snapshot(created.id);

    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, 5: '11:30AM' },
    });

    expect(updated.timeOfDeath).toBe('11:30');
    expect(updated.fieldValues[5]).toBe('11:30AM');
  });

  it('leaves Case.timeOfDeath unchanged (never guesses) when the legacy fieldValues entry cannot be safely parsed', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Legacy V3 Unparseable Time Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    stampV3Snapshot(created.id);

    const updated = await casesService.update(organization, created.id, {
      fieldValues: { ...created.fieldValues, 5: 'unknown' },
    });

    expect(updated.timeOfDeath).toBe('—');
    expect(updated.fieldValues[5]).toBe('unknown');
  });
});

describe('casesService.create — workflow template snapshot (Phase 11)', () => {
  it('stores the resolved template id/version and a matching snapshot', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Snapshot Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    // Structured Certifier data (2026-09, ADR-041) added version 5 —
    // new-case creation always resolves the *latest* version (by design;
    // see services/casesService.ts's own comment on why this differs from
    // fixtures.ts's deliberately-pinned-to-v1 seed cases), so this asserts
    // against the fixture's actual last entry rather than a hardcoded "1".
    const latestVersion = template.versions[template.versions.length - 1];
    expect(newCase.workflowTemplateId).toBe(template.id);
    expect(newCase.workflowTemplateVersion).toBe(latestVersion.version);
    expect(newCase.caseType).toBe('cremation');
    expect(newCase.workflowSnapshot?.stages.length).toBe(latestVersion.stages.length);
  });

  it("editing the live template fixture's stages after creation does not change an existing case's snapshot", async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Immutable Snapshot Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    const originalStageCount = newCase.workflowSnapshot?.stages.length;
    const originalFirstLabel = newCase.workflowSnapshot?.stages[0]?.label;

    // Mutate the *live* template fixture directly, simulating a future
    // template edit (no editor exists yet, but the fixture is still a
    // plain mutable array in memory). Mutates whichever version is
    // actually *latest* (the one the case above was created against) —
    // versions[0] (v1) has its own independent stages array since
    // Structured Certifier data (2026-09, ADR-041) added version 5, so
    // mutating v1 specifically would no longer touch what this case's
    // snapshot was built from at all.
    const liveStages = template.versions[template.versions.length - 1].stages;
    const removed = liveStages.pop();
    liveStages[0] = { ...liveStages[0], label: 'MUTATED LABEL' };

    try {
      expect(newCase.workflowSnapshot?.stages.length).toBe(originalStageCount);
      expect(newCase.workflowSnapshot?.stages[0]?.label).toBe(originalFirstLabel);
      expect(newCase.workflowSnapshot?.stages[0]?.label).not.toBe('MUTATED LABEL');
    } finally {
      // Restore the shared fixture so other tests in this run aren't affected.
      liveStages[0] = { ...liveStages[0], label: originalFirstLabel ?? liveStages[0].label };
      if (removed) liveStages.push(removed);
    }
  });
});

describe('matchesSearch — Case Number is searchable from the global search bar (Phase 16B)', () => {
  it('matches on a full or partial caseNumber, case-insensitively', () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    expect(matchesSearch(known, known.caseNumber)).toBe(true);
    expect(matchesSearch(known, known.caseNumber.toLowerCase())).toBe(true);
    expect(matchesSearch(known, known.caseNumber.slice(0, 6))).toBe(true); // e.g. "b2026-"
  });

  it('still matches on decedentName and nextOfKinPhone as before — caseNumber is additive, not a replacement', () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    expect(matchesSearch(known, known.decedentName)).toBe(true);
    expect(matchesSearch(known, known.nextOfKinPhone)).toBe(true);
  });

  it('does not match an unrelated caseNumber', () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!;
    expect(matchesSearch(known, 'B2099-999')).toBe(false);
  });
});

describe('matchesSearch — nextOfKinEmail is searchable (Manors launch-prep)', () => {
  it('matches a full or partial NOK email, case-insensitively, without requiring a new Wix index', () => {
    const known = { ...caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!, nextOfKinEmail: 'Karen.Ellison@Example.com' };
    expect(matchesSearch(known, 'karen.ellison@example.com')).toBe(true);
    expect(matchesSearch(known, 'KAREN.ELLISON')).toBe(true);
    expect(matchesSearch(known, 'example.com')).toBe(true);
  });

  it('never throws when nextOfKinEmail is null — most cases at Manors launch have none yet', () => {
    const known = { ...caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID)!, nextOfKinEmail: null };
    expect(() => matchesSearch(known, 'anything')).not.toThrow();
    expect(matchesSearch(known, 'anything-not-present')).toBe(false);
  });
});

describe('casesService.create — nextOfKinEmail (Manors launch-prep, mock mode)', () => {
  it('defaults to null when no NOK email is provided', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'No Email Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    expect(newCase.nextOfKinEmail).toBeNull();
  });

  it('trims and stores a provided NOK email', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'With Email Test', nextOfKinName: '', nextOfKinPhone: '', nextOfKinEmail: '  karen@example.com  ' },
      session,
      template,
    );
    expect(newCase.nextOfKinEmail).toBe('karen@example.com');
  });
});

describe('casesService.create — mock-mode Case Number generation (Phase 16B)', () => {
  it('assigns every new case a well-formed B{YYYY}-{###} caseNumber', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Case Number Format Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    expect(newCase.caseNumber).toMatch(/^B\d{4}-\d{3,}$/);
    expect(newCase.caseNumber).toMatch(new RegExp(`^B${new Date().getFullYear()}-`));
  });

  it('assigns strictly increasing sequential numbers within the same organization and year', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const first = await casesService.create(
      organization,
      { decedentName: 'Sequential Test A', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const second = await casesService.create(
      organization,
      { decedentName: 'Sequential Test B', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    const firstSeq = Number(first.caseNumber.split('-')[1]);
    const secondSeq = Number(second.caseNumber.split('-')[1]);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('never assigns the same caseNumber twice among existing fixtures', () => {
    const caseNumbers = caseFixtures.map((c) => c.caseNumber);
    expect(new Set(caseNumbers).size).toBe(caseNumbers.length);
  });

  it('scopes the sequence per organization — a different organization starts its own count', async () => {
    const secondOrgContext: OrganizationContext = { organizationId: SECOND_MOCK_ORGANIZATION_ID };
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      secondOrgContext,
      { decedentName: 'Second Org Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    try {
      expect(newCase.caseNumber).toMatch(/^B\d{4}-001$/); // this org has no prior fixtures at all
    } finally {
      // This test is the only one in the suite that creates a case for
      // SECOND_MOCK_ORGANIZATION_ID — remove it afterward so later tests
      // (e.g. "a mismatched organizationId returns an empty list") that
      // assert this organization has zero fixture cases aren't affected by
      // a leftover from this test.
      const index = caseFixtures.findIndex((c) => c.id === newCase.id);
      if (index !== -1) caseFixtures.splice(index, 1);
    }
  });
});

describe('casesService.update — caseNumber is always read-only (Phase 16B)', () => {
  it('throws when a patch tries to change caseNumber, and leaves the stored case untouched', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Case Number Immutability Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    await expect(
      casesService.update(organization, created.id, {
        caseNumber: 'B2026-999',
      } as unknown as Parameters<typeof casesService.update>[2]),
    ).rejects.toThrow(/caseNumber cannot be changed/);

    const fetched = await casesService.get(organization, created.id);
    expect(fetched?.caseNumber).toBe(created.caseNumber);
  });
});

describe('casesService.list/get — mock mode (dataAdapterMode omitted or "mock")', () => {
  it('list() returns only this organization\'s non-deleted cases, unchanged from before Phase 15C', async () => {
    const cases = await casesService.list(organization);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)).toBe(true);
  });

  it('a mismatched organizationId returns an empty list, not a cross-tenant leak', async () => {
    const cases = await casesService.list({ organizationId: SECOND_MOCK_ORGANIZATION_ID });
    expect(cases).toEqual([]);
  });

  it('get() finds an existing fixture case by id for its own organization', async () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
    expect(known).toBeDefined();
    const found = await casesService.get(organization, known!.id);
    expect(found?.id).toBe(known!.id);
  });

  it('get() explicitly passed "mock" behaves identically to omitting the parameter', async () => {
    const known = caseFixtures.find((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
    const found = await casesService.get(organization, known!.id, 'mock');
    expect(found?.id).toBe(known!.id);
  });
});

describe('casesService.list/get — wix mode (dataAdapterMode = "wix")', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('list() fetches /api/cases with organizationId, never touching caseFixtures directly', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cases: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await casesService.list(organization, {}, 'wix');

    expect(fetchMock).toHaveBeenCalledWith(`/api/cases?organizationId=${DEFAULT_ORGANIZATION_ID}`);
  });

  it('list() includes searchQuery in the fetch URL when provided', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cases: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await casesService.list(organization, { searchQuery: 'Ellison' }, 'wix');

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('searchQuery=Ellison');
  });

  it('get() fetches /api/cases/[caseId] with organizationId and returns null on 404', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await casesService.get(organization, 'no-such-case', 'wix');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`/api/cases/no-such-case?organizationId=${DEFAULT_ORGANIZATION_ID}`);
  });

  it('list() throws on a non-ok response', async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(casesService.list(organization, {}, 'wix')).rejects.toThrow('Failed to load cases.');
  });
});

describe('casesService.create/update — wix mode (dataAdapterMode = "wix")', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('create() POSTs /api/cases with organizationId and session-derived identity fields, never touching caseFixtures', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const fakeCase = { id: 'new-1', organizationId: DEFAULT_ORGANIZATION_ID, decedentName: 'Test' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ case: fakeCase }) });
    vi.stubGlobal('fetch', fetchMock);

    const before = caseFixtures.length;
    const result = await casesService.create(
      organization,
      { decedentName: 'Test', nextOfKinName: 'NOK', nextOfKinPhone: '555-0000' },
      session,
      template,
      'wix',
    );

    expect(result).toEqual(fakeCase);
    expect(caseFixtures.length).toBe(before); // never mutated the mock fixture array
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cases',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          organizationId: DEFAULT_ORGANIZATION_ID,
          decedentName: 'Test',
          nextOfKinName: 'NOK',
          nextOfKinPhone: '555-0000',
          dateOfBirth: undefined,
          dateOfDeath: undefined,
          timeOfDeath: undefined,
          placeOfDeath: undefined,
          weight: undefined,
          assignedStaffId: session.staffId,
          fieldValues: undefined,
          createdBy: session.staffId,
          intakeOwnerId: session.staffId,
        }),
      }),
    );
  });

  it('create() falls back to the generic message when the error response has no parseable JSON body', async () => {
    const session = sessionFor(staffFixtures[0].id);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => { throw new Error('not json'); } }));

    await expect(
      casesService.create(
        organization,
        { decedentName: 'Test', nextOfKinName: '', nextOfKinPhone: '' },
        session,
        template,
        'wix',
      ),
    ).rejects.toThrow('Failed to create case.');
  });

  it('create() surfaces the server\'s specific error message instead of the generic one (Solis go-live fix)', async () => {
    // This is the confirmed root cause of the production "Failed to create
    // case." report: the route returns a specific, already-safe-to-display
    // 422 reason (e.g. a caller with no linked StaffProfile), but the old
    // code discarded it and always threw the same generic string.
    const session = sessionFor(staffFixtures[0].id);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ case: null, error: 'No StaffProfile is linked to your account in this organization.' }),
      }),
    );

    await expect(
      casesService.create(
        organization,
        { decedentName: 'Test', nextOfKinName: '', nextOfKinPhone: '' },
        session,
        template,
        'wix',
      ),
    ).rejects.toThrow('No StaffProfile is linked to your account in this organization.');
  });

  it('create() falls back to the generic message when the error response has an empty/missing error field', async () => {
    const session = sessionFor(staffFixtures[0].id);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

    await expect(
      casesService.create(
        organization,
        { decedentName: 'Test', nextOfKinName: '', nextOfKinPhone: '' },
        session,
        template,
        'wix',
      ),
    ).rejects.toThrow('Failed to create case.');
  });

  it('update() PATCHes /api/cases/[caseId] with organizationId and the patch, never touching caseFixtures', async () => {
    const fakeUpdated = { id: '1042', organizationId: DEFAULT_ORGANIZATION_ID, decedentName: 'Renamed' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ case: fakeUpdated }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await casesService.update(organization, '1042', { decedentName: 'Renamed' }, 'wix');

    expect(result).toEqual(fakeUpdated);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cases/1042',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ organizationId: DEFAULT_ORGANIZATION_ID, patch: { decedentName: 'Renamed' } }),
      }),
    );
  });

  it('update() still enforces intakeOwnerId immutability locally before ever calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      casesService.update(organization, '1042', { intakeOwnerId: 'staff-x' } as unknown as Parameters<typeof casesService.update>[2], 'wix'),
    ).rejects.toThrow(/intakeOwnerId cannot be changed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('update() throws a clear error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(casesService.update(organization, 'no-such-case', { decedentName: 'x' }, 'wix')).rejects.toThrow(
      /not found for this organization/,
    );
  });
});

/**
 * Task #7 (2026-09). Audit-confirmed, not a bug fix — mirrors
 * lib/wixCaseMapper.test.ts's identical Certifier-on-legacy-v3-case
 * coverage against the mock-mode update path, so the two never diverge.
 */
describe('casesService.update — Certifier Name/Phone on a legacy (v3) case (Task #7, 2026-09)', () => {
  it('staff can populate both structured Certifier fields on a legacy v3 case, preserving dcContact/workflowSnapshot/unrelated fields', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Legacy V3 Certifier Test', nextOfKinName: 'Karen Ellison', nextOfKinPhone: '555-0155' },
      session,
      template,
    );
    const v1 = template.versions.find((v) => v.version === 1);
    if (!v1) throw new Error('Fixture missing version 1');
    const index = caseFixtures.findIndex((c) => c.id === created.id);
    caseFixtures[index] = {
      ...caseFixtures[index],
      workflowTemplateVersion: 3,
      workflowSnapshot: { workflowTemplateId: template.id, workflowTemplateVersion: 3, stages: v1.stages, intake: v1.intake },
      fieldValues: { ...created.fieldValues, 6: 'DR. LINDA CHOI — 555-0100' },
      certifierName: null,
      certifierPhone: null,
    };
    const beforeSnapshot = caseFixtures[index].workflowSnapshot;

    const updated = await casesService.update(organization, created.id, {
      certifierName: 'DR. LINDA CHOI',
      certifierPhone: '555-0100',
    });

    expect(updated.certifierName).toBe('DR. LINDA CHOI');
    expect(updated.certifierPhone).toBe('555-0100');
    expect(updated.workflowSnapshot).toEqual(beforeSnapshot);
    expect(updated.workflowTemplateVersion).toBe(3);
    expect(updated.fieldValues[6]).toBe('DR. LINDA CHOI — 555-0100');
    expect(updated.nextOfKinName).toBe('KAREN ELLISON');
    expect(updated.nextOfKinPhone).toBe('555-0155');
  });
});

describe('casesService — Task #15 (2026-09, future-historical-date validation, mock mode)', () => {
  const farFutureDate = `01/01/${new Date().getFullYear() + 5}`;

  it('create() rejects a future Date of Birth', async () => {
    const session = sessionFor(staffFixtures[0].id);
    await expect(
      casesService.create(
        organization,
        { decedentName: 'Future DOB Test', nextOfKinName: '', nextOfKinPhone: '', dateOfBirth: farFutureDate },
        session,
        template,
      ),
    ).rejects.toThrow(/date of birth cannot be in the future/i);
  });

  it('create() rejects a future Date of Death', async () => {
    const session = sessionFor(staffFixtures[0].id);
    await expect(
      casesService.create(
        organization,
        { decedentName: 'Future DOD Test', nextOfKinName: '', nextOfKinPhone: '', dateOfDeath: farFutureDate },
        session,
        template,
      ),
    ).rejects.toThrow(/date of death cannot be in the future/i);
  });

  it('create() still succeeds with valid past DOB/DOD', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Valid Dates Test', nextOfKinName: '', nextOfKinPhone: '', dateOfBirth: '01/05/1950', dateOfDeath: '07/09/2026' },
      session,
      template,
    );
    expect(newCase.dateOfBirth).toBe('01/05/1950');
    expect(newCase.dateOfDeath).toBe('07/09/2026');
  });

  it('update() rejects a future Date of Birth and leaves the stored case untouched', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Update Future DOB Test', nextOfKinName: '', nextOfKinPhone: '', dateOfBirth: '01/05/1950' },
      session,
      template,
    );

    await expect(casesService.update(organization, created.id, { dateOfBirth: farFutureDate })).rejects.toThrow(
      /date of birth cannot be in the future/i,
    );

    const fetched = await casesService.get(organization, created.id);
    expect(fetched?.dateOfBirth).toBe('01/05/1950');
  });

  it('update() rejects a future Date of Death', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Update Future DOD Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    await expect(casesService.update(organization, created.id, { dateOfDeath: farFutureDate })).rejects.toThrow(
      /date of death cannot be in the future/i,
    );
  });

  it('update() rejects a future Released date', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Update Future Released Date Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    await expect(
      casesService.update(organization, created.id, { pickupReleasedTo: 'Jane Smith', pickupReleasedAt: farFutureDate }),
    ).rejects.toThrow(/released date cannot be in the future/i);
  });

  it('update() rejects a future Date shipped', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Update Future Date Shipped Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    await expect(casesService.update(organization, created.id, { shippingDateShipped: farFutureDate })).rejects.toThrow(
      /date shipped cannot be in the future/i,
    );
  });

  it('update() rejects a future Delivered date', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Update Future Delivered Date Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    await expect(casesService.update(organization, created.id, { shippingDeliveredAt: farFutureDate })).rejects.toThrow(
      /delivered date cannot be in the future/i,
    );
  });

  it('update() never re-validates an untouched existing date field on an unrelated edit', async () => {
    // A case whose already-persisted dateOfDeath happens to be malformed/
    // unusual for some pre-existing reason must not start failing every
    // future unrelated edit — see domain/cases/caseNumber.ts and this
    // session's own "leave existing records untouched" requirement.
    const session = sessionFor(staffFixtures[0].id);
    const created = await casesService.create(
      organization,
      { decedentName: 'Untouched Field Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );
    const index = caseFixtures.findIndex((c) => c.id === created.id);
    caseFixtures[index] = { ...caseFixtures[index], dateOfDeath: farFutureDate };

    const updated = await casesService.update(organization, created.id, { placeOfDeath: 'HOSPITAL' });
    expect(updated.placeOfDeath).toBe('HOSPITAL');
    expect(updated.dateOfDeath).toBe(farFutureDate);
  });
});

/**
 * Task #6 (2026-09, checklist completion → workflow reconciliation, mock
 * mode). Mirrors app/api/cases/[caseId]/route.test.ts's identical "Task #6"
 * suite exactly, so DATA_ADAPTER=mock never diverges from DATA_ADAPTER=wix
 * — see that file's own comment for the full root-cause explanation.
 * Stage 3's own 3-item checklist (EDRS submitted & sent to doctor / Cause
 * of death entered / Hardsave for state approval if not an online doctor)
 * has its first two items default-done (resolveChecklist.ts's own
 * `defaultDone` rule) — so completing raw stage 3 only ever requires the
 * ONE explicit checklistState entry for the last item (local index 2).
 * Pinned to versions[0] (v1) for the same reason
 * workflowReconciliationService.test.ts pins it — the dcContact-era
 * 11-item First Call & Payment shape the fieldValues below assume.
 */
describe('casesService.update — Task #6 (2026-09, checklist completion triggers workflow reconciliation, mock mode)', () => {
  const RECONCILIATION_VERSION = standardCremationWorkflowTemplateFixture.versions[0];
  const pushedCaseIds: string[] = [];

  afterEach(() => {
    for (const id of pushedCaseIds.splice(0)) {
      const index = caseFixtures.findIndex((c) => c.id === id);
      if (index !== -1) caseFixtures.splice(index, 1);
    }
  });

  /** A case sitting at raw stage 3 (displayStage 2, EDRS) with every
      earlier stage already trusted via the computeFirstIncompleteRawStage
      skip optimization (displayStage < the case's current one is never
      re-evaluated) — no CaseFormLink fixture needed. Only EDRS's own
      checklist (`stage3ChecklistState`, keyed by its own LOCAL index, e.g.
      `{2: true}` for Hardsave) varies per test; this helper composite-keys
      it internally to displayStage 2 — composite-keyed per B2026-035's fix
      (domain/workflow/checklistItemKey.ts). */
  function seedStage3Case(stage3ChecklistState: Record<number, boolean>) {
    const EDRS_DISPLAY_STAGE = 2;
    const compositeStage3State = Object.fromEntries(
      Object.entries(stage3ChecklistState).map(([index, value]) => [`${EDRS_DISPLAY_STAGE}:${index}`, value]),
    );
    const id = `task6-mock-${Math.random().toString(36).slice(2)}`;
    const case_: Case = {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-901',
      decedentName: 'Task 6 Test Decedent',
      dateOfBirth: '01/01/1950',
      dateOfDeath: '01/01/2026',
      timeOfDeath: '10:00',
      placeOfDeath: 'Test Hospital',
      weight: '150 lb',
      rawStage: 3,
      assignedStaffId: null,
      nextOfKinName: 'Test NOK',
      nextOfKinPhone: '555-0100',
      nextOfKinEmail: null,
      nextOfKinRelationship: null,
      nextOfKinRelationshipOther: null,
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
      tagNumber: null,
      paymentStatus: 'awaiting_payment',
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
      checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true, ...compositeStage3State },
      fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X', 9: 'X', 10: 'X' },
      daysWaitingInStage: 0,
      isStalled: false,
      stalledReason: null,
      createdBy: null,
      intakeOwnerId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: RECONCILIATION_VERSION.version,
      caseType: 'cremation',
      workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, RECONCILIATION_VERSION),
    };
    caseFixtures.push(case_);
    pushedCaseIds.push(id);
    return case_;
  }

  it('A. Stage 3 with Hardsave (local index 2) still incomplete remains at rawStage 3, even though the update itself carries a checklistState patch', async () => {
    const case_ = seedStage3Case({});
    const updated = await casesService.update(organization, case_.id, { checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true } });
    expect(updated.rawStage).toBe(3);
  });

  it('B. Stage 3 with Hardsave checked and every other Stage 3 requirement already satisfied (by default) advances to Stage 4', async () => {
    const case_ = seedStage3Case({ 0: true, 1: true, 2: true });
    const updated = await casesService.update(organization, case_.id, {
      checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true },
    });
    expect(updated.rawStage).toBe(4);
  });

  it('C. Partial checklist completion (only an already-default-done item re-affirmed, Hardsave itself still false) does not advance', async () => {
    const case_ = seedStage3Case({});
    const updated = await casesService.update(organization, case_.id, { checklistState: { '0:0': true, '0:8': true, '0:9': true, '0:10': true } });
    expect(updated.rawStage).toBe(3);
  });

  it('D. the checklistState patch is what triggers reconciliation — Stage 4 is the observable proof (no rawStage field appears anywhere in the request)', async () => {
    const case_ = seedStage3Case({ 0: true, 1: true, 2: true });
    const updated = await casesService.update(organization, case_.id, {
      checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true },
    });
    expect(updated.rawStage).toBe(4);
  });

  it('E. an unrelated Case update WITHOUT checklistState does not trigger reconciliation, even when every prerequisite is already satisfied (would otherwise advance to Stage 4)', async () => {
    const case_ = seedStage3Case({ 2: true });
    const updated = await casesService.update(organization, case_.id, { decedentName: 'RENAMED DECEDENT' });
    expect(updated.decedentName).toBe('RENAMED DECEDENT');
    expect(updated.rawStage).toBe(3);
  });

  it('F. mock mode produces the exact same Stage 3 -> Stage 4 outcome as Wix mode (see app/api/cases/[caseId]/route.test.ts\'s identical test B)', async () => {
    const case_ = seedStage3Case({ 0: true, 1: true, 2: true });
    const updated = await casesService.update(organization, case_.id, {
      checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true },
    });
    expect(updated.rawStage).toBe(4);
  });

  it('G. repeating the same completed checklist update is safe/idempotent — a second, identical update never double-advances past Stage 4', async () => {
    const case_ = seedStage3Case({ 0: true, 1: true, 2: true });
    const patch = { checklistState: { '0:0': true, '2:0': true, '2:1': true, '2:2': true, '0:8': true, '0:9': true, '0:10': true } };

    const first = await casesService.update(organization, case_.id, patch);
    expect(first.rawStage).toBe(4);

    const second = await casesService.update(organization, case_.id, patch);
    expect(second.rawStage).toBe(4);
  });
});

/**
 * B2026-035 hardening (2026-10) — server-side checklistState write
 * validation, mock-mode path (mirrors the identical check in
 * app/api/cases/[caseId]/route.ts's PATCH handler exactly — see
 * domain/workflow/checklistItemKey.ts#findInvalidChecklistStatePatchEntries
 * for the shared validator both call). Seeds a case at rawStage 4 (Permit
 * & Authorization, displayStage 3, the real B2026-035 stage) so composite
 * keys in these tests mean something concrete, not an arbitrary number.
 */
describe('casesService.update — checklistState write validation (B2026-035 hardening, 2026-10)', () => {
  const VALIDATION_VERSION = standardCremationWorkflowTemplateFixture.versions[0];
  const pushedCaseIds: string[] = [];

  afterEach(() => {
    for (const id of pushedCaseIds.splice(0)) {
      const index = caseFixtures.findIndex((c) => c.id === id);
      if (index !== -1) caseFixtures.splice(index, 1);
    }
  });

  /** rawStage 4 = Permit & Authorization, displayStage 3, exactly 2 items
      (local index 0, 1) — the real stage B2026-035's collision involved. */
  function seedPermitStageCase(checklistState: Record<string, boolean> = {}): Case {
    const id = `validation-mock-${Math.random().toString(36).slice(2)}`;
    const case_: Case = {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-902',
      decedentName: 'Validation Test Decedent',
      dateOfBirth: '01/01/1950',
      dateOfDeath: '01/01/2026',
      timeOfDeath: '10:00',
      placeOfDeath: 'Test Hospital',
      weight: '150 lb',
      rawStage: 4,
      assignedStaffId: null,
      nextOfKinName: 'Test NOK',
      nextOfKinPhone: '555-0100',
      nextOfKinEmail: null,
      nextOfKinRelationship: null,
      nextOfKinRelationshipOther: null,
      certifierName: null,
      certifierPhone: null,
      certifierLicenseNumber: null,
      certifierFax: null,
      tagNumber: null,
      paymentStatus: 'awaiting_payment',
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
      checklistState,
      fieldValues: {},
      daysWaitingInStage: 0,
      isStalled: false,
      stalledReason: null,
      createdBy: null,
      intakeOwnerId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      workflowTemplateId: standardCremationWorkflowTemplateFixture.id,
      workflowTemplateVersion: VALIDATION_VERSION.version,
      caseType: 'cremation',
      workflowSnapshot: buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, VALIDATION_VERSION),
    };
    caseFixtures.push(case_);
    pushedCaseIds.push(id);
    return case_;
  }

  it('1. rejects a bare legacy-shaped key being newly introduced', async () => {
    const case_ = seedPermitStageCase({});
    await expect(casesService.update(organization, case_.id, { checklistState: { '1': true } })).rejects.toThrow(/canonical/);
  });

  it('2. rejects a malformed composite key', async () => {
    const case_ = seedPermitStageCase({});
    await expect(casesService.update(organization, case_.id, { checklistState: { 'a:1': true } })).rejects.toThrow(/canonical/);
    const case2 = seedPermitStageCase({});
    await expect(casesService.update(organization, case2.id, { checklistState: { '3:b': true } })).rejects.toThrow(/canonical/);
    const case3 = seedPermitStageCase({});
    await expect(casesService.update(organization, case3.id, { checklistState: { '3:1:1': true } })).rejects.toThrow(/canonical/);
  });

  it('3. rejects a negative stage or index', async () => {
    const case_ = seedPermitStageCase({});
    await expect(casesService.update(organization, case_.id, { checklistState: { '-3:1': true } })).rejects.toThrow(/canonical/);
  });

  it('4. rejects a non-boolean checklist value', async () => {
    const case_ = seedPermitStageCase({});
    await expect(
      casesService.update(organization, case_.id, { checklistState: { '3:1': 'true' as unknown as boolean } }),
    ).rejects.toThrow(/boolean/);
  });

  it('5. accepts a valid composite key that exists in the case\'s own workflow snapshot', async () => {
    const case_ = seedPermitStageCase({});
    const updated = await casesService.update(organization, case_.id, { checklistState: { '3:1': true } });
    expect(updated.checklistState['3:1']).toBe(true);
  });

  it('rejects a well-formed composite key that does not match any real item in this case\'s own workflow snapshot (e.g. a stage/index that does not exist)', async () => {
    const case_ = seedPermitStageCase({});
    await expect(casesService.update(organization, case_.id, { checklistState: { '99:5': true } })).rejects.toThrow(/workflow snapshot/);
  });

  it('6. an invalid checklist patch performs no persistence — the case\'s checklistState is completely untouched', async () => {
    const case_ = seedPermitStageCase({ '3:1': true });
    const before = { ...caseFixtures.find((c) => c.id === case_.id)!.checklistState };
    await expect(casesService.update(organization, case_.id, { checklistState: { '1': true } })).rejects.toThrow();
    expect(caseFixtures.find((c) => c.id === case_.id)!.checklistState).toEqual(before);
  });

  it('7. existing legacy stored state remains readable/writable during the migration compatibility window — carrying forward an unchanged legacy key never blocks an otherwise-valid update', async () => {
    const case_ = seedPermitStageCase({ '1': true }); // pre-migration bare key, already stored
    const updated = await casesService.update(organization, case_.id, {
      checklistState: { '1': true, '3:0': true }, // '1' unchanged, '3:0' is new and valid
    });
    expect(updated.checklistState['1']).toBe(true); // legacy key preserved, not rejected
    expect(updated.checklistState['3:0']).toBe(true);
  });

  it('8. a valid composite CHECK remains stage-scoped — writing Permit\'s own item 1 never satisfies DC Application Sent\'s own item 1', async () => {
    const case_ = seedPermitStageCase({});
    const updated = await casesService.update(organization, case_.id, { checklistState: { '3:1': true } });
    const dcStage = updated.workflowSnapshot!.stages.find((s) => s.rawStage === 5)!;
    const resolved = resolveChecklist(dcStage.checklist.items, dcStage.displayStage, updated, { isPastStage: false });
    expect(resolved[1].done).toBe(false);
  });

  it('9. a valid composite UNCHECK remains stage-scoped — unchecking Ready for Pickup\'s own item 2 never clears EDRS\'s own item 2', async () => {
    const case_ = seedPermitStageCase({ '2:2': true }); // EDRS's own last item, genuinely done
    const updated = await casesService.update(organization, case_.id, { checklistState: { '2:2': true, '5:2': false } });
    const edrsStage = updated.workflowSnapshot!.stages.find((s) => s.rawStage === 3)!;
    const resolved = resolveChecklist(edrsStage.checklist.items, edrsStage.displayStage, updated, { isPastStage: false });
    expect(resolved[2].done).toBe(true);
  });

  it('10. Task #6 reconciliation remains fully functional alongside the new validation — a genuinely valid, changing composite-key write still advances rawStage', async () => {
    const case_ = seedPermitStageCase({ '3:0': true });
    // casesService.update's mock path replaces checklistState wholesale
    // rather than merging it (see test 7's identical "'1' unchanged"
    // pattern above) — the patch itself must carry the full desired state,
    // same as a real UI PATCH would send.
    const updated = await casesService.update(organization, case_.id, { checklistState: { '3:0': true, '3:1': true } });
    // Permit's own 2-item stage: item 0 already explicitly done, item 1 now
    // explicitly done too -> fully complete -> reconciliation advances past
    // it to Stage 5. Checklist default-done fix (2026-10) retired the old
    // free credit for item 0.
    expect(updated.rawStage).toBe(5);
  });
});

/**
 * Case list scalability, Phase 1 (2026-09). `listForOrganization` had the
 * identical silent-cap defect GET /api/cases did (a single, unpaginated
 * `queryWixDataItems` call) — fixed to loop via `queryAllWixDataItems`
 * (see this function's own comment in casesService.ts). Mock mode's
 * behavior was never affected by that defect (an in-memory filter has no
 * such cap) — these tests are a regression guard on its unchanged
 * contract (`Promise<Case[]>`, org-scoped, excludes soft-deleted) after
 * the import/implementation change. The wix-mode branch's correctness now
 * rests entirely on `queryAllWixDataItems`, already proven independently
 * in lib/wixDataApi.test.ts ("Manors go-live incident fix").
 */
describe('listForOrganization (used by services/reportingService.ts)', () => {
  it('lists only this organization\'s non-deleted cases in mock mode', async () => {
    const result = await listForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted)).toBe(true);
  });

  it('returns an empty array for an organization with no fixtures, never another organization\'s cases', async () => {
    const result = await listForOrganization(SECOND_MOCK_ORGANIZATION_ID, 'mock');
    expect(result).toEqual([]);
  });
});
