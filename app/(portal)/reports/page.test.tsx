import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReportsPage from './page';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as reportsClient from '@/lib/reportsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { ReportDefinition } from '@/domain/reporting/reportRegistry';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/reportsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reportsClient')>('@/lib/reportsClient');
  return { ...actual, fetchReportDefinitions: vi.fn() };
});

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function makeReport(overrides: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    key: 'active-cases',
    displayName: 'Active Cases',
    category: 'operational',
    description: 'Cases currently open, broken down by workflow stage.',
    metrics: ['cases.active'],
    defaultFilters: [],
    permission: 'report.operational',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <ReportsPage />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('ReportsPage (Reports Library)', () => {
  it('shows an EmptyState for a caller without report.view', async () => {
    mockPermissions([]);
    vi.mocked(reportsClient.fetchReportDefinitions).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("You don't have access to reports for this organization.")).toBeInTheDocument();
  });

  it('groups reports by category and links each to its Report Viewer', async () => {
    mockPermissions(['report.view']);
    vi.mocked(reportsClient.fetchReportDefinitions).mockResolvedValue([
      makeReport({ key: 'active-cases', displayName: 'Active Cases', category: 'operational' }),
      makeReport({ key: 'trial-balance', displayName: 'Trial Balance', category: 'financial', permission: 'accounting.report' }),
    ]);
    renderPage();

    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('Financial')).toBeInTheDocument();
    expect(screen.getByText('Active Cases').closest('a')).toHaveAttribute('href', '/reports/active-cases');
    expect(screen.getByText('Trial Balance').closest('a')).toHaveAttribute('href', '/reports/trial-balance');
  });

  it('shows an EmptyState when the caller has report.view but no reports are visible', async () => {
    mockPermissions(['report.view']);
    vi.mocked(reportsClient.fetchReportDefinitions).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(reportsClient.fetchReportDefinitions).toHaveBeenCalled());
    expect(await screen.findByText('No reports are available to you.')).toBeInTheDocument();
  });
});
