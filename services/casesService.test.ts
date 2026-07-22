import { afterEach, describe, expect, it, vi } from 'vitest';
import { casesService } from './casesService';
import type { OrganizationContext } from '../types/organization';
import type { Session } from '../types/session';
import { DEFAULT_ORGANIZATION_ID, caseFixtures, staffFixtures } from './__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';

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

describe('casesService.create — workflow template snapshot (Phase 11)', () => {
  it('stores the resolved template id/version and a matching snapshot', async () => {
    const session = sessionFor(staffFixtures[0].id);
    const newCase = await casesService.create(
      organization,
      { decedentName: 'Snapshot Test', nextOfKinName: '', nextOfKinPhone: '' },
      session,
      template,
    );

    expect(newCase.workflowTemplateId).toBe(template.id);
    expect(newCase.workflowTemplateVersion).toBe(1);
    expect(newCase.caseType).toBe('cremation');
    expect(newCase.workflowSnapshot?.stages.length).toBe(template.versions[0].stages.length);
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
    // plain mutable array in memory).
    const liveStages = template.versions[0].stages;
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

  it('create() throws a clear error on a non-ok response', async () => {
    const session = sessionFor(staffFixtures[0].id);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

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
