import { describe, it, expect } from 'vitest';
import { mapWixSignatureRequestItem, buildWixSignatureRequestData, applySignatureRequestPatchToWixData } from './wixSignatureRequestMapper';
import type { SignatureRequest } from '../types/signatureRequest';

const REQUEST: SignatureRequest = {
  id: 'req-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  documentVersion: 1,
  signerName: 'Jane Doe',
  signerEmail: 'jane@example.com',
  signerRole: 'next_of_kin',
  status: 'pending',
  tokenHash: 'a'.repeat(64),
  issuedAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-09-09T00:00:00.000Z',
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

describe('wixSignatureRequestMapper', () => {
  it('round-trips a request', () => {
    expect(mapWixSignatureRequestItem(buildWixSignatureRequestData(REQUEST))).toEqual(REQUEST);
  });

  it('returns null for undefined', () => {
    expect(mapWixSignatureRequestItem(undefined)).toBeNull();
  });

  it('returns null for an invalid signerRole/status', () => {
    expect(mapWixSignatureRequestItem({ ...buildWixSignatureRequestData(REQUEST), signerRole: 'bogus' })).toBeNull();
    expect(mapWixSignatureRequestItem({ ...buildWixSignatureRequestData(REQUEST), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixSignatureRequestItem({ ...buildWixSignatureRequestData(REQUEST), documentVersion: '1' })).toBeNull();
    expect(mapWixSignatureRequestItem({ ...buildWixSignatureRequestData(REQUEST), tokenHash: undefined })).toBeNull();
  });

  it('applySignatureRequestPatchToWixData merges only the given fields', () => {
    const wixItem = buildWixSignatureRequestData(REQUEST);
    const updated = applySignatureRequestPatchToWixData(wixItem, { status: 'viewed', viewedAt: '2026-08-11T00:00:00.000Z' });
    expect(updated.status).toBe('viewed');
    expect(updated.viewedAt).toBe('2026-08-11T00:00:00.000Z');
    expect(updated.tokenHash).toBe(wixItem.tokenHash);
    expect(updated.signerEmail).toBe(wixItem.signerEmail);
  });
});
