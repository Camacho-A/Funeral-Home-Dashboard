import { describe, expect, it } from 'vitest';
import { casesService } from './casesService';
import type { OrganizationContext } from '../types/organization';
import type { Session } from '../types/session';
import { DEFAULT_ORGANIZATION_ID, staffFixtures } from './__mocks__/fixtures';
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
