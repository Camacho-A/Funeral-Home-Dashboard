import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

function renderPanel(case_: Case = base) {
  const sla = evaluateCaseSla(case_, normalizeSlaSettings({}, true), '2026-10-20T15:00:00.000Z');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CaseSlaPanel case_={case_} sla={sla} />
    </QueryClientProvider>,
  );
}

describe('CaseSlaPanel', () => {
  it('is collapsed until opened; then only what needs attention is a card, and the rest is one line each (2026-11)', () => {
    renderPanel();
    expect(screen.queryByText('Hard Save')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    expect(screen.getByText('Hard Save')).toBeInTheDocument();
    expect(screen.getByText('Due Today')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((li) => li.className.includes('milestone'))).toHaveLength(1);
    expect(screen.getByText(/✓ Done:/).parentElement).toHaveTextContent('Doctor attestation (Oct 20, 2026, 9:00 AM)');
    expect(screen.queryByText(/Called twice/)).not.toBeInTheDocument();
    expect(screen.getByText(/Later:/).parentElement).toHaveTextContent('State approval');
    expect(screen.queryByText('Recorded times', { selector: 'h4' })).not.toBeInTheDocument();
  });

  it('is read-only (2026-11): nothing to record — no times, no delays, no forms', () => {
    const existing: Case = { ...caseFixtures.find((c) => c.id === '1042')!, rawStage: 3, checklistState: {}, slaEvents: undefined, slaDelays: undefined };
    for (const case_ of [base, existing]) {
      const { unmount, container } = renderPanel(case_);
      fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Recorded times' }));
      for (const name of ['Record', 'Record start', 'Record completion', 'Record delay', 'Save delay', 'Resolve']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(container.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
      unmount();
    }
  });

  it('a case that started before SOLIS kept the time says so, without asking for anything', () => {
    const existing: Case = { ...caseFixtures.find((c) => c.id === '1042')!, rawStage: 3, checklistState: {}, slaEvents: undefined, slaDelays: undefined };
    renderPanel(existing);
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    expect(screen.getAllByText('Start Unknown').length).toBeGreaterThan(0);
  });

  it('an open delay keeps its milestone as a card, with its history', () => {
    renderPanel({ ...base, slaDelays: { d1: { ...base.slaDelays!.d1, milestone: 'hard_save', resolvedAt: null, resolvedBy: null, resolution: null } } } as Case);
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    expect(screen.getByText(/Called twice/)).toBeInTheDocument();
  });

  it('lists the recorded times with where they came from — never rows of "time not recorded"', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /SLA details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Recorded times' }));
    const timeline = screen.getByText('Recorded times', { selector: 'h4' }).parentElement!;
    expect(timeline).toHaveTextContent('Doctor attestation received');
    expect(timeline).not.toHaveTextContent('Time not recorded');
    expect(timeline).not.toHaveTextContent('implied — time not recorded');
  });
});
