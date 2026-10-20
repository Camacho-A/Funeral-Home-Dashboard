import { describe, expect, it } from 'vitest';
import { caseLogEntryProblem } from './caseLogDisplay';

describe('caseLogEntryProblem', () => {
  it('requires note text', () => {
    expect(caseLogEntryProblem({ type: 'note', text: ' ' })).not.toBeNull();
    expect(caseLogEntryProblem({ type: 'note', text: 'x' })).toBeNull();
  });

  it('requires who was contacted and a summary for a call', () => {
    expect(caseLogEntryProblem({ type: 'contact', contactSummary: 'x' })).toMatch(/who was contacted/);
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME' })).toMatch(/summary/);
    expect(caseLogEntryProblem({ type: 'contact', contactedWho: 'ME', contactSummary: 'Released' })).toBeNull();
  });
});
