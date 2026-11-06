import { describe, expect, it } from 'vitest';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID, getRegisteredOrganizationProfile } from './organizationProfiles';
import { deathCertificateFaxSettings } from '../faxBundles/faxSettings';
import { crematoryAuthorizationDocumentSource, isCrematorySendingEnabled } from '../crematory/crematorySettings';
import { usesTemplateStages } from '../workflow/selectWorkflowTemplate';
import { isSlaTrackingEnabled } from '../sla/slaSettings';
import { presentedChecklistLabel } from './checklistRelabel';
import { sendToCrematoryConfig } from '../crematory/crematorySettings';

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

  it('the 2026-11 Manors changes stay with Manors (master merged again, Phase 4)', () => {
    const gus = getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features;
    const manors = getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features;
    // SLA tracking and the SLA details in the header: Manors only.
    expect(isSlaTrackingEnabled(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(isSlaTrackingEnabled(GUS_CAMACHO_ORGANIZATION_ID)).toBe(false);
    // Manatee Create & Save: Manors only.
    expect(manors.manateeDeathCertificateApplication).toBe(true);
    expect(gus.manateeDeathCertificateApplication).toBe(false);
    // Workflow 2 renames: Manors only — Gus's own step names are never replaced.
    expect(gus.relabeledChecklistItems).toEqual([]);
    expect(presentedChecklistLabel(MANORS_ORGANIZATION_ID, 2, { index: 1, label: 'Cause of death entered' })).toBe('Attestation received / Cause of death entered');
    expect(presentedChecklistLabel(MANORS_ORGANIZATION_ID, 2, { index: 2, label: 'Hardsave for state approval if not an online doctor' })).toBe('Hard Saved');
    expect(presentedChecklistLabel(GUS_CAMACHO_ORGANIZATION_ID, 2, { index: 1, label: 'Cause of death entered' })).toBe('Cause of death entered');
    // Automatic permit recording follows the Send to Crematory feature: Gus has it with sending
    // OFF and no authorization source, so a permit is recorded on the case but nothing is ever
    // built or sent; the automatic SLA approval time is skipped (no SLA tracking).
    expect(sendToCrematoryConfig(MANORS_ORGANIZATION_ID)).not.toBeNull();
    expect(sendToCrematoryConfig(GUS_CAMACHO_ORGANIZATION_ID)).toMatchObject({ sendingEnabled: false, authorizationDocumentSource: 'not_configured' });
  });

  it('Manors pricing and workflow behaviour stay as today', () => {
    const { features } = getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID);
    expect(features).toMatchObject({ priceCatalogManagement: false, pricingPermissionModel: 'legacy', orderLinePriceLock: false, workflowApprovalRequired: false, enforceHiddenModulesServerSide: false });
  });
});
