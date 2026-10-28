import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CaseSsnBackfillPanel } from './CaseSsnBackfillPanel';

/** Case SSN fill panel (2026-10): preview first; Fill only after a preview that found cases. */
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organizationId: 'managed-cremations' }) }));
const client = vi.hoisted(() => ({ runCaseSsnBackfill: vi.fn() }));
vi.mock('@/lib/caseSsnClient', () => client);

beforeEach(() => client.runCaseSsnBackfill.mockReset());

describe('CaseSsnBackfillPanel', () => {
  it('Fill is disabled until a preview finds cases; then it shows only case numbers and results', async () => {
    client.runCaseSsnBackfill.mockResolvedValueOnce({
      dryRun: true,
      checked: 3,
      counts: { would_save: 2, saved: 0, already_on_file: 0, none_found: 1 },
      cases: [
        { caseNumber: 'B2026-901', outcome: 'would_save' },
        { caseNumber: 'B2026-902', outcome: 'would_save' },
        { caseNumber: 'B2026-903', outcome: 'none_found' },
      ],
    });
    render(<CaseSsnBackfillPanel />);
    expect((screen.getByRole('button', { name: 'Fill now' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/3 active cases checked/)).toBeTruthy();
    expect(client.runCaseSsnBackfill).toHaveBeenCalledWith('managed-cremations', true);
    expect(screen.getAllByText('Will be saved')).toHaveLength(2);
    const fill = screen.getByRole('button', { name: 'Fill now (2)' }) as HTMLButtonElement;
    expect(fill.disabled).toBe(false);

    client.runCaseSsnBackfill.mockResolvedValueOnce({ dryRun: false, checked: 3, counts: { would_save: 0, saved: 2, already_on_file: 0, none_found: 1 }, cases: [] });
    fireEvent.click(fill);
    expect(await screen.findByText(/2 saved/)).toBeTruthy();
    expect(client.runCaseSsnBackfill).toHaveBeenLastCalledWith('managed-cremations', false);
  });
});
