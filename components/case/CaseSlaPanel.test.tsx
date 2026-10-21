import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseSlaPanel } from './CaseSlaPanel';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { evaluateCaseSla } from '@/domain/sla/slaMilestones';
import { normalizeSlaSettings } from '@/domain/sla/slaSettings';
import type { Case } from '@/types/case';

const base: Case = {
  ...caseFixtures.find((c) => c.id === '1042')!,
  rawStage: 3,
  checklistState: {},
  slaEvents: { attestation_received: { at: '2026-10-20T13:00:00.000Z', recordedAt: 'x', recordedBy: 's', source: 'staff' } },
  slaDelays: {
    d1: { id: 'd1', milestone: 'doctor_attestation', reason: 'waiting_on_doctor', responsibleParty: 'doctor', notes: 'Called twice', expectedResolutionDate: null, recordedAt: '2026-10-16T13:00:00.000Z', recordedBy: 's', resolvedAt: '2026-10-19T13:00:00.000Z', resolvedBy: 's', resolution: 'resolved' },
  },
};

function renderPanel(case_: Case = base, canEdit = true) {
  const sla = evaluateCaseSla(case_, normalizeSlaSettings({}, true), '2026-10-20T15:00:00.000Z');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CaseSlaPanel case_={case_} sla={sla} organizationId="managed-cremations" canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CaseSlaPanel', () => {
  it('is collapsed until opened, then lists each milestone with its status and delay history', () => {
    renderPanel();
    expect(screen.queryByText('Hard Save')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    expect(screen.getByText('Hard Save')).toBeInTheDocument();
    expect(screen.getByText('Due Today')).toBeInTheDocument();
    expect(screen.getByText(/Called twice/)).toBeInTheDocument();
    expect(screen.getByText(/resolved/)).toBeInTheDocument();
  });

  it('records an event through the SLA route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ case: base, changed: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'hard_saved' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-10-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/cases/1042/sla');
    expect(JSON.parse(init.body as string)).toMatchObject({ organizationId: 'managed-cremations', action: 'record_event', event: 'hard_saved' });
  });

  it('records a delay on a milestone', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ case: base, changed: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Record delay' })[0]);
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Family traveling' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save delay' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ action: 'record_delay', notes: 'Family traveling' });
  });

  it('is read-only for staff who cannot edit the case, and for an archived case', () => {
    const { unmount } = renderPanel(base, false);
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record delay' })).not.toBeInTheDocument();
    unmount();
    renderPanel({ ...base, isDeleted: true }, true);
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });
});
