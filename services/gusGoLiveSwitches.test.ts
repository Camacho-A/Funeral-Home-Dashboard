import { describe, expect, it } from 'vitest';
import { RELEASE_FOR_CREMATION_AVAILABLE } from '../domain/servicePreparation/releaseForCremation';
import { MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING } from './medicalExaminerApprovalService';
import { SERVICE_PREPARATION_WIX_FIELD_ADDED } from './servicePreparationStorage';
import { FUNERAL_DIRECTOR_CREDENTIALS_STORAGE_ENV } from './funeralDirectorCredentialSwitch';
import { GUS_CAMACHO_ORGANIZATION_ID, getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';

/**
 * Gus deployment preparation (2026-11): on the commit that goes to
 * `release/gus`, nothing live is switched on. Each of these changes only
 * with its own approval (docs/GUS_DEPLOYMENT_CHECKLIST.md › E).
 */
describe('Gus: every live switch is off in the code', () => {
  it('release, service-preparation saving and ME approval saving', () => {
    expect(RELEASE_FOR_CREMATION_AVAILABLE).toBe(false);
    expect(SERVICE_PREPARATION_WIX_FIELD_ADDED).toBe(false);
    expect(MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING).toBe(false);
  });

  it('no crematory communication path is active for Gus', () => {
    const { features } = getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID);
    expect(features.sendToCrematory?.sendingEnabled).toBe(false);
    expect(features.sendToCrematory?.requireReleaseAfterService).toBe(false);
    expect(features.sendToCrematory?.authorizationDocumentSource).toBe('not_configured');
    expect(features.deathCertificateFax ?? null).toBeNull();
    expect(features.familyPortalEnabled).toBe(false);
    expect(features.signatureRequestsEnabled).toBe(false);
  });

  it('live credential storage is opt-in by an environment variable that is not set here', () => {
    expect(FUNERAL_DIRECTOR_CREDENTIALS_STORAGE_ENV).toBe('SOLIS_FD_CREDENTIALS_STORAGE');
    expect(process.env[FUNERAL_DIRECTOR_CREDENTIALS_STORAGE_ENV]).toBeUndefined();
  });
});
