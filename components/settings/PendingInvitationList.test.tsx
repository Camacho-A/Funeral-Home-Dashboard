import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingInvitationList } from './PendingInvitationList';
import type { PendingInvitation, RbacRole } from '@/lib/identityAuthClient';

const ROLES: RbacRole[] = [
  { id: 'role-admin', key: 'administrator', name: 'Administrator', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
  { id: 'role-manager', key: 'manager', name: 'Manager', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
  { id: 'role-fd', key: 'funeralDirector', name: 'Funeral Director', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
  { id: 'role-office', key: 'officeStaff', name: 'Office Staff', description: '', organizationId: null, isSystemDefault: true, createdAt: '', updatedAt: '', permissions: [] },
];

function invitation(overrides: Partial<PendingInvitation> = {}): PendingInvitation {
  return {
    membershipId: 'membership-1',
    identityId: 'identity-1',
    email: 'invited@example.com',
    displayName: 'Invited Person',
    role: 'officeStaff',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    lastResentAt: null,
    ...overrides,
  };
}

function renderList(invitations: PendingInvitation[], roles: RbacRole[] = ROLES) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingInvitationList organizationId="org-1" invitations={invitations} roles={roles} canInvite={false} />
    </QueryClientProvider>,
  );
}

/**
 * Raw role display fix (2026-10). The Role column used to render the raw
 * internal role key ("officeStaff") directly — now resolved against the
 * same canonical `roles` list every other role display in Settings uses.
 * `invitation.role` itself is never touched — only the rendered text.
 */
describe('PendingInvitationList — role display', () => {
  it('"officeStaff" renders as "Office Staff", never the raw key', async () => {
    renderList([invitation({ role: 'officeStaff' })]);
    expect(await screen.findByText('Office Staff')).toBeInTheDocument();
    expect(screen.queryByText('officeStaff')).not.toBeInTheDocument();
  });

  it('"funeralDirector" renders as "Funeral Director"', async () => {
    renderList([invitation({ role: 'funeralDirector' })]);
    expect(await screen.findByText('Funeral Director')).toBeInTheDocument();
    expect(screen.queryByText('funeralDirector')).not.toBeInTheDocument();
  });

  it('"administrator" renders as "Administrator"', async () => {
    renderList([invitation({ role: 'administrator' })]);
    expect(await screen.findByText('Administrator')).toBeInTheDocument();
  });

  it('"manager" renders as "Manager"', async () => {
    renderList([invitation({ role: 'manager' })]);
    expect(await screen.findByText('Manager')).toBeInTheDocument();
  });

  it('falls back to the raw role key when it matches no known role, rather than hiding it entirely', async () => {
    renderList([invitation({ role: 'someFutureRoleKey' })]);
    expect(await screen.findByText('someFutureRoleKey')).toBeInTheDocument();
  });

  it('no raw camelCase role identifier is ever rendered when the role resolves', async () => {
    renderList([
      invitation({ membershipId: 'm1', role: 'officeStaff', email: 'a@example.com' }),
      invitation({ membershipId: 'm2', role: 'funeralDirector', email: 'b@example.com' }),
      invitation({ membershipId: 'm3', role: 'administrator', email: 'c@example.com' }),
      invitation({ membershipId: 'm4', role: 'manager', email: 'd@example.com' }),
    ]);
    await screen.findByText('Office Staff');
    for (const rawKey of ['officeStaff', 'funeralDirector', 'administrator', 'manager']) {
      // "Administrator" the label contains "administrator" only as a
      // case-sensitive substring once capitalized differently — assert
      // the exact raw lowercase-first key text never appears as its own
      // text node.
      expect(screen.queryByText(rawKey)).not.toBeInTheDocument();
    }
  });
});
