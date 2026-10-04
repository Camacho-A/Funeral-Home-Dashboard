import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignRoleDialog } from './AssignRoleDialog';
import type { RbacMember, RbacRole } from '@/lib/identityAuthClient';

const ROLES: RbacRole[] = [
  { id: 'role-admin', key: 'administrator', name: 'Administrator', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
  { id: 'role-office', key: 'officeStaff', name: 'Office Staff', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
];

const MEMBERS: RbacMember[] = [
  { identityId: 'identity-1', displayName: 'Jordan Rivera', email: 'jordan@example.com', role: 'officeStaff', membershipId: 'membership-1', status: 'active' },
  { identityId: 'identity-2', displayName: 'Casey Nguyen', email: 'casey@example.com', role: 'administrator', membershipId: 'membership-2', status: 'active' },
];

function renderDialog(members: RbacMember[] = MEMBERS, roles: RbacRole[] = ROLES) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AssignRoleDialog open onClose={() => {}} organizationId="org-1" members={members} roles={roles} />
    </QueryClientProvider>,
  );
}

/**
 * Raw role display fix (2026-10). The member picker's "— currently X"
 * option text used to render the raw role key directly — now resolved
 * against the `roles` prop, same pattern as PendingInvitationList.
 */
describe('AssignRoleDialog — member picker role display', () => {
  it('"officeStaff" renders as "Office Staff" in the "— currently X" option text', () => {
    renderDialog();
    const memberSelect = screen.getByLabelText('Member');
    const option = within(memberSelect).getByText('Jordan Rivera — currently Office Staff');
    expect(option).toBeInTheDocument();
  });

  it('never renders the raw role key in the option text', () => {
    renderDialog();
    const memberSelect = screen.getByLabelText('Member');
    expect(within(memberSelect).queryByText(/officeStaff/)).not.toBeInTheDocument();
  });

  it('the role selector itself still submits canonical internal role keys as option values', () => {
    renderDialog();
    const roleSelect = screen.getByLabelText('Role') as HTMLSelectElement;
    const officeStaffOption = within(roleSelect).getByText('Office Staff') as HTMLOptionElement;
    expect(officeStaffOption.value).toBe('officeStaff');
  });

  it('falls back to the raw role key when it matches no known role', () => {
    renderDialog([{ identityId: 'identity-3', displayName: 'Unknown Role Member', email: 'x@example.com', role: 'someFutureRoleKey', membershipId: 'membership-3', status: 'active' }]);
    const memberSelect = screen.getByLabelText('Member');
    expect(within(memberSelect).getByText('Unknown Role Member — currently someFutureRoleKey')).toBeInTheDocument();
  });
});
