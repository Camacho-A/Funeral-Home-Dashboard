import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateCaseFromSubmissionDialog } from './CreateCaseFromSubmissionDialog';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const preview = vi.fn();
const createCase = vi.fn();
vi.mock('@/lib/externalFormsClient', () => ({
  fetchCreateCasePreview: (...args: unknown[]) => preview(...args),
  createCaseFromSubmission: (...args: unknown[]) => createCase(...args),
}));

const BASE_PREVIEW = {
  formLabel: 'Manors Cremation Arrangement Forms',
  receivedAt: '2026-10-10T16:46:49.830Z',
  decedentName: 'ROSELYN COLON',
  dateOfDeath: '10/07/2026',
  dateOfBirth: '01/02/1948',
  nextOfKinName: 'ANA COLON',
  duplicateCandidates: [] as { caseId: string; caseNumber: string; decedentName: string; matchedOn: string[] }[],
};

function renderDialog(submissionId: string | null = 'sub-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateCaseFromSubmissionDialog organizationId="managed-cremations" submissionId={submissionId} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pushMock.mockReset();
  preview.mockReset().mockResolvedValue(BASE_PREVIEW);
  createCase.mockReset().mockResolvedValue({ case: { id: 'case-new', caseNumber: 'B2026-037' } });
});

describe('CreateCaseFromSubmissionDialog', () => {
  it('asks the confirmation question and shows what the case will be created from', async () => {
    renderDialog();

    expect(
      await screen.findByText('Create a new SOLIS case using the information from this JotForm submission?'),
    ).toBeInTheDocument();
    expect(screen.getByText('ROSELYN COLON')).toBeInTheDocument();
    expect(screen.getByText('10/07/2026')).toBeInTheDocument();
    expect(screen.getByText('Manors Cremation Arrangement Forms')).toBeInTheDocument();
    expect(screen.getByText('Date of death')).toBeInTheDocument();
  });

  it('omits the date of death row entirely when the submission did not carry one', async () => {
    preview.mockResolvedValue({ ...BASE_PREVIEW, dateOfDeath: null });
    renderDialog();

    await screen.findByText('ROSELYN COLON');
    expect(screen.queryByText('Date of death')).not.toBeInTheDocument();
  });

  it('says so rather than inventing a name when none was provided', async () => {
    preview.mockResolvedValue({ ...BASE_PREVIEW, decedentName: null });
    renderDialog();
    expect(await screen.findByText('Not provided')).toBeInTheDocument();
  });

  it('creates the case and opens it', async () => {
    renderDialog();
    // Wait for the preview to land — the action stays disabled until it
    // does, so clicking earlier would be a no-op.
    await screen.findByText('ROSELYN COLON');
    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    await waitFor(() => expect(createCase).toHaveBeenCalledWith('managed-cremations', 'sub-1', false));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/cases/case-new'));
  });

  it('blocks creation while duplicate candidates are unreviewed', async () => {
    preview.mockResolvedValue({
      ...BASE_PREVIEW,
      duplicateCandidates: [
        { caseId: 'c1', caseNumber: 'B2026-555', decedentName: 'ROSELYN COLON', matchedOn: ['dateOfDeath'] },
      ],
    });
    renderDialog();

    expect(await screen.findByText('A similar case already exists')).toBeInTheDocument();
    expect(screen.getByText('B2026-555')).toBeInTheDocument();
    expect(screen.getByText(/same dateOfDeath/)).toBeInTheDocument();
    // The primary action is unavailable until a human confirms.
    expect(screen.getByRole('button', { name: 'Create Case' })).toBeDisabled();
    expect(createCase).not.toHaveBeenCalled();
  });

  it('points staff at linking instead, which is usually the right answer', async () => {
    preview.mockResolvedValue({
      ...BASE_PREVIEW,
      duplicateCandidates: [
        { caseId: 'c1', caseNumber: 'B2026-555', decedentName: 'ROSELYN COLON', matchedOn: ['dateOfDeath'] },
      ],
    });
    renderDialog();
    expect(await screen.findByText(/Search existing SOLIS case/)).toBeInTheDocument();
  });

  it('allows creation once the candidates are acknowledged, and says so to the server', async () => {
    preview.mockResolvedValue({
      ...BASE_PREVIEW,
      duplicateCandidates: [
        { caseId: 'c1', caseNumber: 'B2026-555', decedentName: 'ROSELYN COLON', matchedOn: ['dateOfDeath'] },
      ],
    });
    renderDialog();

    await screen.findByText('A similar case already exists');
    fireEvent.click(screen.getByRole('checkbox'));
    const create = screen.getByRole('button', { name: 'Create Case' });
    expect(create).toBeEnabled();

    fireEvent.click(create);
    await waitFor(() => expect(createCase).toHaveBeenCalledWith('managed-cremations', 'sub-1', true));
  });

  it('surfaces a server refusal instead of failing silently', async () => {
    createCase.mockRejectedValue(new Error('This submission is already linked to a case.'));
    renderDialog();
    await screen.findByText('ROSELYN COLON');
    fireEvent.click(screen.getByRole('button', { name: 'Create Case' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This submission is already linked to a case.');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces an ineligible submission and offers no create action', async () => {
    preview.mockRejectedValue(new Error('Manors Cremation Arrangement Forms is not configured to create cases.'));
    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent('is not configured to create cases');
    expect(screen.getByRole('button', { name: 'Create Case' })).toBeDisabled();
  });

  it('fetches nothing until a submission is actually chosen', () => {
    renderDialog(null);
    expect(preview).not.toHaveBeenCalled();
  });
});
