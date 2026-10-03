'use client';

import { useState } from 'react';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowMenu, type RowMenuItem } from '@/components/ui/RowMenu';
import type { RbacMember, RbacRole } from '@/lib/identityAuthClient';
import { useAssignRole, useSetMembershipStatus } from '@/hooks/useRbac';
import { ConfirmActionDialog } from './ConfirmActionDialog';

type PendingStatusAction = { targetIdentityId: string; displayName: string; status: 'disabled' | 'removed' };

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/**
 * Phase 23 (Team Management). The Team page's active + disabled member
 * list — role change (an inline `SelectField` calling the same
 * `assignRole` mutation the Organization Roles Page's Assign Role Dialog
 * already uses), disable/reactivate/remove. A caller's own row never
 * shows a status-change control — self-service disable/removal is out of
 * scope regardless of admin count (`PATCH /api/rbac/membership-status`
 * refuses it server-side too; this is a UI convenience, not the actual
 * guarantee). Disable/remove ask for confirmation first (the
 * last-administrator invariant, if tripped, surfaces inline in that
 * dialog); reactivate does not, since it can only ever restore access,
 * never take it away.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S2): `table.sx-table
 * sx-table-stack`; the row-level actions move into a `RowMenu` ("Disable"/
 * "Reactivate", then a divider, then "Remove" as danger) instead of
 * always-visible buttons. Same handlers/conditions/confirm dialog.
 */
export function TeamMemberList({
  organizationId,
  members,
  roles,
  currentIdentityId,
  canManageRoles,
  canRemove,
}: {
  organizationId: string;
  members: RbacMember[];
  roles: RbacRole[];
  currentIdentityId: string | null;
  canManageRoles: boolean;
  canRemove: boolean;
}) {
  const assignRole = useAssignRole(organizationId);
  const setMembershipStatus = useSetMembershipStatus(organizationId);
  const [pendingAction, setPendingAction] = useState<PendingStatusAction | null>(null);

  if (members.length === 0) {
    return <EmptyState message="No team members yet." />;
  }

  return (
    <section className="sx-settings-section">
      <div className="sx-settings-section-head">
        <div>
          <h3 className="sx-settings-section-title">Team members</h3>
        </div>
      </div>
      <table className="sx-table sx-table-stack">
        <thead>
          <tr>
            <th>Member</th>
            <th>Role</th>
            <th>Status</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isSelf = currentIdentityId !== null && member.identityId === currentIdentityId;
            const isDisabled = member.status === 'disabled';

            const items: RowMenuItem[] = [];
            if (isDisabled) {
              items.push({ label: 'Reactivate', onSelect: () => setMembershipStatus.mutate({ targetIdentityId: member.identityId, status: 'active' }) });
            } else {
              items.push({ label: 'Disable', onSelect: () => setPendingAction({ targetIdentityId: member.identityId, displayName: member.displayName, status: 'disabled' }) });
            }
            items.push({
              label: 'Remove',
              danger: true,
              dividerBefore: true,
              onSelect: () => setPendingAction({ targetIdentityId: member.identityId, displayName: member.displayName, status: 'removed' }),
            });

            return (
              <tr key={member.identityId}>
                <td data-label="Member" data-primary>
                  <span className="sx-avatar" style={{ width: 28, height: 28, fontSize: 11 }} aria-hidden="true">
                    {initialsFor(member.displayName)}
                  </span>
                  <span className="sx-cell-title">{member.displayName}</span>
                  {member.email && <span className="sx-cell-sub">{member.email}</span>}
                </td>
                <td data-label="Role">
                  {canManageRoles ? (
                    <SelectField
                      className="sx-select"
                      aria-label={`Role for ${member.displayName}`}
                      value={member.role}
                      disabled={assignRole.isPending}
                      onChange={(e) => assignRole.mutate({ targetIdentityId: member.identityId, roleKey: e.target.value })}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.key}>
                          {role.name}
                        </option>
                      ))}
                    </SelectField>
                  ) : (
                    <span>{roles.find((r) => r.key === member.role)?.name ?? member.role}</span>
                  )}
                </td>
                <td data-label="Status">
                  <span className={isDisabled ? 'sx-status' : 'sx-status sx-status-ok'}>{isDisabled ? 'Disabled' : 'Active'}</span>
                </td>
                <td data-label="Actions" className="sx-row-actions">
                  {canRemove && !isSelf && <RowMenu label={`Actions for ${member.displayName}`} items={items} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pendingAction && (
        <ConfirmActionDialog
          open
          onClose={() => setPendingAction(null)}
          title={pendingAction.status === 'disabled' ? 'Disable Team Member' : 'Remove Team Member'}
          message={
            pendingAction.status === 'disabled'
              ? `${pendingAction.displayName} will lose access to this organization until reactivated.`
              : `${pendingAction.displayName} will be permanently removed from this organization. Adding them back requires a fresh invitation.`
          }
          confirmLabel={pendingAction.status === 'disabled' ? 'Disable' : 'Remove'}
          onConfirm={() => setMembershipStatus.mutateAsync({ targetIdentityId: pendingAction.targetIdentityId, status: pendingAction.status })}
        />
      )}
    </section>
  );
}
