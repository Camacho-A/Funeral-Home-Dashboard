import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionInspector } from './PermissionInspector';
import * as identityAuthClient from '@/lib/identityAuthClient';
import type { RbacRole } from '@/lib/identityAuthClient';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchPermissionCatalog: vi.fn(), fetchMyPermissions: vi.fn(), fetchRolesForOrganization: vi.fn() };
});

const ROLES: RbacRole[] = [
  { id: 'role-office', key: 'officeStaff', name: 'Office Staff', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
];

function renderInspector() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PermissionInspector organizationId="org-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(identityAuthClient.fetchPermissionCatalog).mockResolvedValue([]);
  vi.mocked(identityAuthClient.fetchRolesForOrganization).mockResolvedValue(ROLES);
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Raw role display fix (2026-10). The "role: X" line used to render the
 * raw `roleKey` directly — now resolved against the same canonical
 * `roles` list every other role display in Settings uses.
 */
describe('PermissionInspector — role display', () => {
  it('"officeStaff" renders as "role: Office Staff", never the raw key', async () => {
    vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'officeStaff', permissions: [] });
    renderInspector();
    expect(await screen.findByText('role: Office Staff')).toBeInTheDocument();
    expect(screen.queryByText('role: officeStaff')).not.toBeInTheDocument();
  });

  it('falls back to the raw role key when it matches no known role', async () => {
    vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'someFutureRoleKey', permissions: [] });
    renderInspector();
    expect(await screen.findByText('role: someFutureRoleKey')).toBeInTheDocument();
  });
});
