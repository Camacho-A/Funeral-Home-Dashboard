import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsAttentionPanel, type NeedsAttentionCase } from './NeedsAttentionPanel';

const item: NeedsAttentionCase = {
  id: '1042',
  caseNumber: 'B2026-001',
  decedentName: 'Robert Ellison',
  attentionReason: 'Payment overdue',
  daysWaitingInStage: 4,
  slaTargetLabel: '2 days',
};

/**
 * Task #2 (2026-09) — Case Number moved beneath the decedent name. No
 * dedicated test file existed for this component before; added here
 * alongside the layout-hierarchy assertions this checkpoint requires.
 */
describe('NeedsAttentionPanel — Case Number moved beneath decedent name (Task #2, 2026-09)', () => {
  it('1/2. renders both the decedent name and the Case Number', () => {
    const { container } = render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.getByText('Robert Ellison')).toBeInTheDocument();
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('3. the Case Number sits immediately beneath the name — a sibling, not nested inside the name element — and follows it in DOM order', () => {
    const { container } = render(<NeedsAttentionPanel cases={[item]} />);
    const nameEl = container.querySelector('[class*="name"]')!;
    const caseNumberEl = container.querySelector('[class*="caseNumber"]')!;
    expect(nameEl.textContent).toBe('Robert Ellison');
    expect(nameEl.contains(caseNumberEl)).toBe(false);
    expect(nameEl.compareDocumentPosition(caseNumberEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nameEl.nextElementSibling).toBe(caseNumberEl);
  });

  it('5. the Case Number value itself is unchanged', () => {
    const { container } = render(<NeedsAttentionPanel cases={[item]} />);
    expect(container.querySelector('[class*="caseNumber"]')?.textContent).toBe('#B2026-001');
  });

  it('6. card navigation is unchanged — still links to the case by internal id', () => {
    render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cases/1042');
  });

  it('7. the attention reason (remaining case-card information) stays present', () => {
    render(<NeedsAttentionPanel cases={[item]} />);
    expect(screen.getByText('Payment overdue')).toBeInTheDocument();
  });

  it('8. no duplicate Case Number is introduced', () => {
    const { container } = render(<NeedsAttentionPanel cases={[item]} />);
    expect(container.querySelectorAll('[class*="caseNumber"]')).toHaveLength(1);
  });
});
