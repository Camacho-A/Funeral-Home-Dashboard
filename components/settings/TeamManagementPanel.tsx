'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { EmptyState } from '@/components/ui/EmptyState';
import { useOrganizationMembers, usePendingInvitations, useRoles, useMyPermissions } from '@/hooks/useRbac';
import { TeamMemberList } from './TeamMemberList';
import { PendingInvitationList } from './PendingInvitationList';
import { InviteTeamMemberModal } from './InviteTeamMemberModal';

/**
 * Phase 23 (Team Management). "Settings > Team" — the orchestration
 * layer, matching the pattern `RoleManagementPanel.tsx` already
 * established for the Organization Roles Page: this is the only
 * component here that owns "is the invite modal open," everything below
 * is presentational/data-fetching-by-props. `includeDisabled: true` on
 * `useOrganizationMembers` is what lets this page (unlike the Roles
 * page's own member picker) show disabled members with a reactivate
 * action.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S2): renders inside
 * SettingsShell now — the page title/back-link/nav come from there.
 */
export function TeamManagementPanel() {
  const { organizationId } = useOrganization();
  const membersQuery = useOrganizationMembers(organizationId, true);
  const invitationsQuery = usePendingInvitations(organizationId);
  const rolesQuery = useRoles(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);

  const [inviteOpen, setInviteOpen] = useState(false);

  if (membersQuery.isPending || invitationsQuery.isPending || rolesQuery.isPending || myPermissionsQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading team…</span>
      </div>
    );
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];

  // Manors go-live hardening: a page/UI guard, not just hiding the
  // "+ Invite Team Member" button — matches GET /api/rbac/members' own
  // new server-side `user.read` requirement, so direct navigation to
  // this page can't render the real roster for a caller who lacks it.
  if (!permissions.includes('user.read')) {
    return <EmptyState message="You don't have access to team management for this organization." />;
  }

  const members = membersQuery.data ?? [];
  const invitations = invitationsQuery.data ?? [];
  const roles = rolesQuery.data ?? [];
  const canInvite = permissions.includes('user.invite');
  const canRemove = permissions.includes('user.remove');
  const canManageRoles = permissions.includes('user.manageRoles');
  const currentIdentityId = myPermissionsQuery.data?.identityId ?? null;

  return (
    <div>
      <div className="sx-settings-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 className="sx-settings-title">Team</h2>
          <p className="sx-settings-desc">Manage staff accounts and invitations.</p>
        </div>
        {canInvite && (
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => setInviteOpen(true)}>
            + Invite Team Member
          </button>
        )}
      </div>

      <TeamMemberList
        organizationId={organizationId}
        members={members}
        roles={roles}
        currentIdentityId={currentIdentityId}
        canManageRoles={canManageRoles}
        canRemove={canRemove}
      />

      <PendingInvitationList organizationId={organizationId} invitations={invitations} roles={roles} canInvite={canInvite} />

      {canInvite && <InviteTeamMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} organizationId={organizationId} roles={roles} />}
    </div>
  );
}
