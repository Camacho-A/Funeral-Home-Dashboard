import { describe, expect, it } from 'vitest';
import { caseLogEntryProblem } from './caseLogDisplay';

describe('caseLogEntryProblem', () => {
  it('requires note text', () => {
    expect(caseLogEntryProblem({ type: 'note', text: ' ' })).not.toBeNull();
    expect(caseLogEntryProblem({ type: 'note', text: 'x' })).toBeNull();
  });

  it('requires a summary for a call or activity, but not a contact name', () => {
    expect(caseLogEntryProblem({ type: 'contact', contactSummary: 'Left voicemail' })).toBeNull();
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME' })).toMatch(/summary/i);
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME', contactSummary: ' ' })).toMatch(/summary/i);
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME', contactSummary: 'Released' })).toBeNull();
  });
});
