import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RoleManagementPanel } from './RoleManagementPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Manors go-live hardening. Focused on RoleManagementPanel's own
 * authorization guard (added after production testing showed
 * GET /api/rbac/roles — and consequently this page — rendered the full
 * role/permission catalog for a caller lacking any role-management
 * permission). Child components are stubbed so this test exercises only
 * the guard itself, not RoleList/RoleEditor/AssignRoleDialog's own
 * pre-existing rendering logic.
 */
vi.mock('./RoleList', () => ({ RoleList: () => <div>RoleList-stub</div> }));
vi.mock('./RoleEditor', () => ({ RoleEditor: () => <div>RoleEditor-stub</div> }));
vi.mock('./AssignRoleDialog', () => ({ AssignRoleDialog: () => <div>AssignRoleDialog-stub</div> }));
vi.mock('./PermissionInspector', () => ({ PermissionInspector: () => <div>PermissionInspector-stub</div> }));
vi.mock('./RbacHealthBadge', () => ({ RbacHealthBadge: () => <div>RbacHealthBadge-stub</div> }));

let mockPermissions: string[] = [];
vi.mock('@/hooks/useRbac', () => ({
  useRoles: () => ({ data: [{ id: 'role-admin', key: 'administrator', name: 'Administrator', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] }], isPending: false }),
  usePermissionCatalog: () => ({ data: [], isPending: false }),
  useOrganizationMembers: () => ({ data: [], isPending: false }),
  useMyPermissions: () => ({ data: { identityId: 'identity-test', roleKey: 'test', permissions: mockPermissions }, isPending: false }),
}));

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <RoleManagementPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('RoleManagementPanel — authorization guard (Manors go-live hardening)', () => {
  it('renders a not-authorized state instead of the role catalog for a caller lacking user.manageRoles', () => {
    mockPermissions = ['case.read', 'case.create', 'case.update'];
    renderPanel();
    expect(screen.getByText("You don't have access to organization roles for this organization.")).toBeInTheDocument();
    expect(screen.queryByText('RoleList-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('RoleEditor-stub')).not.toBeInTheDocument();
    expect(screen.queryByText('PermissionInspector-stub')).not.toBeInTheDocument();
  });

  it("does not block a caller who holds user.manageRoles, even without user.invite", () => {
    mockPermissions = ['user.manageRoles'];
    renderPanel();
    expect(screen.queryByText("You don't have access to organization roles for this organization.")).not.toBeInTheDocument();
    expect(screen.getByText('RoleList-stub')).toBeInTheDocument();
    expect(screen.getByText('PermissionInspector-stub')).toBeInTheDocument();
  });

  it('blocks a caller who holds user.invite (but not user.manageRoles) from the standalone Roles page', () => {
    // Manager-shaped permission set: can fetch role data server-side for
    // the Team page's invite picker (canViewRoleCatalog), but this page's
    // own guard is intentionally narrower (canManageRoles alone).
    mockPermissions = ['user.invite'];
    renderPanel();
    expect(screen.getByText("You don't have access to organization roles for this organization.")).toBeInTheDocument();
    expect(screen.queryByText('RoleList-stub')).not.toBeInTheDocument();
  });
});
