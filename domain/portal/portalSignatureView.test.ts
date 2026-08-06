import { describe, it, expect } from 'vitest';
import { buildPortalSignatureRequestView } from './portalSignatureView';
import type { SignatureRequest } from '../../types/signatureRequest';

const REQUEST: SignatureRequest = {
  id: 'sig-req-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  documentVersion: 1,
  signerName: 'Jane Doe',
  signerEmail: 'jane@example.com',
  signerRole: 'next_of_kin',
  status: 'pending',
  tokenHash: 'a'.repeat(64),
  issuedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  requestVersion: 1,
  sequenceOrder: 1,
  requestedBy: 'identity-1',
  viewedAt: null,
  signedAt: null,
  declinedAt: null,
  declineReason: null,
  cancelledAt: null,
  cancelledBy: null,
  lastRemindedAt: null,
  reminderCount: 0,
  correlationId: 'corr-1',
};

describe('buildPortalSignatureRequestView', () => {
  it('exposes only family-safe fields', () => {
    expect(buildPortalSignatureRequestView(REQUEST)).toEqual({
      id: 'sig-req-1',
      documentId: 'doc-1',
      status: 'pending',
      issuedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('never includes tokenHash, signer fields, or staff-identity fields', () => {
    const view = buildPortalSignatureRequestView(REQUEST);
    const keys = Object.keys(view);
    for (const forbidden of ['tokenHash', 'signerName', 'signerEmail', 'signerRole', 'requestedBy', 'organizationId', 'caseId', 'correlationId']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
