import { describe, expect, it } from 'vitest';
import {
  GUS_CAMACHO_ORGANIZATION_ID,
  MANORS_ORGANIZATION_ID,
  ORGANIZATION_PROFILES,
  PLATFORM_DEFAULT_FEATURES,
  VA_FUNERAL_HOME_RESPONSIBILITY_KEY,
  getOrganizationProfile,
  getRegisteredOrganizationProfile,
  hasRegisteredOrganizationProfile,
  organizationShortName,
  vaNotificationFuneralHomeLabel,
  vaNotificationStaffPhrase,
} from './organizationProfiles';
import { isFamilyPortalEnabled, ORGANIZATION_OVERRIDES as FAMILY_PORTAL_OVERRIDES } from './familyPortalCapability';
import { isSignatureRequestsEnabled, ORGANIZATION_OVERRIDES as SIGNATURE_OVERRIDES } from './signatureRequestCapability';
import { isDocumentArchivingEnabled, ORGANIZATION_OVERRIDES as ARCHIVE_OVERRIDES } from './documentArchiveCapability';
import { shouldShowCaseOwner } from './caseOwnerVisibility';
import { additionalItemsLabel, usesAdditionalItemsTerminology, isManorsOrganization } from './caseOrderTerminology';
import { HIDEABLE_MODULE_KEYS, HIDDEN_MODULE_OVERRIDES, isModuleHidden } from './moduleVisibility';
import { RETIRED_CHECKLIST_ITEMS, retiredChecklistIndices } from './checklistRetirement';
import { MEDICAL_EXAMINER_STAGES, medicalExaminerStageFor } from './medicalExaminerWorkflow';
import { ORGANIZATION_DEFAULTS, isCremainsSchedulingEnabled, resolveCremainsPickupSettingsById, DISABLED_SETTINGS } from './cremainsPickupCapability';
import { presentedStageLabels, presentsCombinedIntakeLabelsUppercase } from './workflowStagePresentation';
import { usesLegacyCertifierPresentation } from '../cases/legacyCertifierPresentation';
import { shouldShowCashAdvanceSection } from '../billing/organizationStatementOverrides';
import { STAGES } from '../cases/stages';

const UNKNOWN = 'some-future-funeral-home';
const MANORS_STAGE_LABELS = ['First Call & Payment', 'Jotform Application', 'EDRS & Doctor / Cause of Death'];

describe('organization profile registry', () => {
  it('registers Manors and Gus Camacho Jr. by stable organization id', () => {
    expect(hasRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(hasRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID)).toBe(true);
    expect(hasRegisteredOrganizationProfile(UNKNOWN)).toBe(false);
    expect(hasRegisteredOrganizationProfile(null)).toBe(false);
    expect(Object.keys(ORGANIZATION_PROFILES).sort()).toEqual([GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID].sort());
  });

  it('Gus Camacho Jr.: name, prefix M, platform-default features, no letterhead (record-driven), no Manors data', () => {
    const gus = getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID);
    expect(gus.displayName).toBe('Gus Camacho Jr. Funeral Home');
    expect(gus.caseNumberPrefix).toBe('M');
    expect(gus.features).toEqual(PLATFORM_DEFAULT_FEATURES);
    expect(gus.pinnedFeatures).toEqual([]);
    expect(gus.letterhead).toBeNull();
    expect(gus.receiptFooter).toBeNull();
    expect(gus.legalName).toBeNull();
    expect(JSON.stringify(gus)).not.toMatch(/manors|commercial blvd|954-884-5770|broward|managed-cremations/i);
  });

  it('Manors: prefix B and its letterhead live in the profile', () => {
    const manors = getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID);
    expect(manors.caseNumberPrefix).toBe('B');
    expect(manors.letterhead?.phone).toBe('954-884-5770');
    expect(manors.letterhead?.logoAssetKey).toBe('manors-logo');
  });

  it('an unknown organization gets platform defaults', () => {
    const profile = getOrganizationProfile(UNKNOWN);
    expect(profile.registered).toBe(false);
    expect(profile.features).toEqual(PLATFORM_DEFAULT_FEATURES);
    expect(profile.letterhead).toBeNull();
    expect(profile.caseNumberPrefix).toBeNull();
    expect(profile.displayName).toBeNull();
    expect(organizationShortName(profile)).toBe('Funeral Home');
  });
});

describe('getOrganizationProfile precedence: record > profile > platform default', () => {
  it('record name/legalName/caseNumberPrefix win over the profile', () => {
    const profile = getOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID, { name: 'Gus Record Name', legalName: 'Gus Legal LLC', caseNumberPrefix: 'G' });
    expect(profile.displayName).toBe('Gus Record Name');
    expect(profile.legalName).toBe('Gus Legal LLC');
    expect(profile.caseNumberPrefix).toBe('G');
  });

  it('blank record fields fall back to the profile', () => {
    const profile = getOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID, { name: '  ', caseNumberPrefix: '' });
    expect(profile.displayName).toBe('Gus Camacho Jr. Funeral Home');
    expect(profile.caseNumberPrefix).toBe('M');
  });

  it('unregistered organizations take record fields over platform defaults', () => {
    const profile = getOrganizationProfile(UNKNOWN, { name: 'Future Home', familyPortalEnabled: false, hiddenModules: ['reports-staff'] });
    expect(profile.displayName).toBe('Future Home');
    expect(profile.features.familyPortalEnabled).toBe(false);
    expect(profile.features.hiddenModules).toEqual(['reports-staff']);
  });

  it('record capability fields win for an unpinned profile (Gus)', () => {
    const profile = getOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID, { signatureRequestsEnabled: false, hiddenModules: ['accounting-banking'] });
    expect(profile.features.signatureRequestsEnabled).toBe(false);
    expect(profile.features.hiddenModules).toEqual(['accounting-banking']);
  });

  it('PINNED profile features win over the record (Manors: the pre-existing override semantics)', () => {
    const profile = getOrganizationProfile(MANORS_ORGANIZATION_ID, { familyPortalEnabled: true, signatureRequestsEnabled: true, hiddenModules: [] });
    expect(profile.features.familyPortalEnabled).toBe(false);
    expect(profile.features.signatureRequestsEnabled).toBe(false);
    expect(profile.features.hiddenModules).toHaveLength(HIDEABLE_MODULE_KEYS.length);
  });

  it('Manors record name still wins (names are never pinned)', () => {
    expect(getOrganizationProfile(MANORS_ORGANIZATION_ID, { name: "Manor's Cremation" }).displayName).toBe("Manor's Cremation");
  });
});

describe('capabilities per organization (managed-cremations unchanged, Gus/unknown = defaults)', () => {
  const ids = [GUS_CAMACHO_ORGANIZATION_ID, UNKNOWN];

  it('Family Portal', () => {
    expect(isFamilyPortalEnabled({ id: MANORS_ORGANIZATION_ID })).toBe(false);
    for (const id of ids) {
      expect(isFamilyPortalEnabled({ id })).toBe(true);
      expect(isFamilyPortalEnabled({ id, familyPortalEnabled: false })).toBe(false);
    }
    expect(FAMILY_PORTAL_OVERRIDES).toEqual({ [MANORS_ORGANIZATION_ID]: false });
  });

  it('Signature Requests', () => {
    expect(isSignatureRequestsEnabled({ id: MANORS_ORGANIZATION_ID })).toBe(false);
    for (const id of ids) expect(isSignatureRequestsEnabled({ id })).toBe(true);
    expect(SIGNATURE_OVERRIDES).toEqual({ [MANORS_ORGANIZATION_ID]: false });
  });

  it('Document Archive', () => {
    expect(isDocumentArchivingEnabled(MANORS_ORGANIZATION_ID)).toBe(false);
    for (const id of ids) expect(isDocumentArchivingEnabled(id)).toBe(true);
    expect(ARCHIVE_OVERRIDES).toEqual({ [MANORS_ORGANIZATION_ID]: false });
  });

  it('Case Owner visibility', () => {
    expect(shouldShowCaseOwner(MANORS_ORGANIZATION_ID)).toBe(false);
    for (const id of ids) expect(shouldShowCaseOwner(id)).toBe(true);
  });

  it('Case Order terminology', () => {
    expect(additionalItemsLabel(MANORS_ORGANIZATION_ID)).toBe('Additional Items & Services');
    expect(usesAdditionalItemsTerminology(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(isManorsOrganization(MANORS_ORGANIZATION_ID)).toBe(true);
    for (const id of ids) {
      expect(additionalItemsLabel(id)).toBe('Edit Services');
      expect(usesAdditionalItemsTerminology(id)).toBe(false);
    }
  });

  it('Cash Advance section', () => {
    expect(shouldShowCashAdvanceSection(MANORS_ORGANIZATION_ID)).toBe(false);
    for (const id of ids) expect(shouldShowCashAdvanceSection(id)).toBe(true);
  });

  it('Hidden modules', () => {
    for (const key of HIDEABLE_MODULE_KEYS) {
      expect(isModuleHidden({ id: MANORS_ORGANIZATION_ID, hiddenModules: null }, key)).toBe(true);
      for (const id of ids) expect(isModuleHidden({ id, hiddenModules: null }, key)).toBe(false);
    }
    expect(Object.keys(HIDDEN_MODULE_OVERRIDES)).toEqual([MANORS_ORGANIZATION_ID]);
  });

  it('Retired checklist items', () => {
    const items = [{ index: 0, label: 'Ashes picked up (Tue/Fri)' }, { index: 1, label: 'Tag photo taken' }];
    expect([...retiredChecklistIndices(MANORS_ORGANIZATION_ID, 5, items)]).toEqual([1]);
    for (const id of ids) expect(retiredChecklistIndices(id, 5, items).size).toBe(0);
    expect(Object.keys(RETIRED_CHECKLIST_ITEMS)).toEqual([MANORS_ORGANIZATION_ID]);
  });

  it('Medical Examiner variant', () => {
    expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, 2)).not.toBeNull();
    expect(medicalExaminerStageFor(MANORS_ORGANIZATION_ID, 0)).not.toBeNull();
    for (const id of ids) {
      expect(medicalExaminerStageFor(id, 0)).toBeNull();
      expect(medicalExaminerStageFor(id, 2)).toBeNull();
    }
    expect(Object.keys(MEDICAL_EXAMINER_STAGES)).toEqual([MANORS_ORGANIZATION_ID]);
  });

  it('Cremains pickup scheduling (opt-in)', () => {
    expect(isCremainsSchedulingEnabled({ id: MANORS_ORGANIZATION_ID })).toBe(true);
    expect(resolveCremainsPickupSettingsById(MANORS_ORGANIZATION_ID)).toBe(ORGANIZATION_DEFAULTS[MANORS_ORGANIZATION_ID]);
    for (const id of ids) {
      expect(isCremainsSchedulingEnabled({ id })).toBe(false);
      expect(resolveCremainsPickupSettingsById(id)).toBe(DISABLED_SETTINGS);
    }
    expect(Object.keys(ORGANIZATION_DEFAULTS)).toEqual([MANORS_ORGANIZATION_ID]);
  });

  it('Workflow stage presentation (intake combination + uppercase)', () => {
    expect(presentedStageLabels(MANORS_ORGANIZATION_ID, MANORS_STAGE_LABELS)[0]).toBe('Intake & JotForm');
    expect(presentsCombinedIntakeLabelsUppercase(MANORS_ORGANIZATION_ID, MANORS_STAGE_LABELS)).toBe(true);
    for (const id of ids) {
      expect(presentedStageLabels(id, MANORS_STAGE_LABELS)).toEqual(MANORS_STAGE_LABELS);
      expect(presentsCombinedIntakeLabelsUppercase(id, MANORS_STAGE_LABELS)).toBe(false);
    }
    // The shared canonical STAGES list: identity for Gus, six stages for Manors.
    expect(presentedStageLabels(GUS_CAMACHO_ORGANIZATION_ID, STAGES)).toEqual([...STAGES]);
    expect(presentedStageLabels(MANORS_ORGANIZATION_ID, STAGES)).toHaveLength(STAGES.length - 1);
  });

  it('Legacy Certifier presentation', () => {
    expect(usesLegacyCertifierPresentation(MANORS_ORGANIZATION_ID)).toBe(true);
    for (const id of ids) expect(usesLegacyCertifierPresentation(id)).toBe(false);
  });
});

describe('VA notification responsibility label', () => {
  it('keeps the legacy stored key', () => {
    expect(VA_FUNERAL_HOME_RESPONSIBILITY_KEY).toBe('manors');
  });

  it('Manors: "MANORS" / "Manors staff" exactly as before', () => {
    const profile = getOrganizationProfile(MANORS_ORGANIZATION_ID);
    expect(vaNotificationFuneralHomeLabel(profile)).toBe('MANORS');
    expect(vaNotificationStaffPhrase(profile)).toBe('Manors staff');
  });

  it("Gus: its own short name, never MANORS", () => {
    const profile = getOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID);
    expect(vaNotificationFuneralHomeLabel(profile)).toBe('GUS CAMACHO JR.');
    expect(vaNotificationStaffPhrase(profile)).toBe('Gus Camacho Jr. staff');
  });

  it('unknown organization: record name if given, else generic', () => {
    expect(vaNotificationFuneralHomeLabel(getOrganizationProfile(UNKNOWN))).toBe('FUNERAL HOME');
    expect(vaNotificationStaffPhrase(getOrganizationProfile(UNKNOWN))).toBe('funeral home staff');
    expect(vaNotificationFuneralHomeLabel(getOrganizationProfile(UNKNOWN, { name: 'Future Home' }))).toBe('FUTURE HOME');
  });
});
