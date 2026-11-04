import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CaseFaxHistoryEntry } from '@/lib/faxBundlesClient';

const client = vi.hoisted(() => ({ fetchCaseFaxHistory: vi.fn(), recordFaxOutcome: vi.fn() }));
vi.mock('@/lib/faxBundlesClient', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/faxBundlesClient')>()), ...client }));
const { CaseFaxStatus } = await import('./CaseFaxStatus');

const entry = (overrides: Partial<CaseFaxHistoryEntry> = {}): CaseFaxHistoryEntry => ({
  bundleId: 'fxb-1', reference: 'DC-7Q4K9M', state: 'submitted', stateLabel: 'Submitted to NuSo', position: 2, applicationCount: 3, documentVersion: 1,
  submittedAt: '2026-11-04T15:00:00.000Z', deliveredAt: null, failureMessage: null, ...overrides,
});
const renderStatus = (canRecordOutcome: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CaseFaxStatus organizationId="managed-cremations" caseId="case-1" canRecordOutcome={canRecordOutcome} />
    </QueryClientProvider>,
  );

beforeEach(() => vi.clearAllMocks());

describe('CaseFaxStatus', () => {
  it('shows nothing for a case never faxed', async () => {
    client.fetchCaseFaxHistory.mockResolvedValue([]);
    const { container } = renderStatus(true);
    await waitFor(() => expect(client.fetchCaseFaxHistory).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('names the bundle and the case\'s place in it; earlier bundles are in History', async () => {
    client.fetchCaseFaxHistory.mockResolvedValue([entry(), entry({ bundleId: 'fxb-0', reference: 'DC-AAAAAA', state: 'failed', stateLabel: 'Failed', position: 1, applicationCount: 1 })]);
    renderStatus(false);
    expect(await screen.findByText('Submitted to NuSo')).toBeTruthy();
    expect(screen.getByText(/DC-7Q4K9M · application 2 of 3 · sent/)).toBeTruthy();
    expect(screen.getByText('History (1)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record delivery result' })).toBeNull();
  });

  it('an Administrator or Manager records the result — delivered, with the time it happened', async () => {
    client.fetchCaseFaxHistory.mockResolvedValue([entry()]);
    client.recordFaxOutcome.mockResolvedValue({ bundle: { items: [{ caseId: 'case-1' }] }, checklistFailed: [] });
    renderStatus(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Record delivery result' }));
    fireEvent.change(screen.getByLabelText('NuSo reference (optional)'), { target: { value: 'NS-12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delivered' }));
    await waitFor(() => expect(client.recordFaxOutcome).toHaveBeenCalledWith('managed-cremations', 'fxb-1', expect.objectContaining({ decision: 'delivered', nusoReference: 'NS-12345', deliveredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })));
  });

  it('needs review: says it is never resent automatically', async () => {
    client.fetchCaseFaxHistory.mockResolvedValue([entry({ state: 'needs_review', stateLabel: 'Delivery Unknown / Needs Review' })]);
    renderStatus(true);
    expect(await screen.findByText(/never sent again automatically/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record delivery result' })).toBeTruthy();
  });
});
