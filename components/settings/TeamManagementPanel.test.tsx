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

// SOLIS Tasks/Calendar/Settings phase, §3.5: row actions now live behind
// a RowMenu ("Actions for {name}") instead of always-visible buttons.
function openRowMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
}

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
    permissions: ['organization.manage', 'user.read', 'user.remove', 'user.invite', 'user.manageRoles'],
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
    expect(screen.queryByRole('button', { name: 'Actions for Self Admin' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Actions for Other Member' })).toBeInTheDocument();
    openRowMenu('Other Member');
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument();
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

    openRowMenu('Other Member');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));

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

    openRowMenu('Disabled Member');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivate' }));

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

    openRowMenu('Other Member');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

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

    openRowMenu('Other Member');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
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

  // Raw role display fix (2026-10): proves the fix end-to-end through the
  // real panel wiring (TeamManagementPanel -> PendingInvitationList),
  // not just PendingInvitationList in isolation
  // (PendingInvitationList.test.tsx covers that directly).
  it('raw role display fix: the pending invitation\'s role renders as its human label ("Read Only"), never the raw key', async () => {
    renderPanel();
    await screen.findByText('Invited Person');
    const invitedRow = screen.getByText('Invited Person').closest('tr')!;
    expect(within(invitedRow).getByText('Read Only')).toBeInTheDocument();
    expect(within(invitedRow).queryByText('readOnly')).not.toBeInTheDocument();
  });

  it('invites a new team member — the invite modal submits and the list refetches', async () => {
    vi.mocked(identityAuthClient.inviteTeamMember).mockResolvedValue({ membershipId: 'membership-new', outcome: 'invited' });
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

  it('Fix C: surfaces a resend failure to the admin instead of failing silently', async () => {
    vi.mocked(identityAuthClient.resendInvitationRequest).mockRejectedValue(new Error('Cannot resend: this invitation is currently "removed", not pending.'));
    renderPanel();
    await screen.findByText('Invited Person');

    fireEvent.click(screen.getByText('Resend'));

    expect(await screen.findByText('Cannot resend: this invitation is currently "removed", not pending.')).toBeInTheDocument();
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

describe('TeamManagementPanel — authorization guard (Manors go-live hardening)', () => {
  it('renders a not-authorized state instead of the roster for a caller lacking user.read', async () => {
    vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({
      identityId: 'identity-office-staff',
      roleKey: 'officeStaff',
      permissions: ['case.read', 'case.create', 'case.update'],
    });
    renderPanel();
    expect(await screen.findByText("You don't have access to team management for this organization.")).toBeInTheDocument();
    expect(screen.queryByText('Self Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Invited Person')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Invite Team Member' })).not.toBeInTheDocument();
  });
});
