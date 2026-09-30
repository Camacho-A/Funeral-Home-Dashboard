import { describe, expect, it } from 'vitest';
import {
  CASE_LIST_DEFAULT_PAGE_SIZE,
  CASE_LIST_MAX_PAGE_SIZE,
  CASE_SEARCHABLE_FIELDS,
  buildCaseListWixFilter,
  buildCaseSearchWixFilter,
  clampCaseListPageSize,
  compareCasesForListSort,
  decodeCaseCursor,
  encodeCaseCursor,
  matchesSearchStartsWith,
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

describe('cursor encode/decode/validate (Case list scalability, Phase 1+2)', () => {
  it('round-trips a wix cursor payload, including stage', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', stage: 'Completed', wixCursor: 'raw-wix-token' });
    expect(decodeCaseCursor(token)).toEqual({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', stage: 'Completed', wixCursor: 'raw-wix-token' });
  });

  it('round-trips a mock cursor payload with stage: null (All Cases)', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: 'emma', stage: null, offset: 50 });
    expect(decodeCaseCursor(token)).toEqual({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: 'emma', stage: null, offset: 50 });
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

  it('decodes to null for a payload with a non-string, non-null stage', () => {
    const token = Buffer.from(
      JSON.stringify({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', stage: 42, wixCursor: 'abc' }),
      'utf8',
    ).toString('base64url');
    expect(decodeCaseCursor(token)).toBeNull();
  });

  it('decodes to null for a mock payload with a negative/non-integer offset', () => {
    const negative = Buffer.from(
      JSON.stringify({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: '', stage: null, offset: -1 }),
      'utf8',
    ).toString('base64url');
    const fractional = Buffer.from(
      JSON.stringify({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: '', stage: null, offset: 1.5 }),
      'utf8',
    ).toString('base64url');
    expect(decodeCaseCursor(negative)).toBeNull();
    expect(decodeCaseCursor(fractional)).toBeNull();
  });

  it('validateCaseCursor accepts a cursor whose context (including stage) matches exactly', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: 'emma', stage: 'Completed', wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: 'emma', stage: 'Completed', kind: 'wix' });
    expect(result.ok).toBe(true);
  });

  it('validateCaseCursor accepts a cursor minted with stage: null (All Cases) against a request with no stage', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', stage: null, wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: '', stage: null, kind: 'wix' });
    expect(result.ok).toBe(true);
  });

  it('validateCaseCursor rejects a cursor minted for a different organization — cannot be used to bypass org scoping', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-attacker', searchQuery: '', stage: null, wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-victim', searchQuery: '', stage: null, kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted for a different search query', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: 'emma', stage: null, offset: 10 });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: 'karen', stage: null, kind: 'mock' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted for a different adapter kind', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'mock', organizationId: 'org-1', searchQuery: '', stage: null, offset: 10 });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: '', stage: null, kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted for a different stage — Completed + "Morales" cannot page through First Call & Payment + "Morales"', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: 'morales', stage: 'Completed', wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: 'morales', stage: 'First Call & Payment', kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted for a different search query within the same stage — Completed + "Morales" cannot page through Completed + "Smith"', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: 'morales', stage: 'Completed', wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: 'smith', stage: 'Completed', kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a cursor minted with no stage against a request that now supplies one', () => {
    const token = encodeCaseCursor({ v: 1, kind: 'wix', organizationId: 'org-1', searchQuery: '', stage: null, wixCursor: 'abc' });
    const result = validateCaseCursor(token, { organizationId: 'org-1', searchQuery: '', stage: 'Completed', kind: 'wix' });
    expect(result.ok).toBe(false);
  });

  it('validateCaseCursor rejects a malformed token safely rather than throwing', () => {
    const result = validateCaseCursor('garbage', { organizationId: 'org-1', searchQuery: '', stage: null, kind: 'wix' });
    expect(result.ok).toBe(false);
  });
});

describe('matchesSearchStartsWith (Case list scalability, Phase 2 — server-side search parity)', () => {
  function caseOf(overrides: Partial<{ decedentName: string; caseNumber: string; nextOfKinPhone: string; nextOfKinEmail: string | null; tagNumber: string | null; id: string }>) {
    return {
      decedentName: '',
      caseNumber: '',
      nextOfKinPhone: '',
      nextOfKinEmail: null,
      tagNumber: null,
      id: '',
      ...overrides,
    };
  }

  it('matches every currently-searchable field preserved from matchesSearch', () => {
    expect(CASE_SEARCHABLE_FIELDS).toEqual(['decedentName', 'caseNumber', 'nextOfKinPhone', 'nextOfKinEmail', 'tagNumber', 'id']);
  });

  it('an empty/blank query matches everything', () => {
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA' }), '')).toBe(true);
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA' }), '   ')).toBe(true);
  });

  it('matches a case-insensitive prefix of decedentName', () => {
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA' }), 'emma')).toBe(true);
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA' }), 'EMMA')).toBe(true);
  });

  it('does NOT match a non-prefix substring of decedentName — the documented startsWith narrowing', () => {
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA' }), 'morales')).toBe(false);
  });

  it('matches a prefix of caseNumber', () => {
    expect(matchesSearchStartsWith(caseOf({ caseNumber: 'B2026-042' }), 'b2026')).toBe(true);
  });

  it('matches a prefix of nextOfKinPhone', () => {
    expect(matchesSearchStartsWith(caseOf({ nextOfKinPhone: '(954) 901-4165' }), '(954)')).toBe(true);
  });

  it('matches a prefix of nextOfKinEmail, and never crashes when it is null', () => {
    expect(matchesSearchStartsWith(caseOf({ nextOfKinEmail: 'karen@example.com' }), 'karen')).toBe(true);
    expect(matchesSearchStartsWith(caseOf({ nextOfKinEmail: null }), 'karen')).toBe(false);
  });

  it('matches a prefix of tagNumber, and never crashes when it is null', () => {
    expect(matchesSearchStartsWith(caseOf({ tagNumber: 'T-1234' }), 't-12')).toBe(true);
    expect(matchesSearchStartsWith(caseOf({ tagNumber: null }), 't-12')).toBe(false);
  });

  it('matches a prefix of id', () => {
    expect(matchesSearchStartsWith(caseOf({ id: 'case-abc-123' }), 'case-abc')).toBe(true);
  });

  it('whitespace around the query is trimmed', () => {
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA' }), '  emma  ')).toBe(true);
  });

  it('a query matching no field returns false', () => {
    expect(matchesSearchStartsWith(caseOf({ decedentName: 'EMMA MORALES SILVA', caseNumber: 'B2026-001' }), 'zzz')).toBe(false);
  });
});

describe('buildCaseSearchWixFilter', () => {
  it('returns null for a blank query', () => {
    expect(buildCaseSearchWixFilter('')).toBeNull();
    expect(buildCaseSearchWixFilter('   ')).toBeNull();
  });

  it('builds an $or of $startsWith across every searchable field, trimmed, using Wix collection field names (id -> beaconCaseId)', () => {
    expect(buildCaseSearchWixFilter('  Morales  ')).toEqual({
      $or: [
        { decedentName: { $startsWith: 'Morales' } },
        { caseNumber: { $startsWith: 'Morales' } },
        { nextOfKinPhone: { $startsWith: 'Morales' } },
        { nextOfKinEmail: { $startsWith: 'Morales' } },
        { tagNumber: { $startsWith: 'Morales' } },
        { beaconCaseId: { $startsWith: 'Morales' } },
      ],
    });
  });
});

describe('buildCaseListWixFilter', () => {
  it('produces the exact Phase 1 filter shape when no stage/search is requested', () => {
    expect(buildCaseListWixFilter({ organizationId: 'org-1', rawStages: null })).toEqual({
      organizationId: 'org-1',
      isArchived: false,
    });
  });

  it('adds currentStage $in (the real Wix field for Case.rawStage) when a stage is requested', () => {
    expect(buildCaseListWixFilter({ organizationId: 'org-1', rawStages: [0, 1] })).toEqual({
      organizationId: 'org-1',
      isArchived: false,
      currentStage: { $in: [0, 1] },
    });
  });

  it('combines the base filter and a search filter with $and when both are present', () => {
    const searchFilter = buildCaseSearchWixFilter('morales')!;
    expect(buildCaseListWixFilter({ organizationId: 'org-1', rawStages: [7], searchFilter })).toEqual({
      $and: [{ organizationId: 'org-1', isArchived: false, currentStage: { $in: [7] } }, searchFilter],
    });
  });
});
