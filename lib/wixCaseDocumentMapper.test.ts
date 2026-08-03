import { describe, it, expect } from 'vitest';
import { mapWixCaseDocumentItem, buildWixCaseDocumentData, applyCaseDocumentStatusToWixData, applyCaseDocumentSignatureStatusToWixData } from './wixCaseDocumentMapper';
import type { CaseDocument } from '../types/caseDocument';

const GENERATED: CaseDocument = {
  id: 'doc-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  origin: 'generated',
  documentTypeKey: 'authorization.cremation',
  category: 'authorization',
  fileName: 'cremation-authorization.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 48213,
  checksumSha256: 'a'.repeat(64),
  storageKey: 'org-1/case-1/doc-1.pdf',
  status: 'active',
  templateId: 'template-1',
  templateVersion: 2,
  version: 1,
  supersedesId: null,
  signatureStatus: null,
  generatedBy: 'identity-1',
  uploadedBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  correlationId: 'corr-1',
};

const UPLOADED: CaseDocument = {
  ...GENERATED,
  id: 'doc-2',
  origin: 'uploaded',
  documentTypeKey: null,
  category: null,
  fileName: 'scan.jpg',
  mimeType: 'image/jpeg',
  templateId: null,
  templateVersion: null,
  version: null,
  supersedesId: null,
  generatedBy: null,
  uploadedBy: 'identity-2',
};

describe('wixCaseDocumentMapper', () => {
  it('round-trips a generated document', () => {
    expect(mapWixCaseDocumentItem(buildWixCaseDocumentData(GENERATED))).toEqual(GENERATED);
  });

  it('round-trips an uploaded document with every generated-only field null', () => {
    expect(mapWixCaseDocumentItem(buildWixCaseDocumentData(UPLOADED))).toEqual(UPLOADED);
  });

  it('returns null for undefined', () => {
    expect(mapWixCaseDocumentItem(undefined)).toBeNull();
  });

  it('returns null for an invalid origin/status/signatureStatus', () => {
    expect(mapWixCaseDocumentItem({ ...buildWixCaseDocumentData(GENERATED), origin: 'bogus' })).toBeNull();
    expect(mapWixCaseDocumentItem({ ...buildWixCaseDocumentData(GENERATED), status: 'bogus' })).toBeNull();
    expect(mapWixCaseDocumentItem({ ...buildWixCaseDocumentData(GENERATED), signatureStatus: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixCaseDocumentItem({ ...buildWixCaseDocumentData(GENERATED), fileSizeBytes: '48213' })).toBeNull();
    expect(mapWixCaseDocumentItem({ ...buildWixCaseDocumentData(GENERATED), checksumSha256: undefined })).toBeNull();
  });

  it('applyCaseDocumentStatusToWixData changes only status', () => {
    const wixItem = buildWixCaseDocumentData(GENERATED);
    const updated = applyCaseDocumentStatusToWixData(wixItem, 'superseded');
    expect(updated.status).toBe('superseded');
    expect(updated.storageKey).toBe(wixItem.storageKey);
    expect(updated.checksumSha256).toBe(wixItem.checksumSha256);
  });

  it('Phase 26: applyCaseDocumentSignatureStatusToWixData changes only signatureStatus', () => {
    const wixItem = buildWixCaseDocumentData(GENERATED);
    const updated = applyCaseDocumentSignatureStatusToWixData(wixItem, 'signed');
    expect(updated.signatureStatus).toBe('signed');
    expect(updated.status).toBe(wixItem.status);
    expect(updated.storageKey).toBe(wixItem.storageKey);
  });
});
