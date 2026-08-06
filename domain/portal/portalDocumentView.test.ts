import { describe, it, expect } from 'vitest';
import { buildPortalDocumentView } from './portalDocumentView';
import type { CaseDocument } from '../../types/caseDocument';

const DOCUMENT: CaseDocument = {
  id: 'doc-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  origin: 'generated',
  documentTypeKey: 'authorization.cremation',
  category: 'authorization',
  fileName: 'Cremation Authorization.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 48213,
  checksumSha256: 'a'.repeat(64),
  storageKey: 'org-1/case-1/doc-1.pdf',
  status: 'active',
  templateId: 'template-1',
  templateVersion: 2,
  version: 1,
  supersedesId: null,
  signatureStatus: 'signed',
  familyVisible: true,
  generatedBy: 'identity-1',
  uploadedBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  correlationId: 'corr-1',
};

describe('buildPortalDocumentView', () => {
  it('exposes only family-safe fields', () => {
    expect(buildPortalDocumentView(DOCUMENT)).toEqual({
      id: 'doc-1',
      fileName: 'Cremation Authorization.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 48213,
      category: 'authorization',
      documentTypeKey: 'authorization.cremation',
      signatureStatus: 'signed',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('never includes storageKey, checksumSha256, internal versioning, staff-identity, or familyVisible itself', () => {
    const view = buildPortalDocumentView(DOCUMENT);
    const keys = Object.keys(view);
    for (const forbidden of [
      'organizationId',
      'caseId',
      'storageKey',
      'checksumSha256',
      'templateId',
      'templateVersion',
      'version',
      'supersedesId',
      'generatedBy',
      'uploadedBy',
      'correlationId',
      'familyVisible',
      'status',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
