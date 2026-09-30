import { describe, expect, it } from 'vitest';
import {
  CASE_LIST_DEFAULT_PAGE_SIZE,
  CASE_LIST_MAX_PAGE_SIZE,
  clampCaseListPageSize,
  compareCasesForListSort,
  decodeCaseCursor,
  encodeCaseCursor,
  validateCaseCursor,
} from './casePagination';

describe('clampCaseListPageSize', () => {
  it('falls back to the default when null', () => {
    expect(clampCaseListPageSize(null)).toBe(CASE_LIST_DEFAULT_PAGE_SIZE);
  });

  it('falls back to the default for zero/negative/non-finite values', () => {
    expect(clampCaseListPageSize(0)).toBe(CASE_LIST_DEFAULT_PAGE_SIZE);
    expect(clampCaseListPageSize(-5)).toBe(CASE_LIST_DEFAULT_PAGE_SIZE);
    expect(clampCaseListPageSize(Number.NaN)).toBe(CASE_LIST_DEFAULT_PAGE_SIZE);
    expect(clampCaseListPageSize(Number.POSITIVE_INFINITY)).toBe(CASE_LIST_DEFAULT_PAGE_SIZE);
  });

  it('passes through a valid requested size within bounds', () => {
    expect(clampCaseListPageSize(10)).toBe(10);
  });

  it('floors a non-integer request', () => {
    expect(clampCaseListPageSize(10.9)).toBe(10);
  });

  it('never exceeds the maximum page size', () => {
    expect(clampCaseListPageSize(CASE_LIST_MAX_PAGE_SIZE + 1000)).toBe(CASE_LIST_MAX_PAGE_SIZE);
  });
});

describe('compareCasesForListSort', () => {
  it('orders by createdAt descending', () => {
    const older = { createdAt: '2026-01-01T00:00:00.000Z', caseNumber: 'B2026-001' };
    const newer = { createdAt: '2026-02-01T00:00:00.000Z', caseNumber: 'B2026-002' };
    expect(compareCasesForListSort(newer, older)).toBeLessThan(0);
    expect(compareCasesForListSort(older, newer)).toBeGreaterThan(0);
  });

  it('breaks a createdAt tie using caseNumber descending', () => {
    const a = { createdAt: '2026-01-01T00:00:00.000Z', caseNumber: 'B2026-001' };
    const b = { createdAt: '2026-01-01T00:00:00.000Z', caseNumber: 'B2026-002' };
    expect(compareCasesForListSort(b, a)).toBeLessThan(0);
    expect(compareCasesForListSort(a, b)).toBeGreaterThan(0);
  });

  it('is exactly zero for two identical entries (stable no-op)', () => {
    const a = { createdAt: '2026-01-01T00:00:00.000Z', caseNumber: 'B2026-001' };
    expect(compareCasesForListSort(a, { ...a })).toBe(0);
  });
});

describe('cursor encode/decode/validate', () => {
  it('round-trips a wix cursor payload', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', wixCursor: 'raw-wix-token' });
    expect(decodeCaseCursor(token)).toEqual({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', wixCursor: 'raw-wix-token' });
  });

  it('round-trips a mock cursor payload', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: 'emma', offset: 50 });
    expect(decodeCaseCursor(token)).toEqual({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: 'emma', offset: 50 });
  });

  it('decodes to null for garbage input rather than throwing', () => {
    expect(decodeCaseCursor('not-a-real-cursor-token')).toBeNull();
    expect(decodeCaseCursor('')).toBeNull();
    expect(decodeCaseCursor('!!!not-base64url!!!')).toBeNull();
  });

  it('decodes to null for a well-formed but wrong-shaped payload', () => {
    const token = Buffer.from(JSON.stringify({ v: 2, foo: 'bar' }), 'utf8').toString('base64url');
    expect(decodeCaseCursor(token)).toBeNull();
  });

  it('decodes to null for a mock payload with a negative/non-integer offset', () => {
    const negative = Buffer.from(JSON.stringify({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: '', offset: -1 }), 'utf8').toString(
      'base64url',
    );
    const fractional = Buffer.from(
      JSON.stringify({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: '', offset: 1.5 }),
      'utf8',
    ).toString('base64url');
    expect(decodeCaseCursor(negative)).toBeNull();
    expect(decodeCaseCursor(fractional)).toBeNull();
  });

  it('validateCaseCursor accepts a cursor whose context matches exactly', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: 'emma', wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: 'emma', kind: 'wix' });
    expect(result.ok).toBe(true);
  });

  it('validateCaseCursor rejects a cursor minted for a different organization — cannot be used to bypass org scoping', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-attacker', searchQuery: '', wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-victim', searchQuery: '', kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted for a different search query', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: 'emma', offset: 10 });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: 'karen', kind: 'mock' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted for a different adapter kind', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: '', offset: 10 });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: '', kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a malformed token safely rather than throwing', () => {
    const result = validateCaseCursor('garbage', { organizationId: 'org-1', searchQuery: '', kind: 'wix' });
    expect(result.ok).toBe(false);
  });
});
