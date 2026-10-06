import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditServicesModal } from './EditServicesModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import type { CaseOrder, CaseOrderLineItem } from '@/types/caseOrder';

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

function renderModal(options: { order: CaseOrder | null; lineItems?: CaseOrderLineItem[] }) {
  const captured: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
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

async function addCustomItem(description: string, price: string) {
  fireEvent.change(await screen.findByLabelText('Custom item description'), { target: { value: description } });
  fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: price } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Custom Item' }));
}

function saveButton() {
  return screen.getByRole('button', { name: /^(Save|Create)/ });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EditServicesModal — custom item round trip', () => {
  it('sends a newly added custom item in the PATCH body', async () => {
    const captured = renderModal({ order: ORDER });
    await addCustomItem('Extra memorial folder', '45.50');

    // It must be visible in the draft list before saving.
    expect(screen.getAllByText('Extra memorial folder').length).toBeGreaterThan(0);

    fireEvent.click(saveButton());

    await waitFor(() => expect(captured.length).toBe(1));
    expect(captured[0].method).toBe('PATCH');
    const selections = captured[0].body.selections as Record<string, unknown>;
    expect(selections.customItems).toEqual([
      expect.objectContaining({ description: 'Extra memorial folder', amountCents: 4_550 }),
    ]);
  });

  it('includes the custom item in the running total shown before saving', async () => {
    renderModal({ order: ORDER });
    await addCustomItem('Extra memorial folder', '45.50');
    // 89,000 base + 4,550 custom = 93,550 -> $935.50
    expect(screen.getByText('$935.50')).toBeInTheDocument();
  });

  it('carries existing custom items forward when an edit does not touch them', async () => {
    const withCustom: CaseOrderLineItem[] = [
      ...BASE_LINE_ITEMS,
      {
        id: 'li-custom-1',
        organizationId: 'managed-cremations',
        caseOrderId: 'order-1',
        lineKind: 'custom',
        serviceCode: 'custom:li-custom-1',
        description: 'PRIOR REQUEST',
        quantity: 1,
        unitPrice: 2_500,
        lineTotal: 2_500,
        sortOrder: 200_000,
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const captured = renderModal({ order: ORDER, lineItems: withCustom });

    expect((await screen.findAllByText('PRIOR REQUEST')).length).toBeGreaterThan(0);
    fireEvent.click(saveButton());

    await waitFor(() => expect(captured.length).toBe(1));
    const selections = captured[0].body.selections as Record<string, unknown>;
    expect(selections.customItems).toEqual([
      expect.objectContaining({ description: 'PRIOR REQUEST', amountCents: 2_500 }),
    ]);
  });

  it('sends an explicit empty array after the last custom item is removed, so the server clears it', async () => {
    const captured = renderModal({ order: ORDER });
    await addCustomItem('Temporary item', '10.00');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(captured.length).toBe(1));
    const selections = captured[0].body.selections as Record<string, unknown>;
    expect(selections.customItems).toEqual([]);
  });

  it('does not silently discard a typed-but-not-added custom item when Save is pressed', async () => {
    const captured = renderModal({ order: ORDER });
    fireEvent.change(await screen.findByLabelText('Custom item description'), { target: { value: 'Typed but never added' } });
    fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: '30.00' } });
    // Deliberately NOT clicking "Add Custom Item" — the real-world trap.
    fireEvent.click(saveButton());

    await waitFor(() => expect(captured.length).toBe(1));
    const selections = captured[0].body.selections as Record<string, unknown>;
    expect(selections.customItems).toEqual([
      expect.objectContaining({ description: 'Typed but never added', amountCents: 3_000 }),
    ]);
  });

  /**
   * Deliberate, pre-existing design — not a gap. A custom item is an
   * "Additional Items" concept, offered only once a real Case Order exists
   * to attach it to (see ServicesAndChargesSelector's own `customItems`
   * prop comment). Asserted here so the omission stays a decision rather
   * than looking like an oversight, and so first-order setup can never
   * start silently collecting custom items it would not send.
   */
  it('does not offer the custom item section when setting up a first order', async () => {
    const captured = renderModal({ order: null, lineItems: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save/ })).toBeInTheDocument());

    expect(screen.queryByLabelText('Custom item description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Custom Item' })).not.toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(captured.length).toBe(1));
    expect(captured[0].method).toBe('POST');
    expect((captured[0].body.selections as Record<string, unknown>).customItems).toEqual([]);
  });
});
