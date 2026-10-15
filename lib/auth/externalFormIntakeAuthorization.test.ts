import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExternalFormIntakeAuthorization, verifyExternalFormIntakeAuthorization } from './externalFormIntakeAuthorization';

/** Multi-tenant hardening (2026-10): an intake authorization for an
    organization this deployment does not serve authorizes nothing here. */
const PARAMS = { externalFormId: '300000000000002', externalSubmissionId: '1', intakeStaffProfileId: 'staff-1' };

beforeEach(() => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
});
afterEach(() => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
});

describe('verifyExternalFormIntakeAuthorization — deployment boundary', () => {
  it('verifies a token for an organization the deployment serves', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    const token = await createExternalFormIntakeAuthorization({ organizationId: 'gus-camacho-jr', ...PARAMS });
    expect((await verifyExternalFormIntakeAuthorization(token))?.organizationId).toBe('gus-camacho-jr');
  });

  it('rejects a validly signed token for an organization outside the deployment', async () => {
    const token = await createExternalFormIntakeAuthorization({ organizationId: 'managed-cremations', ...PARAMS });
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    expect(await verifyExternalFormIntakeAuthorization(token)).toBeNull();
  });
});
