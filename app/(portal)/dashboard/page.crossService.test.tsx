import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import * as reportsClient from '@/lib/reportsClient';
import type { DashboardResult } from '@/services/dashboardService';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { EXPECTED_LABELS, GUS, crossServiceCases, templates } from '@/domain/workflow/crossServiceRegression.fixtures';
import type { Case } from '@/types/case';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Service-specific workflows — cross-service regression (2026-10). The
 * Dashboard for Gus Camacho Jr. with TWO approved workflows of different
 * lengths (Direct Cremation and a fictional burial-shaped one — see
 * domain/workflow/crossServiceRegression.fixtures.ts), on the mock adapter:
 * Cases by Stage lists every organization stage in order with server-side
 * counts, the KPI strip counts active cases against each case's own
 * terminal stage, and Needs Attention picks up stalled cases from both
 * workflows. Fictional data only.
 */
vi.mock('@/lib/reportsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reportsClient')>('@/lib/reportsClient');
  return { ...actual, fetchDashboard: vi.fn() };
});

// The templates request goes to GET /api/workflow-templates; answered here
// from the same mock fixtures that route serves.
vi.mock('@/services/workflowTemplatesService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/workflowTemplatesService')>();
  const { workflowTemplateFixtures: fixtures } = await import('@/services/__mocks__/workflowTemplates');
  return {
    ...actual,
    workflowTemplatesService: {
      ...actual.workflowTemplatesService,
      list: async (context: { organizationId: string }) => structuredClone(fixtures.filter((t) => t.organizationId === context.organizationId)),
    },
  };
});

const BASE_DASHBOARD: DashboardResult = {
  today: { unreadNotifications: 0, appointmentsToday: 0 },
  operations: null,
  financial: null,
  attention: null,
};

function renderGusDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={GUS}>
        <DashboardPage />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

const escape = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let casesBefore: Case[];
let templatesBefore: WorkflowTemplate[];

beforeEach(() => {
  casesBefore = structuredClone(caseFixtures);
  templatesBefore = structuredClone(workflowTemplateFixtures);
  const cases = crossServiceCases().map((c) => ({ ...c, decedentName: `FICTIONAL ${c.id.toUpperCase()}` }));
  caseFixtures.splice(0, caseFixtures.length, ...caseFixtures.filter((c) => c.organizationId !== GUS), ...cases);
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...workflowTemplateFixtures.filter((t) => t.organizationId !== GUS), ...structuredClone(templates));
  vi.mocked(reportsClient.fetchDashboard).mockResolvedValue(BASE_DASHBOARD);
});

afterEach(() => {
  cleanup();
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
});

describe('Gus Dashboard with two approved workflows of different lengths', () => {
  it('Cases by Stage lists every organization stage, in order, each with its own server-side count', async () => {
    renderGusDashboard();
    const expected: Record<string, string> = {
      'First Call & Payment': '3',
      'Cemetery Arrangements': '1',
      'Death Certificate Application Sent': '2',
      'Graveside Service Held': '1',
      'Completed': '4',
    };
    const buttons: HTMLElement[] = [];
    for (const label of EXPECTED_LABELS) {
      const button = await screen.findByRole('button', { name: new RegExp(`^${escape(label)}`) });
      buttons.push(button);
      if (expected[label]) await waitFor(() => expect(button.textContent).toContain(expected[label]));
    }
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i - 1].compareDocumentPosition(buttons[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // "Intake & JotForm" is Manors' presentation, never Gus'.
    expect(screen.queryByRole('button', { name: /^Intake & JotForm/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /All cases/ })).toHaveTextContent('12');
  });

  it('a shared stage’s preview shows cases from both workflows', async () => {
    renderGusDashboard();
    fireEvent.click(await screen.findByRole('button', { name: /^Death Certificate Application Sent/ }));
    expect(await screen.findByText('Fictional Dc-04')).toBeInTheDocument();
    expect(screen.getByText('Fictional Bu-03')).toBeInTheDocument();
  });

  it('KPI strip: active cases are those not on their OWN workflow’s terminal stage', async () => {
    renderGusDashboard();
    const label = await screen.findByText('Active cases');
    // 12 cases, 4 on their own workflow's terminal stage (the real stage).
    await waitFor(() => expect(label.parentElement!.textContent).toContain('8'));
  });

  it('Needs Attention lists the stalled cases from both workflows', async () => {
    renderGusDashboard();
    expect(await screen.findByText('Fictional Dc-03')).toBeInTheDocument();
    expect(screen.getByText('Fictional Bu-02')).toBeInTheDocument();
  });
});
