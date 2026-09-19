import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountsPayablePanel } from './AccountsPayablePanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Manors go-live hardening. Production testing showed this panel had no
 * permission gate of its own at all — it rendered the full Accounts
 * Payable workflow (supplier picker, "Enter bill", vendor bill list) for
 * an Office Staff caller after `ap.read` was removed from that role.
 * This test proves the new client-side guard specifically; the
 * suppliers/bills hooks are stubbed so this only exercises the guard.
 */
vi.mock('@/hooks/useProcurement', () => ({
  useSuppliers: () => ({ data: [{ id: 'supplier-1', name: 'Test Supplier' }], isPending: false }),
  useBills: () => ({ data: [], isPending: false }),
  useCreateBill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVoidBill: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let mockPermissions: string[] = [];
vi.mock('@/hooks/useRbac', () => ({
  useMyPermissions: () => ({ data: { identityId: 'identity-test', roleKey: 'test', permissions: mockPermissions }, isPending: false }),
}));

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <AccountsPayablePanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('AccountsPayablePanel — authorization guard (Manors go-live hardening)', () => {
  it('renders a not-authorized state instead of the AP workflow for a caller lacking ap.read', () => {
    mockPermissions = ['case.read', 'case.create', 'case.update'];
    renderPanel();
    expect(screen.getByText("You don't have access to accounts payable for this organization.")).toBeInTheDocument();
    expect(screen.queryByText('New expense bill (non-PO)')).not.toBeInTheDocument();
    expect(screen.queryByText('Select supplier…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter bill' })).not.toBeInTheDocument();
  });

  it('renders a not-authorized state for a Read Only-shaped permission set (ap.read removed — Manors go-live hardening)', () => {
    mockPermissions = ['case.read', 'payment.read', 'procurement.read', 'inventory.read'];
    renderPanel();
    expect(screen.getByText("You don't have access to accounts payable for this organization.")).toBeInTheDocument();
    expect(screen.queryByText('New expense bill (non-PO)')).not.toBeInTheDocument();
  });

  it('renders the AP workflow normally for a caller with ap.read', () => {
    mockPermissions = ['ap.read'];
    renderPanel();
    expect(screen.queryByText("You don't have access to accounts payable for this organization.")).not.toBeInTheDocument();
    expect(screen.getByText('New expense bill (non-PO)')).toBeInTheDocument();
    expect(screen.getByText('Test Supplier')).toBeInTheDocument();
  });
});
