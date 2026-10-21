import { describe, expect, it } from 'vitest';
import { caseLogContactProblems, caseLogEntryDisplay, caseLogEntryProblem } from './caseLogDisplay';
import type { CaseLogEntry } from '../../types/caseLogEntry';

describe('caseLogEntryProblem', () => {
  it('requires note text', () => {
    expect(caseLogEntryProblem({ type: 'note', text: ' ' })).not.toBeNull();
    expect(caseLogEntryProblem({ type: 'note', text: 'x' })).toBeNull();
  });

  it('a contact entry requires BOTH who was contacted and a summary (2026-10)', () => {
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME', contactSummary: 'Released' })).toBeNull();
    expect(caseLogEntryProblem({ type: 'contact', contactSummary: 'Left voicemail' })).toBe('Please enter who was contacted.');
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME' })).toBe('A summary is required.');
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME', contactSummary: ' ' })).toBe('A summary is required.');
  });

  it('rejects blank, whitespace-only, null and non-string contacts', () => {
    for (const contactedWho of ['', '   ', '\n\t', null, undefined, 5, {}, ['ME']]) {
      expect(caseLogEntryProblem({ type: 'contact', contactedWho, contactSummary: 'Left voicemail' }), String(contactedWho)).toBe(
        'Please enter who was contacted.',
      );
    }
  });

  it('reports each missing field separately, for inline messages', () => {
    expect(caseLogContactProblems({})).toEqual({ contactedWho: 'Please enter who was contacted.', contactSummary: 'A summary is required.' });
    expect(caseLogContactProblems({ contactedWho: 'Dr. Lee', contactSummary: 'Attestation signed' })).toEqual({});
  });
});

describe('caseLogEntryDisplay — historical entries read as recorded', () => {
  const contact = (overrides: Partial<CaseLogEntry>): CaseLogEntry => ({
    id: 'e',
    organizationId: 'o',
    caseId: 'c',
    type: 'contact',
    text: null,
    contactedWho: null,
    contactedSpoke: null,
    contactSummary: 'LEFT VOICEMAIL',
    author: 'Dana',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  });

  it('an entry saved without a contact shows its summary alone — nothing is backfilled', () => {
    expect(caseLogEntryDisplay(contact({}))).toEqual({ headline: null, body: 'LEFT VOICEMAIL' });
  });

  it('a named contact, with or without the retired "spoke with"', () => {
    expect(caseLogEntryDisplay(contact({ contactedWho: 'HOSPICE' })).headline).toBe('Called HOSPICE');
    expect(caseLogEntryDisplay(contact({ contactedWho: 'HOSPICE', contactedSpoke: 'Nurse Adams' })).headline).toBe('Called HOSPICE — spoke with Nurse Adams');
  });
});
