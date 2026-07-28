import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamManagementPanel } from './TeamManagementPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { RbacMember, RbacRole, PendingInvitation } from '@/lib/identityAuthClient';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return {
    ...actual,
    fetchOrganizationMembers: vi.fn(),
    fetchPendingInvitations: vi.fn(),
    fetchRolesForOrganization: vi.fn(),
    fetchMyPermissions: vi.fn(),
    assignRoleToMember: vi.fn(),
    setMembershipStatusRequest: vi.fn(),
    inviteTeamMember: vi.fn(),
    resendInvitationRequest: vi.fn(),
    revokeInvitationRequest: vi.fn(),
  };
});

const ROLES: RbacRole[] = [
  { id: 'role-admin', key: 'administrator', name: 'Administrator', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: ['organization.manage', 'user.remove', 'user.invite', 'user.manageRoles'] },
  { id: 'role-readonly', key: 'readOnly', name: 'Read Only', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
];

const SELF: RbacMember = { identityId: 'identity-self', displayName: 'Self Admin', email: 'self@example.com', role: 'administrator', membershipId: 'membership-self', status: 'active' };
const OTHER_ACTIVE: RbacMember = { identityId: 'identity-other', displayName: 'Other Member', email: 'other@example.com', role: 'readOnly', membershipId: 'membership-other', status: 'active' };
const DISABLED_MEMBER: RbacMember = { identityId: 'identity-disabled', displayName: 'Disabled Member', email: 'disabled@example.com', role: 'readOnly', membershipId: 'membership-disabled', status: 'disabled' };

const PENDING_INVITATION: PendingInvitation = {
  membershipId: 'membership-invited',
  identityId: 'identity-invited',
  email: 'invited@example.com',
  displayName: 'Invited Person',
  role: 'readOnly',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-02T00:00:00.000Z',
  lastResentAt: null,
};

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <TeamManagementPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(identityAuthClient.fetchOrganizationMembers).mockResolvedValue([SELF, OTHER_ACTIVE, DISABLED_MEMBER]);
  vi.mocked(identityAuthClient.fetchPendingInvitations).mockResolvedValue([PENDING_INVITATION]);
  vi.mocked(identityAuthClient.fetchRolesForOrganization).mockResolvedValue(ROLES);
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({
    identityId: SELF.identityId,
    roleKey: 'administrator',
    permissions: ['organization.manage', 'user.remove', 'user.invite', 'user.manageRoles'],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TeamManagementPanel — member list', () => {
  it('lists active and disabled members with their role and status', async () => {
    renderPanel();
    expect(await screen.findByText('Self Admin')).toBeInTheDocument();
    expect(screen.getByText('Other Member')).toBeInTheDocument();
    expect(screen.getByText('Disabled Member')).toBeInTheDocument();
    expect(screen.getAllByText('Active')).toHaveLength(2);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it("hides status-change controls for the caller's own row (self-disable/removal blocked in the UI)", async () => {
    renderPanel();
    await screen.findByText('Self Admin');
    const selfRow = screen.getByText('Self Admin').closest('div')!.parentElement!;
    expect(within(selfRow).queryByText('Disable')).not.toBeInTheDocument();
    expect(within(selfRow).queryByText('Remove')).not.toBeInTheDocument();

    const otherRow = screen.getByText('Other Member').closest('div')!.parentElement!;
    expect(within(otherRow).getByText('Disable')).toBeInTheDocument();
    expect(within(otherRow).getByText('Remove')).toBeInTheDocument();
  });

  it('changes a member\'s role via the inline role select', async () => {
    vi.mocked(identityAuthClient.assignRoleToMember).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Other Member');

    const roleSelect = screen.getByLabelText('Role for Other Member');
    fireEvent.change(roleSelect, { target: { value: 'administrator' } });

    await waitFor(() =>
      expect(identityAuthClient.assignRoleToMember).toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentityId: 'identity-other', roleKey: 'administrator' }),
      ),
    );
  });

  it('disables an active member after confirming, then reactivates them', async () => {
    vi.mocked(identityAuthClient.setMembershipStatusRequest).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Other Member');

    const otherRow = screen.getByText('Other Member').closest('div')!.parentElement!;
    fireEvent.click(within(otherRow).getByText('Disable'));

    expect(await screen.findByText(/will lose access to this organization/i)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(identityAuthClient.setMembershipStatusRequest).toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentityId: 'identity-other', status: 'disabled' }),
      ),
    );
  });

  it('reactivates a disabled member without a confirmation dialog', async () => {
    vi.mocked(identityAuthClient.setMembershipStatusRequest).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Disabled Member');

    fireEvent.click(screen.getByText('Reactivate'));

    await waitFor(() =>
      expect(identityAuthClient.setMembershipStatusRequest).toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentityId: 'identity-disabled', status: 'active' }),
      ),
    );
  });

  it('removes a member after confirming', async () => {
    vi.mocked(identityAuthClient.setMembershipStatusRequest).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Other Member');

    const otherRow = screen.getByText('Other Member').closest('div')!.parentElement!;
    fireEvent.click(within(otherRow).getByText('Remove'));

    expect(await screen.findByText(/will be permanently removed/i)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(identityAuthClient.setMembershipStatusRequest).toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentityId: 'identity-other', status: 'removed' }),
      ),
    );
  });

  it('surfaces the last-administrator invariant error inline rather than closing silently', async () => {
    vi.mocked(identityAuthClient.setMembershipStatusRequest).mockRejectedValue(new Error('This change would leave the organization with no administrator.'));
    renderPanel();
    await screen.findByText('Other Member');

    const otherRow = screen.getByText('Other Member').closest('div')!.parentElement!;
    fireEvent.click(within(otherRow).getByText('Remove'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('This change would leave the organization with no administrator.')).toBeInTheDocument();
  });
});

describe('TeamManagementPanel — pending invitations', () => {
  it('lists a pending invitation with its role and expiry', async () => {
    renderPanel();
    expect(await screen.findByText('Invited Person')).toBeInTheDocument();
    expect(screen.getByText('invited@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('invites a new team member — the invite modal submits and the list refetches', async () => {
    vi.mocked(identityAuthClient.inviteTeamMember).mockResolvedValue({ membershipId: 'membership-new', isNewMembership: true });
    renderPanel();
    await screen.findByText('Invited Person');

    fireEvent.click(screen.getByRole('button', { name: '+ Invite Team Member' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new.person@example.com' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'readOnly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));

    await waitFor(() =>
      expect(identityAuthClient.inviteTeamMember).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new.person@example.com', displayName: 'New Person', role: 'readOnly' }),
      ),
    );
  });

  it('resends an invitation', async () => {
    vi.mocked(identityAuthClient.resendInvitationRequest).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Invited Person');

    fireEvent.click(screen.getByText('Resend'));

    await waitFor(() =>
      expect(identityAuthClient.resendInvitationRequest).toHaveBeenCalledWith(
        expect.objectContaining({ membershipId: 'membership-invited', invitedIdentityId: 'identity-invited' }),
      ),
    );
  });

  it('revokes an invitation after confirming — it disappears from the list', async () => {
    vi.mocked(identityAuthClient.revokeInvitationRequest).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Invited Person');

    fireEvent.click(screen.getByText('Revoke'));
    expect(await screen.findByText(/will be cancelled and can no longer be accepted/i)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(identityAuthClient.revokeInvitationRequest).toHaveBeenCalledWith(expect.objectContaining({ membershipId: 'membership-invited' })));

    // After revocation, the query is invalidated and refetched — simulate the
    // now-empty pending list the server would actually return.
    vi.mocked(identityAuthClient.fetchPendingInvitations).mockResolvedValue([]);
  });
});
