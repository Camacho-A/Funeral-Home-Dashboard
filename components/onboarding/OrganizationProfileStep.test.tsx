import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationProfileStep } from './OrganizationProfileStep';

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALID_FIELDS = {
  legalName: 'Test Org LLC',
  displayName: 'Test Org',
  primaryEmail: 'staff@testorg.test',
  primaryPhone: '(555) 000-0000',
  timezone: 'America/Chicago',
  defaultCurrency: 'usd',
};

function fillFields(container: HTMLElement) {
  const inputs = container.querySelectorAll('input');
  fireEvent.change(inputs[0], { target: { value: VALID_FIELDS.legalName } });
  fireEvent.change(inputs[1], { target: { value: VALID_FIELDS.displayName } });
  fireEvent.change(inputs[2], { target: { value: VALID_FIELDS.primaryEmail } });
  fireEvent.change(inputs[3], { target: { value: VALID_FIELDS.primaryPhone } });
  fireEvent.change(inputs[5], { target: { value: VALID_FIELDS.timezone } }); // index 4 is website
  fireEvent.change(inputs[6], { target: { value: VALID_FIELDS.defaultCurrency } });
}

describe('OrganizationProfileStep — bootstrap (no onboardingSessionId)', () => {
  it('calls /api/onboarding/start and reports the new session on success', async () => {
    const onStarted = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          organization: { id: 'org-1', name: 'Test Org', isActive: false, status: 'onboarding' },
          onboardingSession: { id: 'session-1', currentStep: 'organization_profile', completedSteps: [] },
          isNew: true,
        }),
      }),
    );

    const { container } = renderWithClient(
      <OrganizationProfileStep onboardingSessionId={null} organization={null} onStarted={onStarted} onSaved={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Start Onboarding' })).toBeInTheDocument();

    fillFields(container);
    fireEvent.click(screen.getByRole('button', { name: 'Start Onboarding' }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onStarted.mock.calls[0][0].onboardingSession.id).toBe('session-1');
  });

  it('surfaces a server-side error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Not authorized for this action.' }) }),
    );
    const { container } = renderWithClient(
      <OrganizationProfileStep onboardingSessionId={null} organization={null} onStarted={() => {}} onSaved={() => {}} />,
    );
    fillFields(container);
    fireEvent.click(screen.getByRole('button', { name: 'Start Onboarding' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized for this action.');
  });
});

describe('OrganizationProfileStep — resume (with onboardingSessionId)', () => {
  it('prefills from the current organization and PATCHes on save', async () => {
    const onSaved = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          organization: { id: 'org-1', name: 'Updated', isActive: false, status: 'onboarding' },
          onboardingSession: { id: 'session-1', currentStep: 'primary_location', completedSteps: ['organization_profile'] },
        }),
      }),
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationProfileStep
          onboardingSessionId="session-1"
          organization={{ id: 'org-1', name: 'Test Org', isActive: false, legalName: 'Test Org LLC', primaryEmail: 'staff@testorg.test', primaryPhone: '(555) 000-0000', timezone: 'America/Chicago', defaultCurrency: 'usd' }}
          onStarted={() => {}}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByDisplayValue('Test Org LLC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0].currentStep).toBe('primary_location');
  });
});
