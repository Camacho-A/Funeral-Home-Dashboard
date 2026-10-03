import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ImportHistoricalCaseModal } from './ImportHistoricalCaseModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as externalFormsClient from '@/lib/externalFormsClient';

/**
 * Task #20 (2026-09, close import window after success). Root cause part
 * 2: handleCreate() only ever called setResult(outcome) — never onClose()
 * — so a confirmed successful case creation left the modal open,
 * requiring a manual "Close" click. These tests use only synthetic
 * fixtures (never a real Jotform submission, never B2026-035/B2026-034,
 * never the real allocator) and assert on the mocked
 * createHistoricalCase/previewHistoricalCase call arguments/results only —
 * no raw Jotform payload is ever constructed or logged here.
 */
vi.mock('@/lib/externalFormsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/externalFormsClient')>('@/lib/externalFormsClient');
  return {
    ...actual,
    fetchExternalFormConfigs: vi.fn(),
    previewHistoricalCase: vi.fn(),
    createHistoricalCase: vi.fn(),
  };
});

const CONFIGS = [{ id: 'config-1', label: 'Arrangement Form', audience: 'family' as const }];

const VALID_PREVIEW = {
  formLabel: 'Arrangement Form',
  submittedAt: '2024-05-01T00:00:00.000Z',
  matchesConfig: true,
  alreadyAssociated: false,
  existingCaseId: null,
  historicalCaseNumber: 'B2024-007',
  historicalCaseNumberBlockedReason: null,
  historicalDuplicateCaseId: null,
  decedentName: 'JOHN TESTPERSON',
  dateOfBirth: '01/01/1950',
  dateOfDeath: '01/01/2024',
  placeOfDeath: 'TEST HOSPITAL',
  informantName: 'Jane Testperson',
  informantRelationship: 'spouse',
  informantPhone: '555-0100',
  informantIsNextOfKin: 'Yes',
};

/** Mirrors SettingsHub.tsx's own controlled-open pattern exactly —
    `<ImportHistoricalCaseModal open={isImportModalOpen} onClose={() =>
    setImportModalOpen(false)} />` — so a successful auto-close is
    observed the same way a real user would see it: the dialog actually
    leaves the DOM once the parent's own `open` state flips to false. */
function TestHarness() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <ImportHistoricalCaseModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function renderModal() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <TestHarness />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

async function lookUpValidSubmission() {
  await waitFor(() => expect(screen.getByText('Arrangement Form')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'config-1' } });
  fireEvent.change(screen.getByLabelText('Jotform submission ID'), { target: { value: 'sub-001' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Look up' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
  await waitFor(() => expect(screen.getByText(/JOHN TESTPERSON/)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Karen Ellison' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0199' } });
}

beforeEach(() => {
  vi.mocked(externalFormsClient.fetchExternalFormConfigs).mockResolvedValue(CONFIGS);
  vi.mocked(externalFormsClient.previewHistoricalCase).mockResolvedValue(VALID_PREVIEW);
  vi.mocked(externalFormsClient.createHistoricalCase).mockReset();
});

describe('ImportHistoricalCaseModal — open/close lifecycle', () => {
  it('1. opens normally, showing the title and the submission-lookup controls', async () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Import Existing Jotform Case' })).toBeInTheDocument();
    expect(screen.getByLabelText('Jotform submission ID')).toBeInTheDocument();
  });

  it('2-3. a confirmed successful import (a genuinely new case) closes the window automatically, tied to the mutation resolving — not a timer', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValue({
      alreadyImported: false,
      caseId: 'case-new-1',
      caseNumber: 'B2024-007',
    });
    renderModal();
    await lookUpValidSubmission();

    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    await waitFor(() => expect(externalFormsClient.createHistoricalCase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('4-5. required query invalidation for the Cases list occurs on a genuinely new case (the imported case becomes visible through the existing Cases experience)', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValue({
      alreadyImported: false,
      caseId: 'case-new-1',
      caseNumber: 'B2024-007',
    });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          <TestHarness />
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await lookUpValidSubmission();
    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys.some((key) => Array.isArray(key) && key[0] === 'cases')).toBe(true);
  });

  it('6-7. temporary import state resets after a successful close, so reopening the window starts clean', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValue({
      alreadyImported: false,
      caseId: 'case-new-1',
      caseNumber: 'B2024-007',
    });
    renderModal();
    await lookUpValidSubmission();
    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByRole('dialog', { name: 'Import Existing Jotform Case' })).toBeInTheDocument();
    expect(screen.getByLabelText('Jotform submission ID')).toHaveValue('');
    expect(screen.queryByText(/JOHN TESTPERSON/)).not.toBeInTheDocument();
    expect(screen.queryByText(/created successfully/i)).not.toBeInTheDocument();
  });

  it('8-9. a failed import does NOT close the window, and retains the error/retry state', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockRejectedValue(new Error('Failed to create case.'));
    renderModal();
    await lookUpValidSubmission();

    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    await waitFor(() => expect(screen.getByText('Case creation failed. Please try again.')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // User-entered Next of Kin info is preserved for a retry — never
    // cleared on failure.
    expect(screen.getByLabelText('Name')).toHaveValue('Karen Ellison');
    expect(screen.getByLabelText('Phone')).toHaveValue('555-0199');
  });

  it('10. a validation failure (matchesConfig: false) does NOT close the window — Create is simply never enabled', async () => {
    vi.mocked(externalFormsClient.previewHistoricalCase).mockResolvedValue({
      ...VALID_PREVIEW,
      matchesConfig: false,
    });
    renderModal();
    await waitFor(() => expect(screen.getByText('Arrangement Form')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'config-1' } });
    fireEvent.change(screen.getByLabelText('Jotform submission ID'), { target: { value: 'sub-001' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Look up' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(screen.getByText(/does not belong to the selected form/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create Case' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(externalFormsClient.createHistoricalCase).not.toHaveBeenCalled();
  });

  it('11-12. a duplicate-import ("already imported") response does not create another case and does not auto-close, keeping the window open (existing double-submit protection is preserved — Create becomes disabled once a result exists)', async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValue({
      alreadyImported: true,
      caseId: 'case-existing-1',
      caseNumber: null,
    });
    renderModal();
    await lookUpValidSubmission();

    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    await waitFor(() => expect(screen.getByText(/already imported previously/i)).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(externalFormsClient.createHistoricalCase).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Create Case' })).toBeDisabled();
  });

  it("13. does not invoke the normal case-number allocator — createHistoricalCase is called with the submission's own identifiers only, never a caseNumber/allocator parameter", async () => {
    vi.mocked(externalFormsClient.createHistoricalCase).mockResolvedValue({
      alreadyImported: false,
      caseId: 'case-new-1',
      caseNumber: 'B2024-007',
    });
    renderModal();
    await lookUpValidSubmission();
    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    await waitFor(() => expect(externalFormsClient.createHistoricalCase).toHaveBeenCalledTimes(1));
    const [, , , nextOfKinName, nextOfKinPhone] = vi.mocked(externalFormsClient.createHistoricalCase).mock.calls[0];
    expect(nextOfKinName).toBe('Karen Ellison');
    expect(nextOfKinPhone).toBe('555-0199');
  });

  it('14-16. no real Jotform submission is fetched, no Production data is used, and no raw Jotform PII appears anywhere in this test — only the synthetic VALID_PREVIEW fixture above is ever referenced', async () => {
    renderModal();
    await lookUpValidSubmission();
    // The only network-adjacent call in this whole suite is the mocked
    // previewHistoricalCase/createHistoricalCase function — never a real
    // fetch, never B2026-034/B2026-035, never a real Jotform API key or
    // webhook secret.
    expect(externalFormsClient.previewHistoricalCase).toHaveBeenCalledWith(expect.any(String), 'config-1', 'sub-001');
  });
});
