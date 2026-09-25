import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseFormsSection } from './CaseFormsSection';
import { OrganizationProvider } from '@/hooks/useOrganization';

/**
 * Case repair UI (2026-09) — "Retry Jotform PDF." Covers the checkpoint's
 * TESTS items G-O. `preservePdfForSubmission` and the retry-pdf route are
 * already exhaustively tested elsewhere (services/externalFormPdfService.test.ts,
 * the retry-pdf route's own test file) — these tests cover only the UI
 * wrapper: visibility, wiring, labels, and refresh behavior.
 */

function arrangementRow(overrides: Record<string, unknown> = {}) {
  return {
    config: { id: 'config-arrangement', label: 'Arrangement Forms', audience: 'staff' },
    status: 'received',
    sentAt: '2026-01-01T00:00:00.000Z',
    submissionId: 'sub-arrangement-1',
    pdfStatus: 'failed',
    documentId: null,
    ...overrides,
  };
}

function vitalRow(overrides: Record<string, unknown> = {}) {
  return {
    config: { id: 'config-vital', label: 'Vital Statistics', audience: 'family' },
    status: 'received',
    sentAt: '2026-01-01T00:00:00.000Z',
    submissionId: 'sub-vital-1',
    pdfStatus: 'stored',
    documentId: 'doc-vital-1',
    ...overrides,
  };
}

function mockFetchFor(options: { forms: unknown[]; retryStatus?: number; retryBody?: Record<string, unknown> }) {
  const { forms, retryStatus = 200, retryBody = { submissionId: 'sub-arrangement-1', caseId: 'case-1', pdf: { outcome: 'stored', documentId: 'doc-new' } } } = options;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/forms?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ forms }) });
    }
    if (url.includes('/retry-pdf') && init?.method === 'POST') {
      return Promise.resolve({ ok: retryStatus < 400, status: retryStatus, json: async () => retryBody });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function renderSection(caseId = 'case-1') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <CaseFormsSection caseId={caseId} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('CaseFormsSection — Retry Jotform PDF (case repair UI, 2026-09)', () => {
  it('G: a linked submission with a failed PDF shows Retry Jotform PDF', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ forms: [arrangementRow()] }));
    renderSection();
    expect(await screen.findByRole('button', { name: 'Retry Jotform PDF' })).toBeInTheDocument();
  });

  it('H: a submission whose PDF is already successfully stored does not show retry', async () => {
    const fetchMock = mockFetchFor({ forms: [vitalRow()] });
    vi.stubGlobal('fetch', fetchMock);
    renderSection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Retry Jotform PDF' })).not.toBeInTheDocument();
  });

  it('a form with no linked submission at all does not show retry', async () => {
    const fetchMock = mockFetchFor({ forms: [{ config: { id: 'config-vital', label: 'Vital Statistics', audience: 'family' }, status: 'not_sent', sentAt: null, submissionId: null, pdfStatus: null, documentId: null }] });
    vi.stubGlobal('fetch', fetchMock);
    renderSection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Retry Jotform PDF' })).not.toBeInTheDocument();
  });

  it('L/M: Arrangement Forms and Vital Statistics labels are correct, never raw form/submission ids', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ forms: [arrangementRow(), vitalRow()] }));
    renderSection();
    expect(await screen.findByText('Arrangement Forms')).toBeInTheDocument();
    expect(screen.getByText('Vital Statistics')).toBeInTheDocument();
    expect(screen.queryByText('sub-arrangement-1')).not.toBeInTheDocument();
    expect(screen.queryByText('sub-vital-1')).not.toBeInTheDocument();
    expect(screen.queryByText('config-arrangement')).not.toBeInTheDocument();
  });

  it('N: Cremation Authorization is never referenced anywhere in this section', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ forms: [arrangementRow(), vitalRow()] }));
    renderSection();
    await screen.findByText('Arrangement Forms');
    expect(screen.queryByText('Cremation Authorization')).not.toBeInTheDocument();
  });

  it('I/J/C: retry uses the existing submission id internally (never asks the user for one) and refreshes Forms on success', async () => {
    const fetchMock = mockFetchFor({ forms: [arrangementRow()], retryBody: { submissionId: 'sub-arrangement-1', caseId: 'case-1', pdf: { outcome: 'stored', documentId: 'doc-new' } } });
    vi.stubGlobal('fetch', fetchMock);
    renderSection('case-1');

    // No submission-id input field exists anywhere in this component.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Jotform PDF' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    const retryCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/retry-pdf'));
      if (!call) throw new Error('not called yet');
      return call;
    });
    expect(retryCall[0]).toContain('/api/external-form-submissions/sub-arrangement-1/retry-pdf');

    expect(await screen.findByText('Document retrieved successfully.')).toBeInTheDocument();
    // Forms re-fetched after success (initial GET + refetch after invalidation).
    const formsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/forms?'));
    expect(formsCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('K: a failed retry shows sanitized feedback, never a raw error object', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchFor({ forms: [arrangementRow()], retryStatus: 500, retryBody: { error: 'PDF preservation failed unexpectedly.' } }),
    );
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Jotform PDF' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('PDF preservation failed unexpectedly.')).toBeInTheDocument();
  });

  it('O: rendering never issues a retry POST — no duplicate-triggering side effect merely from mounting', async () => {
    const fetchMock = mockFetchFor({ forms: [arrangementRow()] });
    vi.stubGlobal('fetch', fetchMock);
    renderSection();
    await screen.findByRole('button', { name: 'Retry Jotform PDF' });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/retry-pdf'))).toBe(false);
  });
});
