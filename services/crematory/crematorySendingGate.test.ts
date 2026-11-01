import { describe, expect, it, vi } from 'vitest';

/**
 * Send to Crematory offered with sending switched OFF (2026-11, Gus on the
 * shared platform): the server refuses before taking any lock or touching
 * a case, and Outlook is never contacted.
 */
const outlook = vi.hoisted(() => ({ sendOutlookMessage: vi.fn() }));
vi.mock('@/lib/microsoft/outlookMail', async (importOriginal) => ({ ...(await importOriginal<object>()), sendOutlookMessage: outlook.sendOutlookMessage }));

const { sendCrematoryPackages } = await import('./crematorySendService');
const { isCrematorySendingEnabled, sendToCrematoryConfig } = await import('@/domain/crematory/crematorySettings');
const { caseFixtures } = await import('../__mocks__/fixtures');
const { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } = await import('@/domain/organization/organizationProfiles');

const gusCtx = { organizationId: GUS_CAMACHO_ORGANIZATION_ID, actorIdentityId: 'identity-gus-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'c' };

describe('crematory sending switched off for an organization', () => {
  it('Gus offers the process but may not send; Manors may', () => {
    expect(sendToCrematoryConfig(GUS_CAMACHO_ORGANIZATION_ID)).not.toBeNull();
    expect(isCrematorySendingEnabled(GUS_CAMACHO_ORGANIZATION_ID)).toBe(false);
    expect(isCrematorySendingEnabled(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(isCrematorySendingEnabled('some-other-organization')).toBe(false);
  });

  it('a send is refused with 409 before anything happens — no case changes, Outlook never contacted', async () => {
    const gusCase = caseFixtures.find((c) => c.organizationId === GUS_CAMACHO_ORGANIZATION_ID)!;
    const before = structuredClone(caseFixtures);
    await expect(
      sendCrematoryPackages(
        gusCtx,
        {
          caseIds: [gusCase.id],
          submissionId: 'submission-0001',
          to: ['crematory@example.test'],
          cc: [],
          subject: 'Test',
          message: 'Test',
          reviewFingerprint: 'v1:test',
          acknowledged: true,
        } as never,
        'mock',
      ),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not switched on for this funeral home') });
    expect(outlook.sendOutlookMessage).not.toHaveBeenCalled();
    expect(caseFixtures).toEqual(before);
  });
});
