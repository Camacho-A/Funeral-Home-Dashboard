import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import { createCaseFromIntakeSubmission } from './externalFormIntakeService';

/** Multi-tenant hardening (2026-10): intake creation refuses before doing
    anything when the submission and config disagree on organization, or
    when this deployment does not serve the organization. */
const config = {
  id: 'cfg-gus-intake',
  organizationId: 'gus-camacho-jr',
  provider: 'jotform',
  externalFormId: '300000000000002',
  purpose: 'case_create',
  label: 'Gus Intake',
} as ExternalFormConfig;
const submission = { id: 'sub-1', organizationId: 'gus-camacho-jr', externalSubmissionId: '1' } as ExternalFormSubmission;
const FIELDS = { decedentName: 'A B', nextOfKinName: 'C D', nextOfKinPhone: '555' };
const CTX = { organizationId: 'gus-camacho-jr', actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };
const request = new Request('http://localhost/api/webhooks/jotform');

afterEach(() => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  vi.unstubAllGlobals();
});

describe('createCaseFromIntakeSubmission — tenancy guards', () => {
  it('refuses a submission that belongs to a different organization than the config', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const outcome = await createCaseFromIntakeSubmission(
      { config, submission: { ...submission, organizationId: 'managed-cremations' }, mappedFields: FIELDS, request },
      CTX,
      'mock',
    );
    expect(outcome).toEqual({ created: false, reason: 'organization_mismatch' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an organization this deployment does not serve', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'managed-cremations';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const outcome = await createCaseFromIntakeSubmission({ config, submission, mappedFields: FIELDS, request }, CTX, 'mock');
    expect(outcome).toEqual({ created: false, reason: 'organization_not_served' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
