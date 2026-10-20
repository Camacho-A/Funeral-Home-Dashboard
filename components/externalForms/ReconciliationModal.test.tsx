import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { classifyReconciliationRow } from '@/domain/externalForms/reconciliation';
import { ReconciliationModal } from './ReconciliationModal';

/**
 * A form that disagrees with its case must say so in words when staff open
 * the review (2026-10) — an Arrangement attached automatically to its First
 * Call case can carry a different date of birth (B2026-041), and amber text
 * under a raw field key was easy to miss.
 */
const rows = [
  classifyReconciliationRow('decedentName', 'MARGARET OKONKWO', 'MARGARET OKONKWO'),
  classifyReconciliationRow('dateOfBirth', '03/14/1951', '03/14/1858'),
  classifyReconciliationRow('nextOfKinEmail', null, 'daniel@example.test'),
];

vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organizationId: 'org-1' }) }));
// Stable objects, as React Query returns: the modal re-selects rows whenever
// `query.data` changes identity.
const { reconciliation, apply } = vi.hoisted(() => ({
  reconciliation: { isPending: false, data: undefined as unknown },
  apply: { mutateAsync: () => Promise.resolve(), isPending: false, error: null },
}));
reconciliation.data = { rows, caseRevision: 3 };
vi.mock('@/hooks/useExternalForms', () => ({
  useReconciliation: () => reconciliation,
  useApplyReconciliation: () => apply,
}));

describe('ReconciliationModal — a disagreement with the case is stated plainly', () => {
  it('names the differing field in a banner and marks its row', () => {
    render(<ReconciliationModal submissionId="s1" caseId="c1" onClose={() => {}} />);

    expect(screen.getByRole('status')).toHaveTextContent('This form disagrees with the case on: Date of birth.');
    expect(screen.getByText('Differs from case')).toBeInTheDocument();
    expect(screen.getByText('Date of birth')).toBeInTheDocument();
  });

  it('never pre-selects the conflicting value; only the empty field is pre-selected', () => {
    render(<ReconciliationModal submissionId="s1" caseId="c1" onClose={() => {}} />);

    expect(screen.getByLabelText('Apply dateOfBirth')).not.toBeChecked();
    expect(screen.getByLabelText('Apply nextOfKinEmail')).toBeChecked();
  });
});
