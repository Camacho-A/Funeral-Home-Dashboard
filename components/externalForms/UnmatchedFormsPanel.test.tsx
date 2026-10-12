import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UnmatchedFormsPanel } from './UnmatchedFormsPanel';

/**
 * Unmatched Forms — identifiable rows (2026-10).
 *
 * Root cause these pin down: a row rendered ONLY the provider's numeric
 * form id and a timestamp, with no decedent name anywhere. ROSELYN COLON's
 * submission was listed correctly the whole time — staff simply could not
 * tell which submission was which, and reported her as missing. A failed
 * load additionally rendered as the empty state, so a real failure was
 * indistinguishable from an empty queue.
 */

vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organizationId: 'managed-cremations' }) }));
vi.mock('@/hooks/useCases', () => ({ useCases: () => ({ data: [] }) }));
vi.mock('./CreateCaseFromSubmissionDialog', () => ({ CreateCaseFromSubmissionDialog: () => null }));

const submissionsQuery = vi.fn();
const configsQuery = vi.fn();
vi.mock('@/hooks/useExternalForms', () => ({
  useUnmatchedSubmissions: () => submissionsQuery(),
  useExternalFormConfigs: () => configsQuery(),
  useLinkSubmissionToCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Roselyn's real production submission, field for field. */
const ROSELYN = {
  id: 'managed-cremations-jotform-6674600018717643738',
  organizationId: 'managed-cremations',
  provider: 'jotform',
  externalFormId: '261945978664175',
  externalSubmissionId: '6674600018717643738',
  caseFormLinkId: null,
  status: 'unmatched' as const,
  mappedFields: JSON.stringify({
    decedentName: 'ROSELYN COLON',
    dateOfBirth: '05/26/1977',
    dateOfDeath: '10/07/2026',
    placeOfDeath: 'MEDICAL EXAMINERS DEPT',
  }),
  receivedAt: '2026-10-10T16:46:49.760Z',
  reviewedAt: null,
  reviewedBy: null,
  documentId: null,
  pdfStatus: 'stored' as const,
  pdfFailureReason: null,
  createdCaseId: null,
  caseCreationFailureReason: null,
  createdAt: '2026-10-10T16:46:49.760Z',
  updatedAt: '2026-10-10T16:46:49.760Z',
};

const CONFIGS = [
  { id: 'cfg-arr', label: 'Manors Cremation Arrangement Forms', audience: 'staff' as const, externalFormId: '261945978664175' },
];

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnmatchedFormsPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  submissionsQuery.mockReset().mockReturnValue({ data: [ROSELYN], isPending: false, isError: false });
  configsQuery.mockReset().mockReturnValue({ data: CONFIGS });
});

describe('UnmatchedFormsPanel — a row identifies itself', () => {
  it('leads with the decedent name, so staff can find a specific person', () => {
    renderPanel();
    expect(screen.getByText('ROSELYN COLON')).toBeInTheDocument();
  });

  it('shows the date of death and the form’s human name, not a raw provider id', () => {
    renderPanel();
    expect(screen.getByText('Date of death 10/07/2026')).toBeInTheDocument();
    expect(screen.getByText('Manors Cremation Arrangement Forms')).toBeInTheDocument();
    // The bare numeric id is no longer the row's identity.
    expect(screen.queryByText('261945978664175')).not.toBeInTheDocument();
  });

  it('still shows the submission id, for support and cross-referencing', () => {
    renderPanel();
    expect(screen.getByText('Submission 6674600018717643738')).toBeInTheDocument();
  });

  it('offers both Create Case and linking to an existing case', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Create Case' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search existing SOLIS case' })).toBeInTheDocument();
  });

  it('falls back to the provider id when the form config is unavailable', () => {
    configsQuery.mockReturnValue({ data: [] });
    renderPanel();
    // Better a raw id than nothing — the row stays identifiable by name.
    expect(screen.getByText('261945978664175')).toBeInTheDocument();
    expect(screen.getByText('ROSELYN COLON')).toBeInTheDocument();
  });

  it('says so rather than rendering blank when a submission carries no name', () => {
    submissionsQuery.mockReturnValue({
      data: [{ ...ROSELYN, mappedFields: '{}' }],
      isPending: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('No name on this submission')).toBeInTheDocument();
  });

  it('survives a malformed mappedFields value instead of breaking the list', () => {
    submissionsQuery.mockReturnValue({
      data: [{ ...ROSELYN, mappedFields: 'not json at all' }],
      isPending: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('No name on this submission')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Case' })).toBeInTheDocument();
  });

  it('omits the date of death line when the submission did not carry one', () => {
    submissionsQuery.mockReturnValue({
      data: [{ ...ROSELYN, mappedFields: JSON.stringify({ decedentName: 'ROSELYN COLON' }) }],
      isPending: false,
      isError: false,
    });
    renderPanel();
    expect(screen.queryByText(/Date of death/)).not.toBeInTheDocument();
  });
});

describe('UnmatchedFormsPanel — explains why automatic creation did not run', () => {
  function withReason(reason: string) {
    submissionsQuery.mockReturnValue({
      data: [{ ...ROSELYN, caseCreationFailureReason: reason }],
      isPending: false,
      isError: false,
    });
  }

  it('says nothing when there is no recorded failure', () => {
    renderPanel();
    expect(screen.queryByText(/Automatic case creation did not run/)).not.toBeInTheDocument();
  });

  it('names the missing fields, in words a funeral director can act on', () => {
    withReason('missing_required_fields:nextOfKinName,nextOfKinPhone');
    renderPanel();
    expect(screen.getByText(/Automatic case creation did not run/)).toBeInTheDocument();
    expect(screen.getByText(/nextOfKinName, nextOfKinPhone/)).toBeInTheDocument();
  });

  it('explains a suspected duplicate without implying anything was merged', () => {
    withReason('duplicate_review_required');
    renderPanel();
    expect(screen.getByText(/nothing was created and nothing was merged/)).toBeInTheDocument();
  });

  it('shows an unrecognised reason verbatim rather than hiding it', () => {
    // An unexplained row is the exact problem this solves — an unfamiliar
    // code is still better than silence.
    withReason('some_future_reason_code');
    renderPanel();
    expect(screen.getByText(/some_future_reason_code/)).toBeInTheDocument();
  });
});

describe('UnmatchedFormsPanel — a failure is never shown as an empty queue', () => {
  it('reports a load failure distinctly, with a way to retry', () => {
    const refetch = vi.fn();
    submissionsQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('Not authorized to view unmatched forms for this organization.'),
      refetch,
    });
    renderPanel();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('this list may be incomplete');
    expect(alert).toHaveTextContent('Not authorized to view unmatched forms');
    // Crucially NOT the reassuring empty state.
    expect(screen.queryByText('No unmatched form submissions.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the empty state only when the queue is genuinely empty', () => {
    submissionsQuery.mockReturnValue({ data: [], isPending: false, isError: false });
    renderPanel();
    expect(screen.getByText('No unmatched form submissions.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
