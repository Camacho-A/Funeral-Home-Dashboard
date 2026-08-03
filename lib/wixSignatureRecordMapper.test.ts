import { describe, it, expect } from 'vitest';
import { mapWixSignatureRecordItem, buildWixSignatureRecordData } from './wixSignatureRecordMapper';
import type { SignatureRecord } from '../types/signatureRecord';

const RECORD: SignatureRecord = {
  id: 'sig-rec-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  documentId: 'doc-1',
  documentVersion: 1,
  signatureRequestId: 'req-1',
  signerName: 'Jane Doe',
  signerEmail: 'jane@example.com',
  signerRole: 'next_of_kin',
  signedName: 'Jane Doe',
  initials: 'JD',
  ipAddress: '203.0.113.1',
  userAgent: 'Mozilla/5.0',
  signatureMethod: 'typed_name',
  verificationStatus: 'verified',
  documentChecksumSha256: 'b'.repeat(64),
  recordVersion: 1,
  correlationId: 'corr-1',
  signedAt: '2026-08-15T00:00:00.000Z',
};

describe('wixSignatureRecordMapper', () => {
  it('round-trips a record', () => {
    expect(mapWixSignatureRecordItem(buildWixSignatureRecordData(RECORD))).toEqual(RECORD);
  });

  it('round-trips a record with null initials', () => {
    const withoutInitials = { ...RECORD, initials: null };
    expect(mapWixSignatureRecordItem(buildWixSignatureRecordData(withoutInitials))).toEqual(withoutInitials);
  });

  it('returns null for undefined', () => {
    expect(mapWixSignatureRecordItem(undefined)).toBeNull();
  });

  it('returns null for an invalid signerRole/signatureMethod/verificationStatus', () => {
    expect(mapWixSignatureRecordItem({ ...buildWixSignatureRecordData(RECORD), signerRole: 'bogus' })).toBeNull();
    expect(mapWixSignatureRecordItem({ ...buildWixSignatureRecordData(RECORD), signatureMethod: 'drawn' })).toBeNull();
    expect(mapWixSignatureRecordItem({ ...buildWixSignatureRecordData(RECORD), verificationStatus: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing or malformed', () => {
    expect(mapWixSignatureRecordItem({ ...buildWixSignatureRecordData(RECORD), documentChecksumSha256: undefined })).toBeNull();
    expect(mapWixSignatureRecordItem({ ...buildWixSignatureRecordData(RECORD), recordVersion: '1' })).toBeNull();
  });

  it('exposes no update/patch function — insert-only by construction', async () => {
    const moduleExports = await import('./wixSignatureRecordMapper');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.some((name) => /^apply/i.test(name))).toBe(false);
  });
});
