import { describe, expect, it } from 'vitest';
import {
  mapWixExternalFormConfigItem,
  buildWixExternalFormConfigData,
  mapWixExternalFormSubmissionItem,
  buildWixExternalFormSubmissionData,
  applyExternalFormSubmissionUpdateToWixData,
  type WixExternalFormConfigItem,
} from './wixExternalFormMapper';
import type { ExternalFormConfig } from '@/types/externalFormConfig';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';

const VALID_CONFIG: ExternalFormConfig = {
  id: 'extform-config-managed-cremations-jotform-vital-statistics',
  organizationId: 'managed-cremations',
  provider: 'jotform',
  externalFormId: '262605621454050',
  label: 'Vital Statistics',
  audience: 'family',
  fieldMap: '{}',
  linkTokenFieldName: 'solisLinkToken',
  linkTokenFieldQid: '44',
  webhookAuthFieldQid: '45',
  isEnabled: true,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
};

describe('ExternalFormConfig Wix mapper — round trip', () => {
  it('buildWixExternalFormConfigData -> mapWixExternalFormConfigItem preserves every field, including the new qid identifiers', () => {
    const wixData = buildWixExternalFormConfigData(VALID_CONFIG);
    const mapped = mapWixExternalFormConfigItem(VALID_CONFIG.id, wixData);
    expect(mapped).toEqual(VALID_CONFIG);
    expect(mapped?.linkTokenFieldQid).toBe('44');
    expect(mapped?.webhookAuthFieldQid).toBe('45');
  });

  it('preserves the Arrangement Forms qid values distinctly from Vital Statistics', () => {
    const arrangementConfig: ExternalFormConfig = {
      ...VALID_CONFIG,
      id: 'extform-config-managed-cremations-jotform-arrangement-forms',
      externalFormId: '261945978664175',
      label: 'Arrangement Forms',
      audience: 'staff',
      linkTokenFieldQid: '274',
      webhookAuthFieldQid: '275',
    };
    const mapped = mapWixExternalFormConfigItem(arrangementConfig.id, buildWixExternalFormConfigData(arrangementConfig));
    expect(mapped?.linkTokenFieldQid).toBe('274');
    expect(mapped?.webhookAuthFieldQid).toBe('275');
  });
});

describe('ExternalFormConfig Wix mapper — fails safe on a malformed/incomplete row', () => {
  it('returns null when linkTokenFieldQid is missing', () => {
    const item: WixExternalFormConfigItem = { ...buildWixExternalFormConfigData(VALID_CONFIG) };
    delete item.linkTokenFieldQid;
    expect(mapWixExternalFormConfigItem(VALID_CONFIG.id, item)).toBeNull();
  });

  it('returns null when webhookAuthFieldQid is missing', () => {
    const item: WixExternalFormConfigItem = { ...buildWixExternalFormConfigData(VALID_CONFIG) };
    delete item.webhookAuthFieldQid;
    expect(mapWixExternalFormConfigItem(VALID_CONFIG.id, item)).toBeNull();
  });

  it('returns null when linkTokenFieldQid is the wrong type (not a string)', () => {
    const item: WixExternalFormConfigItem = { ...buildWixExternalFormConfigData(VALID_CONFIG), linkTokenFieldQid: 44 };
    expect(mapWixExternalFormConfigItem(VALID_CONFIG.id, item)).toBeNull();
  });

  it('returns null for a completely undefined item', () => {
    expect(mapWixExternalFormConfigItem('some-id', undefined)).toBeNull();
  });
});

const VALID_SUBMISSION: ExternalFormSubmission = {
  id: 'org-1-jotform-sub-1',
  organizationId: 'org-1',
  provider: 'jotform',
  externalFormId: '261945978664175',
  externalSubmissionId: 'sub-1',
  caseFormLinkId: null,
  status: 'unmatched',
  mappedFields: '{}',
  receivedAt: '2026-09-24T00:00:00.000Z',
  reviewedAt: null,
  reviewedBy: null,
  documentId: null,
  pdfStatus: 'pending',
  pdfFailureReason: null,
  createdCaseId: null,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
};

describe('ExternalFormSubmission Wix mapper — createdCaseId (2026-09 historical case creation)', () => {
  it('round-trips a null createdCaseId', () => {
    const wixData = buildWixExternalFormSubmissionData(VALID_SUBMISSION);
    const mapped = mapWixExternalFormSubmissionItem(VALID_SUBMISSION.id, wixData);
    expect(mapped?.createdCaseId).toBeNull();
  });

  it('round-trips a real case id', () => {
    const withCase: ExternalFormSubmission = { ...VALID_SUBMISSION, createdCaseId: 'real-case-id-1' };
    const mapped = mapWixExternalFormSubmissionItem(withCase.id, buildWixExternalFormSubmissionData(withCase));
    expect(mapped?.createdCaseId).toBe('real-case-id-1');
  });

  it('round-trips an in-flight claim token unchanged', () => {
    const withClaim: ExternalFormSubmission = { ...VALID_SUBMISSION, createdCaseId: 'CLAIMING:abc-123' };
    const mapped = mapWixExternalFormSubmissionItem(withClaim.id, buildWixExternalFormSubmissionData(withClaim));
    expect(mapped?.createdCaseId).toBe('CLAIMING:abc-123');
  });

  it('defaults createdCaseId to null when absent from the stored row (pre-existing rows from before this field existed)', () => {
    const item = buildWixExternalFormSubmissionData(VALID_SUBMISSION);
    delete item.createdCaseId;
    const mapped = mapWixExternalFormSubmissionItem(VALID_SUBMISSION.id, item);
    expect(mapped).not.toBeNull();
    expect(mapped?.createdCaseId).toBeNull();
  });

  it('applyExternalFormSubmissionUpdateToWixData applies a createdCaseId patch', () => {
    const existing = buildWixExternalFormSubmissionData(VALID_SUBMISSION);
    const patched = applyExternalFormSubmissionUpdateToWixData(existing, { createdCaseId: 'real-case-id-2' });
    expect(patched.createdCaseId).toBe('real-case-id-2');
  });
});
