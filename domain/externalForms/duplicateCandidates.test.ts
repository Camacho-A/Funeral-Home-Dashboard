import { describe, expect, it } from 'vitest';
import { findDuplicateCandidates, normalizeNameForComparison } from './duplicateCandidates';
import type { Case } from '../../types/case';

function existingCase(overrides: Partial<Case>): Case {
  return {
    id: 'case-1',
    caseNumber: 'B2026-001',
    organizationId: 'managed-cremations',
    decedentName: 'EVARISTA SILVA RIVERO',
    dateOfBirth: '02/02/1950',
    dateOfDeath: '10/07/2026',
    ...overrides,
  } as Case;
}

describe('findDuplicateCandidates', () => {
  it('flags a case matching on name and date of death', () => {
    const candidates = findDuplicateCandidates(
      { decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '10/07/2026' },
      [existingCase({})],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ caseId: 'case-1', caseNumber: 'B2026-001', matchedOn: ['dateOfDeath'] });
  });

  it('flags a case matching on name and date of birth', () => {
    const candidates = findDuplicateCandidates(
      { decedentName: 'EVARISTA SILVA RIVERO', dateOfBirth: '02/02/1950' },
      [existingCase({})],
    );
    expect(candidates[0].matchedOn).toEqual(['dateOfBirth']);
  });

  it('reports every corroborating field, so a review shows why it was flagged', () => {
    const candidates = findDuplicateCandidates(
      { decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '10/07/2026', dateOfBirth: '02/02/1950' },
      [existingCase({})],
    );
    expect(candidates[0].matchedOn).toEqual(['dateOfDeath', 'dateOfBirth']);
  });

  it('NEVER flags on the name alone', () => {
    // The central safety rule. Two people really can share a name — a
    // junior and senior, or a common name in a small county — and
    // stalling a legitimate new case on that would leave a death
    // unrecorded.
    expect(findDuplicateCandidates({ decedentName: 'EVARISTA SILVA RIVERO' }, [existingCase({})])).toEqual([]);
    expect(
      findDuplicateCandidates({ decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '01/01/2026' }, [existingCase({})]),
    ).toEqual([]);
  });

  it('a different name is never a candidate, however well the dates agree', () => {
    expect(
      findDuplicateCandidates(
        { decedentName: 'ROBERT ELLISON', dateOfDeath: '10/07/2026', dateOfBirth: '02/02/1950' },
        [existingCase({})],
      ),
    ).toEqual([]);
  });

  it('does not fuzzy-match near-identical names', () => {
    // Formatting differences are absorbed; spelling differences are not.
    expect(
      findDuplicateCandidates({ decedentName: 'JON SMITH', dateOfDeath: '10/07/2026' }, [
        existingCase({ decedentName: 'JOHN SMITH' }),
      ]),
    ).toEqual([]);
  });

  it('absorbs case, punctuation and whitespace differences between the two forms', () => {
    const variants = ["o'brien,  mary", 'O BRIEN MARY', "  O'Brien   Mary  "];
    for (const submitted of variants) {
      const candidates = findDuplicateCandidates({ decedentName: submitted, dateOfDeath: '10/07/2026' }, [
        existingCase({ decedentName: "O'BRIEN MARY" }),
      ]);
      expect(candidates, submitted).toHaveLength(1);
    }
  });

  it('treats the unknown placeholder as no value, never as a match', () => {
    // POST /api/cases stores "—" for an unsupplied optional field; two
    // cases both carrying it have not corroborated anything.
    expect(
      findDuplicateCandidates({ decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '—' }, [
        existingCase({ dateOfDeath: '—' }),
      ]),
    ).toEqual([]);
    expect(findDuplicateCandidates({ decedentName: '—', dateOfDeath: '10/07/2026' }, [existingCase({})])).toEqual([]);
  });

  it('returns nothing when the submission has no decedent name', () => {
    expect(findDuplicateCandidates({ dateOfDeath: '10/07/2026' }, [existingCase({})])).toEqual([]);
    expect(findDuplicateCandidates({ decedentName: '   ' }, [existingCase({})])).toEqual([]);
  });

  it('includes archived cases — a filed death is still the same death', () => {
    const candidates = findDuplicateCandidates({ decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '10/07/2026' }, [
      existingCase({ isDeleted: true }),
    ]);
    expect(candidates).toHaveLength(1);
  });

  it('returns every matching case, not just the first', () => {
    const candidates = findDuplicateCandidates({ decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '10/07/2026' }, [
      existingCase({ id: 'case-1', caseNumber: 'B2026-001' }),
      existingCase({ id: 'case-2', caseNumber: 'B2026-002' }),
      existingCase({ id: 'case-3', caseNumber: 'B2026-003', decedentName: 'SOMEONE ELSE' }),
    ]);
    expect(candidates.map((c) => c.caseNumber)).toEqual(['B2026-001', 'B2026-002']);
  });

  it('an empty case list yields no candidates', () => {
    expect(findDuplicateCandidates({ decedentName: 'EVARISTA SILVA RIVERO', dateOfDeath: '10/07/2026' }, [])).toEqual([]);
  });
});

describe('normalizeNameForComparison', () => {
  it('is comparison-only — it never claims to produce a storable name', () => {
    expect(normalizeNameForComparison("  O'BRIEN,  Mary-Jane ")).toBe('o brien mary jane');
    expect(normalizeNameForComparison('!!!')).toBe('');
  });
});
