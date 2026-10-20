import { describe, expect, it } from 'vitest';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { decideExistingCaseAttachment, soleAttachableCandidate } from './existingCaseAttachment';
import type { DuplicateCandidate } from './duplicateCandidates';

const theCase = { ...caseFixtures[0], id: 'c1', caseNumber: 'B2026-001', dateOfBirth: '03/14/1951', isDeleted: false };
const candidate: DuplicateCandidate = { caseId: 'c1', caseNumber: 'B2026-001', decedentName: 'X', matchedOn: ['dateOfDeath'] };

function decide(overrides: Partial<Parameters<typeof decideExistingCaseAttachment>[0]> = {}) {
  return decideExistingCaseAttachment({
    candidates: [candidate],
    mappedFields: { dateOfBirth: '03/14/1951' },
    existingCase: theCase,
    caseLinks: [],
    formConfigId: 'form-a',
    ...overrides,
  });
}

describe('decideExistingCaseAttachment', () => {
  it('attaches to the one candidate whose name and date of death agree', () => {
    expect(decide()).toEqual({ attach: true, caseId: 'c1', caseNumber: 'B2026-001', dateOfBirthDiffers: false });
  });

  it('never attaches when the candidate lookup itself failed', () => {
    const unavailable: DuplicateCandidate = { caseId: '', caseNumber: '(lookup unavailable)', decedentName: '', matchedOn: [] };
    expect(soleAttachableCandidate([unavailable])).toEqual({ refusal: 'no_single_candidate' });
    expect(soleAttachableCandidate([candidate, unavailable])).toEqual({ refusal: 'no_single_candidate' });
  });

  it('refuses a case that is not the candidate it was asked about', () => {
    expect(decide({ existingCase: { ...theCase, id: 'other' } })).toEqual({ attach: false, reason: 'case_not_found' });
    expect(decide({ existingCase: null })).toEqual({ attach: false, reason: 'case_not_found' });
  });

  it('treats a slot link with no submission (a link sent but not yet used) as empty', () => {
    const sentLink = { caseId: 'c1', formConfigId: 'form-a', submissionId: null } as never;
    expect(decide({ caseLinks: [sentLink] })).toMatchObject({ attach: true });
  });

  it('a filled slot for a different form does not block', () => {
    const otherForm = { caseId: 'c1', formConfigId: 'form-b', submissionId: 's1' } as never;
    expect(decide({ caseLinks: [otherForm] })).toMatchObject({ attach: true });
  });

  it('a missing date of birth on either side is not a disagreement', () => {
    expect(decide({ mappedFields: {} })).toMatchObject({ dateOfBirthDiffers: false });
    expect(decide({ existingCase: { ...theCase, dateOfBirth: '—' } })).toMatchObject({ dateOfBirthDiffers: false });
  });
});
