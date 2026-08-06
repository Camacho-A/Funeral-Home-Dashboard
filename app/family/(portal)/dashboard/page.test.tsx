import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FamilyDashboardPage from './page';
import * as familyClient from '@/lib/familyClient';
import type { PortalCaseView } from '@/domain/portal/portalCaseView';

vi.mock('@/lib/familyClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/familyClient')>('@/lib/familyClient');
  return { ...actual, fetchFamilyCases: vi.fn() };
});

function makeCaseView(overrides: Partial<PortalCaseView> = {}): PortalCaseView {
  return {
    id: 'case-1',
    caseNumber: 'B2026-321',
    decedentName: 'John Doe',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '01/01/2026',
    stageLabel: 'Arrangements',
    caseType: 'cremation',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FamilyDashboardPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('FamilyDashboardPage', () => {
  it('shows an empty state when the portal user has no case access', async () => {
    vi.mocked(familyClient.fetchFamilyCases).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("You don't have access to any cases yet.")).toBeInTheDocument();
  });

  it('lists a case with its decedent name, case number, and stage', async () => {
    vi.mocked(familyClient.fetchFamilyCases).mockResolvedValue([makeCaseView()]);
    renderPage();
    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('B2026-321')).toBeInTheDocument();
    expect(screen.getByText('Arrangements')).toBeInTheDocument();
  });

  it('links each case card to its case detail page', async () => {
    vi.mocked(familyClient.fetchFamilyCases).mockResolvedValue([makeCaseView()]);
    renderPage();
    const link = (await screen.findByText('John Doe')).closest('a');
    expect(link).toHaveAttribute('href', '/family/cases/case-1');
  });
});
