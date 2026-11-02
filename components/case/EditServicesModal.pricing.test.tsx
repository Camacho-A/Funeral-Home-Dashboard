import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditServicesModal } from './EditServicesModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import type { CaseOrder, CaseOrderLineItem } from '@/types/caseOrder';

// An organization on the platform pricing defaults (granular permissions,
// line prices locked) — Manors' legacy behaviour is EditServicesModal.test.tsx.
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) =>
  (await import('@/lib/testing/granularPricingProfile')).withGranularPricing(await importOriginal(), (await import('@/services/__mocks__/organizationIds')).DEFAULT_ORGANIZATION_ID),
);

/**
 * Custom ("Additional") item round-trip (2026-10). EditServicesModal is the
 * only component that wires custom items into the save, and had no test at
 * all — the gap that let a break in that wiring reach production. These
 * tests capture the exact request body the modal sends, since that is the
 * contract the server's own extractCustomItemSelections reads.
 */

const ORDER: CaseOrder = {
  id: 'order-1',
  organizationId: 'managed-cremations',
  caseId: 'case-1',
  status: 'active',
  subtotal: 89_000,
  discountTotal: 0,
  taxTotal: 0,
  total: 89_000,
  balanceDue: 89_000,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_LINE_ITEMS: CaseOrderLineItem[] = [
  {
    id: 'li-1',
    organizationId: 'managed-cremations',
    caseOrderId: 'order-1',
    lineKind: 'service',
    serviceCode: 'DIRECT_CREMATION',
    description: 'Direct Cremation',
    quantity: 1,
    unitPrice: 89_000,
    lineTotal: 89_000,
    sortOrder: 1,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

type Captured = { method: string; body: Record<string, unknown> };

/** Gus Phase 5C-3 (finalization): custom items are an Administrator/Manager
    capability (serviceCatalog.edit). These tests run as such a user unless
    `permissions` says otherwise. */
const MANAGER_PERMISSIONS = [
  'caseOrder.customItems', 'caseOrder.read', 'caseOrder.update', 'serviceCatalog.read', 'serviceCatalog.edit'];

function renderModal(options: { order: CaseOrder | null; lineItems?: CaseOrderLineItem[]; permissions?: string[] }) {
  const captured: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/rbac/my-permissions')) {
        return Promise.resolve({ ok: true, json: async () => ({ identityId: 'staff-1', roleKey: 'manager', permissions: options.permissions ?? MANAGER_PERMISSIONS }) });
      }
      if (url.includes('/service-catalog')) {
        return Promise.resolve({ ok: true, json: async () => ({ catalog: serviceCatalogFixtures }) });
      }
      if (url.includes('/order') && (init?.method === 'POST' || init?.method === 'PATCH')) {
        captured.push({ method: init!.method!, body: JSON.parse(init!.body as string) });
        return Promise.resolve({ ok: true, json: async () => ({ order: ORDER, lineItems: [], auditEntries: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );

  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <EditServicesModal
          caseId="case-1"
          order={options.order}
          lineItems={options.lineItems ?? BASE_LINE_ITEMS}
          open
          onClose={() => {}}
        />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EditServicesModal — saved prices (Gus Phase 5C-3)', () => {
  it("previews an existing order's lines at the prices they were saved with, not today's catalog price", async () => {
    // Saved at $800.00; the catalog row now says $890.00.
    const saved = [{ ...BASE_LINE_ITEMS[0], unitPrice: 80_000, lineTotal: 80_000 }];
    renderModal({ order: { ...ORDER, subtotal: 80_000, total: 80_000, balanceDue: 80_000 }, lineItems: saved });
    expect(await screen.findAllByText('$800.00')).not.toHaveLength(0);
    expect(screen.queryByText('$890.00')).not.toBeInTheDocument();
  });
});

describe('EditServicesModal — custom item permission (Gus Phase 5C-3)', () => {
  const WITH_CUSTOM: CaseOrderLineItem[] = [
    ...BASE_LINE_ITEMS,
    { ...BASE_LINE_ITEMS[0], id: 'li-c', lineKind: 'custom', serviceCode: 'custom:li-c', description: 'EXISTING KEEPSAKE', unitPrice: 2_500, lineTotal: 2_500, sortOrder: 200000 },
  ];

  it('a Funeral Director sees existing custom items read-only, cannot add one', async () => {
    renderModal({ order: ORDER, lineItems: WITH_CUSTOM, permissions: ['caseOrder.read', 'caseOrder.update', 'serviceCatalog.read'] });
    expect(await screen.findByText(/You are not allowed to add, change or remove custom items/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Custom item description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove EXISTING KEEPSAKE' })).not.toBeInTheDocument();
    expect(screen.getAllByText('EXISTING KEEPSAKE').length).toBeGreaterThan(0);
  });

  it('a Manager can add one', async () => {
    renderModal({ order: ORDER });
    expect(await screen.findByLabelText('Custom item description')).toBeInTheDocument();
  });
});
