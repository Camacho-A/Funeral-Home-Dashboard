import { describe, expect, it } from 'vitest';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID, getRegisteredOrganizationProfile } from './organizationProfiles';
import { deathCertificateFaxSettings } from '../faxBundles/faxSettings';
import { crematoryAuthorizationDocumentSource, isCrematorySendingEnabled } from '../crematory/crematorySettings';
import { usesTemplateStages } from '../workflow/selectWorkflowTemplate';

/**
 * Shared master (UI refresh + Manatee fax) merged with the Gus platform
 * work (2026-11). The two sides changed the same organization profiles;
 * each organization must keep exactly what it had, and gain nothing of the
 * other's.
 */
describe('organization profiles after the shared-platform merge', () => {
  it('Manors keeps its fax settings exactly: sending off, one approved test number', () => {
    expect(deathCertificateFaxSettings(MANORS_ORGANIZATION_ID)).toMatchObject({
      destinationName: 'Manatee County Vital Statistics',
      faxNumber: '9415545490',
      gatewayDomain: 'fax.nuso.io',
      sendingEnabled: false,
      testRecipients: { faxNumbers: ['646-370-3249'], emailAddresses: [] },
    });
  });

  it('Gus gains no fax functionality', () => {
    expect(deathCertificateFaxSettings(GUS_CAMACHO_ORGANIZATION_ID)).toBeNull();
    expect(getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.deathCertificateFax).toBeNull();
  });

  it('stages: Gus from its own service workflows; Manors keeps its fixed list', () => {
    expect(usesTemplateStages(GUS_CAMACHO_ORGANIZATION_ID)).toBe(true);
    expect(usesTemplateStages(MANORS_ORGANIZATION_ID)).toBe(false);
    expect(getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.workflowByServiceType).toBe(true);
    expect(getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features.workflowByServiceType).toBe(false);
  });

  it('Send to Crematory: Manors sends from its Arrangement Form; Gus may not send and has no source', () => {
    expect(isCrematorySendingEnabled(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(crematoryAuthorizationDocumentSource(MANORS_ORGANIZATION_ID)).toBe('arrangement_form_page');
    expect(isCrematorySendingEnabled(GUS_CAMACHO_ORGANIZATION_ID)).toBe(false);
    expect(crematoryAuthorizationDocumentSource(GUS_CAMACHO_ORGANIZATION_ID)).toBe('not_configured');
  });

  it('Manors pricing and workflow behaviour stay as today', () => {
    const { features } = getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID);
    expect(features).toMatchObject({ priceCatalogManagement: false, pricingPermissionModel: 'legacy', orderLinePriceLock: false, workflowApprovalRequired: false, enforceHiddenModulesServerSide: false });
  });
});
