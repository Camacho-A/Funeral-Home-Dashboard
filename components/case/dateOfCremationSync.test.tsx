import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import type { Case, CaseUpdate } from '@/types/case';

/**
 * Date of Cremation (2026-10): Case Information and the Schedule tab edit
 * ONE case field. This harness holds one case and hands the same patch
 * function to both, exactly as the page's single case query does.
 */
const { applyPatch } = vi.hoisted(() => ({ applyPatch: { current: null as unknown as (patch: CaseUpdate) => void } }));
vi.mock('@/hooks/useCaseMutations', () => ({ useCaseMutations: () => ({ updateCaseInfo: (patch: CaseUpdate) => applyPatch.current(patch), isPending: false }) }));
vi.mock('@/hooks/useCremainsPickup', () => ({
  useCreateExpectedPickup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateExpectedPickupDate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { CaseInformationCard } = await import('./CaseInformationCard');
const { CremainsPickupSection } = await import('./CremainsPickupSection');

function Harness({ initial }: { initial: Case }) {
  const [case_, setCase] = useState(initial);
  applyPatch.current = (patch) => setCase((current) => ({ ...current, ...patch }));
  return (
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <div data-testid="info">
          <CaseInformationCard
            {...({} as Parameters<typeof CaseInformationCard>[0])}
            dateOfBirth={case_.dateOfBirth}
            dateOfDeath={case_.dateOfDeath}
            timeOfDeath=""
            placeOfDeath=""
            weight=""
            weightOver200={false}
            nextOfKinName=""
            nextOfKinPhone=""
            tagNumber={case_.tagNumber}
            paymentStatus="awaiting_payment"
            pickupStatus="awaiting_pickup"
            returnMethod="undecided"
            staffOptions={[]}
            showOwner={false}
            vaSteps={[]}
            showDateOfCremation
            dateOfCremation={case_.dateOfCremation ?? null}
            onUpdateCaseInfo={(patch) => applyPatch.current(patch)}
          />
        </div>
        <div data-testid="schedule">
          <CremainsPickupSection caseId={case_.id} organizationId={DEFAULT_ORGANIZATION_ID} appointments={[]} case_={case_} canSchedule organizationTimezone="America/New_York" />
        </div>
      </OrganizationProvider>
    </QueryClientProvider>
  );
}

describe('Date of Cremation — Case Information and the Schedule tab stay in sync', () => {
  const base: Case = { ...caseFixtures.find((c) => c.id === '1044')!, dateOfDeath: '07/09/2026', dateOfCremation: null, cremainsReceivedAt: null, isDeleted: false };
  const scheduleValue = () => within(screen.getByTestId('schedule')).getByText('Date of Cremation').closest('div')!.parentElement!.querySelector('dd');
  const infoField = () => within(within(screen.getByTestId('info')).getByText('Date of Cremation').parentElement!);

  it('an edit on Case Information shows on the Schedule tab; Date Received and Expected Pickup are untouched', () => {
    render(<Harness initial={base} />);
    expect(scheduleValue()).toHaveTextContent('Not recorded');
    fireEvent.click(infoField().getByRole('button'));
    const input = infoField().getByDisplayValue('');
    fireEvent.change(input, { target: { value: '07/15/2026' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(scheduleValue()).toHaveTextContent('Wednesday, July 15, 2026');
    expect(within(screen.getByTestId('schedule')).getByText('Date Received').closest('div')!.parentElement!.querySelector('dd')).toHaveTextContent('Not yet received');
  });

  it('an edit on the Schedule tab shows on Case Information', () => {
    render(<Harness initial={{ ...base, dateOfCremation: '07/15/2026' }} />);
    fireEvent.click(within(screen.getByTestId('schedule')).getByRole('button', { name: 'Edit date of cremation' }));
    fireEvent.change(screen.getByLabelText('Date of cremation'), { target: { value: '2026-07-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Date' }));
    expect(infoField().getByRole('button', { name: '07/16/2026' })).toBeInTheDocument();
  });
});
