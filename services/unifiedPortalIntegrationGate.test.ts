import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { integrationUnavailableReason, isUnifiedPortalServingManors, OrganizationIntegrationUnavailableError } from '@/lib/deployment/organizationIntegrations';
import { connectMockCrematoryMailbox, disconnectCrematoryMailbox, getCrematoryMailboxAccess, getCrematoryMailboxStatus, resetMockCrematoryMailboxes } from './crematory/crematoryMailboxService';
import { initiateCheckout } from './paymentsService';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { readOrganizationFile } from './documentService';
import { jotformOptionsForConfig } from './externalForms/jotformReadCredentials';

/**
 * Unified portal (Phase 5N): on the gus-solis deployment serving Manors as
 * well, Manors' integrations stay on Manors Production. Nothing here may
 * send for Manors, write a row another portal's sweep would act on, or
 * disconnect Manors' live connections. Gus, and every other deployment, are
 * unaffected. Mock data, fictional values.
 */
const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';
const unified = () => vi.stubEnv('DEPLOYMENT_ORGANIZATION_IDS', `${GUS},${MANORS}`);

beforeEach(() => resetMockCrematoryMailboxes());
afterEach(() => {
  vi.unstubAllEnvs();
  resetMockCrematoryMailboxes();
});

describe('which deployment the gate applies to', () => {
  it('only the unified portal (Gus + Manors) gates Manors; Gus is never gated', () => {
    expect(isUnifiedPortalServingManors({ DEPLOYMENT_ORGANIZATION_IDS: `${GUS},${MANORS}` })).toBe(true);
    expect(isUnifiedPortalServingManors({ DEPLOYMENT_ORGANIZATION_IDS: MANORS })).toBe(false); // Manors Production
    expect(isUnifiedPortalServingManors({ DEPLOYMENT_ORGANIZATION_IDS: GUS })).toBe(false);
    expect(isUnifiedPortalServingManors({})).toBe(false); // local development / sandbox
    const env = { DEPLOYMENT_ORGANIZATION_IDS: `${GUS},${MANORS}` };
    expect(integrationUnavailableReason(MANORS, 'crematory_mailbox', env)).toMatch(/still runs from the Manors portal.*Nothing was sent or changed/);
    expect(integrationUnavailableReason(GUS, 'crematory_mailbox', env)).toBeNull();
    expect(integrationUnavailableReason(MANORS, 'crematory_mailbox', { DEPLOYMENT_ORGANIZATION_IDS: MANORS })).toBeNull();
  });
});

describe('Manors on the unified portal', () => {
  it('crematory mailbox: reported unavailable; no token is read; it can never be disconnected from here', async () => {
    connectMockCrematoryMailbox(MANORS, 'crematory@manors.example.test', 'fictional-token');
    unified();
    const status = await getCrematoryMailboxStatus(MANORS, 'mock');
    expect(status).toMatchObject({ connected: false, configured: false });
    expect((status as { unavailableReason?: string }).unavailableReason).toMatch(/Manors portal/);
    await expect(getCrematoryMailboxAccess(MANORS, 'mock')).rejects.toMatchObject({ status: 503 });
    await expect(disconnectCrematoryMailbox(MANORS, 'mock')).rejects.toMatchObject({ status: 503 });
    vi.unstubAllEnvs();
    // Still connected for Manors Production.
    expect(await getCrematoryMailboxStatus(MANORS, 'mock')).toMatchObject({ connected: true, accountEmail: 'crematory@manors.example.test' });
  });

  it('Gus keeps its own mailbox behavior on the same deployment', async () => {
    connectMockCrematoryMailbox(GUS, 'crematory@gus.example.test', 'fictional-token');
    unified();
    expect(await getCrematoryMailboxAccess(GUS, 'mock')).toMatchObject({ accountEmail: 'crematory@gus.example.test' });
  });

  it('payments: refused before any pending payment record is written', async () => {
    unified();
    const before = paymentRecordFixtures.length;
    const attempt = initiateCheckout(
      { organizationId: MANORS, caseId: 'c', caseOrderId: 'o', provider: 'clover', amount: 100, currency: 'USD', purpose: 'test', idempotencyKey: 'k', paymentId: 'p-unified', returnUrl: 'https://x.test', cancelUrl: 'https://x.test' },
      'mock',
    );
    await expect(attempt).rejects.toBeInstanceOf(OrganizationIntegrationUnavailableError);
    expect(paymentRecordFixtures.length).toBe(before);
  });

  it('document storage: nothing uploaded, read or deleted for Manors here', async () => {
    unified();
    await expect(readOrganizationFile(MANORS, `${MANORS}/fax-bundles/fictional.pdf`)).rejects.toThrow(/document storage still runs from the Manors portal/);
  });

  it('JotForm: no key is used for Manors here; Manors Production unchanged', () => {
    expect(jotformOptionsForConfig({ organizationId: MANORS, apiKeyReference: null })).toEqual({});
    unified();
    expect(jotformOptionsForConfig({ organizationId: MANORS, apiKeyReference: null })).toBeNull();
  });
});
