'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import type { RbacMember, RbacRole } from '@/lib/identityAuthClient';
import { useAssignRole, useSetMembershipStatus } from '@/hooks/useRbac';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import styles from './TeamMemberList.module.css';

type PendingStatusAction = { targetIdentityId: string; displayName: string; status: 'disabled' | 'removed' };

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
    <Card className={styles.card}>
      <h2 className={styles.heading}>Team members</h2>
      <div className={styles.list}>
        {members.map((member) => {
          const isSelf = currentIdentityId !== null && member.identityId === currentIdentityId;
          const isDisabled = member.status === 'disabled';

          return (
            <div key={member.identityId} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.name}>{member.displayName}</span>
                {member.email && <span className={styles.email}>{member.email}</span>}
              </div>

              {canManageRoles ? (
                <SelectField
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
                <span className={styles.roleLabel}>{roles.find((r) => r.key === member.role)?.name ?? member.role}</span>
              )}

              <Badge variant={isDisabled ? 'danger' : 'success'}>{isDisabled ? 'Disabled' : 'Active'}</Badge>

              {canRemove && !isSelf && (
                <div className={styles.actions}>
                  {isDisabled ? (
                    <Button
                      variant="secondary"
                      onClick={() => setMembershipStatus.mutate({ targetIdentityId: member.identityId, status: 'active' })}
                      disabled={setMembershipStatus.isPending}
                    >
                      Reactivate
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setPendingAction({ targetIdentityId: member.identityId, displayName: member.displayName, status: 'disabled' })}>
                      Disable
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => setPendingAction({ targetIdentityId: member.identityId, displayName: member.displayName, status: 'removed' })}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
    </Card>
  );
}
