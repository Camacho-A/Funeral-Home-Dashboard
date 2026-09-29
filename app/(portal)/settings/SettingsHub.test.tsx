import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsHub } from './SettingsHub';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

// useWorkflowTemplates() calls workflowTemplatesService.list(...) directly
// (the namespace object, not the standalone `list` export) — both must be
// mocked to the same vi.fn(), mirroring
// components/case/CaseDocumentsTab.test.tsx's identical organizationsService
// gotcha.
vi.mock('@/services/workflowTemplatesService', async () => {
  const actual = await vi.importActual<typeof import('@/services/workflowTemplatesService')>('@/services/workflowTemplatesService');
  const mockList = vi.fn();
  return { ...actual, list: mockList, workflowTemplatesService: { ...actual.workflowTemplatesService, list: mockList } };
});

vi.mock('@/components/modals/ImportHistoricalCaseModal', () => ({
  ImportHistoricalCaseModal: ({ open }: { open: boolean }) => (open ? <div>Import Existing Jotform modal open</div> : null),
}));

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

function renderHub(authAdapterMode: 'mock' | 'wix' | 'identity' = 'mock') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <SettingsHub authAdapterMode={authAdapterMode} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workflowTemplatesService.list).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SettingsHub — Team (item #5, 2026-09)', () => {
  it('13: shows Team for an identity-mode caller holding user.invite', async () => {
    mockPermissions(['user.invite']);
    renderHub('identity');
    expect(await screen.findByText('Team')).toBeInTheDocument();
  });

  it('hides Team outside identity mode, even holding user.invite', async () => {
    mockPermissions(['user.invite']);
    renderHub('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
  });

  it('hides Team for an identity-mode caller without user.invite', async () => {
    mockPermissions([]);
    renderHub('identity');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
  });
});

describe('SettingsHub — Security & Roles (item #5, 2026-09)', () => {
  it('14: shows Security for any identity-mode session, no specific permission needed', async () => {
    mockPermissions([]);
    renderHub('identity');
    expect(await screen.findByText('Security')).toBeInTheDocument();
  });

  it('hides Security outside identity mode', async () => {
    mockPermissions([]);
    renderHub('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('14: shows Roles & Permissions for an identity-mode caller holding user.manageRoles', async () => {
    mockPermissions(['user.manageRoles']);
    renderHub('identity');
    expect(await screen.findByText('Roles & Permissions')).toBeInTheDocument();
  });

  it('7: hides Roles & Permissions for an identity-mode caller without user.manageRoles', async () => {
    mockPermissions([]);
    renderHub('identity');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Roles & Permissions')).not.toBeInTheDocument();
  });
});

describe('SettingsHub — Case Numbering (item #5, 2026-09)', () => {
  it('11: shows Case Numbering for caseNumber.manage, org-agnostic (no identity-mode requirement)', async () => {
    mockPermissions(['caseNumber.manage']);
    renderHub('mock');
    expect(await screen.findByText('Case Numbering')).toBeInTheDocument();
  });

  it('shows Case Numbering via the user.manageRoles bootstrap path', async () => {
    mockPermissions(['user.manageRoles']);
    renderHub('mock');
    expect(await screen.findByText('Case Numbering')).toBeInTheDocument();
  });

  it('7: hides Case Numbering for a caller with neither permission', async () => {
    mockPermissions([]);
    renderHub('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Case Numbering')).not.toBeInTheDocument();
  });
});

describe('SettingsHub — Import Existing Jotform (item #5, 2026-09)', () => {
  it('6: shows Import Existing Jotform for case.create, org-agnostic', async () => {
    mockPermissions(['case.create']);
    renderHub('mock');
    expect(await screen.findByText('Import Existing Jotform')).toBeInTheDocument();
  });

  it('7: hides Import Existing Jotform without case.create', async () => {
    mockPermissions([]);
    renderHub('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Import Existing Jotform')).not.toBeInTheDocument();
  });

  it('opens the Import Existing Jotform modal on click', async () => {
    mockPermissions(['case.create']);
    renderHub('mock');
    fireEvent.click(await screen.findByText('Import Existing Jotform'));
    expect(await screen.findByText('Import Existing Jotform modal open')).toBeInTheDocument();
  });
});

describe('SettingsHub — Organization Profile (2026-09)', () => {
  it('35. shows Organization Profile for a caller holding organization.manage, org-agnostic (no identity-mode requirement)', async () => {
    mockPermissions(['organization.manage']);
    renderHub('mock');
    expect(await screen.findByText('Organization Profile')).toBeInTheDocument();
  });

  it('35. hides Organization Profile for a caller without organization.manage', async () => {
    mockPermissions([]);
    renderHub('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Organization Profile')).not.toBeInTheDocument();
  });

  it('35. every other existing Settings area remains reachable alongside the new card', async () => {
    mockPermissions(['organization.manage', 'caseNumber.manage', 'case.create']);
    renderHub('mock');
    expect(await screen.findByText('Organization Profile')).toBeInTheDocument();
    expect(screen.getByText('Case Numbering')).toBeInTheDocument();
    expect(screen.getByText('Import Existing Jotform')).toBeInTheDocument();
    expect(screen.getByText('Workflow Templates')).toBeInTheDocument();
  });
});

describe('SettingsHub — no empty sections (item #5, 2026-09)', () => {
  it('renders no Administration or Security & Roles section heading when the caller has none of those permissions', async () => {
    mockPermissions([]);
    renderHub('mock');
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Security & Roles')).not.toBeInTheDocument();
  });

  it('12: Workflow Templates section remains present and unaffected regardless of the other permissions', async () => {
    mockPermissions([]);
    renderHub('mock');
    expect(await screen.findByText('Workflow Templates')).toBeInTheDocument();
  });
});
