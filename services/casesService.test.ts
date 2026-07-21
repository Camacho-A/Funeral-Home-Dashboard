import { describe, expect, it } from 'vitest';
import { casesService } from './casesService';
import type { OrganizationContext } from '../types/organization';
import type { Session } from '../types/session';
import { DEFAULT_ORGANIZATION_ID, staffFixtures } from './__mocks__/fixtures';

const organization: OrganizationContext = { organizationId: DEFAULT_ORGANIZATION_ID };

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
    );

    const updated = await casesService.update(organization, created.id, { isVeteran: true });

    expect(updated.isVeteran).toBe(true);
    expect(updated.intakeOwnerId).toBe(session.staffId);
  });
});
