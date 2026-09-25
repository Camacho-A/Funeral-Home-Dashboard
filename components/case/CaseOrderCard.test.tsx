import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseOrderCard } from './CaseOrderCard';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). CaseOrderCard
 * replaces components/case/PaymentCard.tsx on Case Detail — every fetch it
 * (and the EditServicesModal it renders) makes is intercepted here via a
 * single URL-dispatching global fetch stub, matching the established
 * pattern for component tests that talk to Route Handlers.
 */

type FetchHandlers = {
  order?: { order: unknown; lineItems: unknown[]; auditEntries: unknown[] };
  payments?: unknown[];
  checkout?: { paymentId: string; checkoutUrl: string } | { error: string; status: number };
  manualPayment?: { payment: unknown } | { error: string; status: number };
  onManualPaymentRequest?: (body: unknown) => void;
  /** Manors launch-prep: this card is self-gated on the viewer's own
      caseOrder.read/caseOrder.update/payment.read/payment.collect
      permissions. Defaults to a caller who holds all four, matching every
      pre-existing test's assumption of full access — pass a narrower list
      to test the gated behavior itself. */
  permissions?: string[];
};

function stubFetch(handlers: FetchHandlers) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/rbac/my-permissions')) {
        const permissions = handlers.permissions ?? ['caseOrder.read', 'caseOrder.update', 'payment.read', 'payment.collect'];
        return Promise.resolve({ ok: true, json: async () => ({ identityId: 'staff-1', roleKey: 'administrator', permissions }) });
      }
      if (url.includes('/service-catalog')) {
        return Promise.resolve({ ok: true, json: async () => ({ catalog: serviceCatalogFixtures }) });
      }
      if (url.includes('/payments/clover/checkout') && init?.method === 'POST') {
        const result = handlers.checkout ?? { paymentId: 'payment-1', checkoutUrl: 'https://clover.test/checkout-1' };
        if ('error' in result) {
          return Promise.resolve({ ok: false, status: result.status, json: async () => ({ error: result.error }) });
        }
        return Promise.resolve({ ok: true, json: async () => result });
      }
      if (url.includes('/order') && (!init || init.method === undefined || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => handlers.order ?? { order: null, lineItems: [], auditEntries: [] },
        });
      }
      if (url.includes('/order') && (init?.method === 'POST' || init?.method === 'PATCH')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            order: { id: 'order-new', organizationId: 'org', caseId: 'case-1', status: 'active', subtotal: 89_000, discountTotal: 0, taxTotal: 0, total: 89_000, balanceDue: 89_000, version: 1, createdAt: '', updatedAt: '' },
            lineItems: [],
            auditEntries: [],
          }),
        });
      }
      if (url.includes('/payments/manual') && init?.method === 'POST') {
        if (handlers.onManualPaymentRequest && init?.body) handlers.onManualPaymentRequest(JSON.parse(init.body as string));
        const result = handlers.manualPayment ?? { payment: { id: 'payment-manual-1', status: 'succeeded', provider: 'manual', amount: 118_000, currency: 'usd', purpose: 'Case order balance due', receiptReference: 'Cash', createdAt: '2026-01-01T00:00:00.000Z' } };
        if ('error' in result) {
          return Promise.resolve({ ok: false, status: result.status, json: async () => ({ error: result.error }) });
        }
        return Promise.resolve({ ok: true, json: async () => result });
      }
      if (url.includes('/payments')) {
        return Promise.resolve({ ok: true, json: async () => ({ payments: handlers.payments ?? [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
}

function renderCard(handlers: FetchHandlers = {}) {
  stubFetch(handlers);
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <CaseOrderCard caseId="case-1" caseName="Robert Ellison" caseNumber="B2026-001" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACTIVE_ORDER = {
  id: 'order-1',
  organizationId: 'managed-cremations',
  caseId: 'case-1',
  status: 'active',
  subtotal: 118_000,
  discountTotal: 0,
  taxTotal: 0,
  total: 118_000,
  balanceDue: 118_000,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const LINE_ITEMS = [
  { id: 'li-1', organizationId: 'managed-cremations', caseOrderId: 'order-1', serviceCode: 'DIRECT_CREMATION', description: 'Direct Cremation', quantity: 1, unitPrice: 89_000, lineTotal: 89_000, sortOrder: 1, metadata: null, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'li-2', organizationId: 'managed-cremations', caseOrderId: 'order-1', serviceCode: 'WEIGHT_SURCHARGE_201_250', description: 'Weight Surcharge (201–250 lb)', quantity: 1, unitPrice: 29_000, lineTotal: 29_000, sortOrder: 2, metadata: null, createdAt: '2026-01-01T00:00:00.000Z' },
];

describe('CaseOrderCard — no order yet', () => {
  it('shows an empty state and a "Set Up Services & Charges" action', async () => {
    renderCard({ order: { order: null, lineItems: [], auditEntries: [] } });
    expect(await screen.findByText('No case order yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set Up Services & Charges' })).toBeInTheDocument();
  });

  it('never renders a "Collect Balance with Clover" button with no order', async () => {
    renderCard({ order: { order: null, lineItems: [], auditEntries: [] } });
    await screen.findByText('No case order yet.');
    expect(screen.queryByRole('button', { name: 'Collect Balance with Clover' })).not.toBeInTheDocument();
  });
});

describe('CaseOrderCard — itemized services, balance, status', () => {
  it('renders line items, total, and balance due', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    expect(await screen.findByText('Direct Cremation')).toBeInTheDocument();
    expect(screen.getByText(/Weight Surcharge/)).toBeInTheDocument();
    expect(screen.getAllByText('$1,180.00').length).toBeGreaterThan(0); // total and balance due, both $1,180
    expect(screen.getAllByText('Balance due').length).toBeGreaterThan(0); // badge + row label
  });

  it('shows "Paid in full" once balanceDue reaches 0', async () => {
    renderCard({ order: { order: { ...ACTIVE_ORDER, balanceDue: 0 }, lineItems: LINE_ITEMS, auditEntries: [] } });
    expect(await screen.findByText('Paid in full')).toBeInTheDocument();
  });

  it('disables "Collect Balance with Clover" once the balance reaches 0', async () => {
    renderCard({ order: { order: { ...ACTIVE_ORDER, balanceDue: 0 }, lineItems: LINE_ITEMS, auditEntries: [] } });
    await screen.findByText('Paid in full');
    expect(screen.getByRole('button', { name: 'Collect Balance with Clover' })).toBeDisabled();
  });

  it('Phase 37: shows a variant merchandise line with its variant name in the description', async () => {
    const variantLines = [
      { id: 'li-m', organizationId: 'managed-cremations', caseOrderId: 'order-1', lineKind: 'merchandise', serviceCode: 'URN-BRZ', description: 'Bronze Urn — Companion', quantity: 2, unitPrice: 50_000, lineTotal: 100_000, sortOrder: 100000, metadata: { productId: 'p1', variantId: 'v1', sku: 'URN-BRZ', locationId: 'loc-1' }, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    renderCard({ order: { order: { ...ACTIVE_ORDER, subtotal: 100_000, total: 100_000, balanceDue: 100_000 }, lineItems: variantLines, auditEntries: [] } });
    expect(await screen.findByText(/Bronze Urn — Companion/)).toBeInTheDocument();
  });
});

describe('CaseOrderCard — Collect Balance with Clover', () => {
  it('never shows an amount input — the balance is always server-derived', async () => {
    const { container } = renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    await screen.findByText('Direct Cremation');
    expect(container.querySelectorAll('input[aria-label*="Amount" i]')).toHaveLength(0);
    expect(screen.queryByPlaceholderText(/amount due/i)).not.toBeInTheDocument();
  });

  it('redirects to the returned checkoutUrl on success', async () => {
    const originalLocation = window.location;
    // @ts-expect-error — redefining window.location for a redirect assertion
    delete window.location;
    // @ts-expect-error — partial Location stand-in
    window.location = { href: '' };

    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    await screen.findByText('Direct Cremation');
    fireEvent.click(screen.getByRole('button', { name: 'Collect Balance with Clover' }));

    await waitFor(() => expect(window.location.href).toBe('https://clover.test/checkout-1'));

    // @ts-expect-error — restoring the real window.location
    window.location = originalLocation;
  });

  it('surfaces an error message when the checkout fails (e.g. no remaining balance)', async () => {
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      checkout: { error: 'This case order has no remaining balance to collect.', status: 400 },
    });
    await screen.findByText('Direct Cremation');
    fireEvent.click(screen.getByRole('button', { name: 'Collect Balance with Clover' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no remaining balance/i);
  });
});

describe('CaseOrderCard — payment history', () => {
  it('shows an empty state when there is no payment history', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] }, payments: [] });
    expect(await screen.findByText('No payments recorded yet.')).toBeInTheDocument();
  });

  it('renders each payment record with status/amount/purpose', async () => {
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [
        {
          id: 'p1', organizationId: 'managed-cremations', caseId: 'case-1', caseOrderId: 'order-1', provider: 'clover',
          providerCheckoutId: 'c1', providerPaymentId: 'pp1', idempotencyKey: 'k1', checkoutUrl: null,
          status: 'succeeded', amount: 50_000, currency: 'usd', purpose: 'Deposit', cardBrand: 'visa', cardLast4: '4242',
          receiptReference: null, failureCode: null, failureMessage: null,
          createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('Deposit')).toBeInTheDocument();
    expect(screen.getByText(/visa/)).toBeInTheDocument();
  });

  it('renders a manual payment\'s receiptReference (method/reference) in place of a card', async () => {
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [
        {
          id: 'p2', organizationId: 'managed-cremations', caseId: 'case-1', caseOrderId: 'order-1', provider: 'manual',
          providerCheckoutId: 'manual:p2', providerPaymentId: null, idempotencyKey: 'k2', checkoutUrl: null,
          status: 'succeeded', amount: 50_000, currency: 'usd', purpose: 'Case order balance due', cardBrand: null, cardLast4: null,
          receiptReference: 'Check — 1234', failureCode: null, failureMessage: null,
          createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(await screen.findByText('Check — 1234')).toBeInTheDocument();
  });
});

describe('CaseOrderCard — Record Payment (manual)', () => {
  it('shows a "Record Payment" button alongside Collect Balance with Clover', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    expect(await screen.findByRole('button', { name: 'Collect Balance with Clover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeInTheDocument();
  });

  it('opens an inline form pre-filled with the balance due, and submits cash/check with the entered amount', async () => {
    let requestBody: unknown = null;
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      onManualPaymentRequest: (body) => {
        requestBody = body;
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Payment' }));
    expect(screen.getByText('Record a payment')).toBeInTheDocument();
    // pre-filled with the full balance due ($1,180.00)
    const amountInput = screen.getByDisplayValue('1180.00');
    fireEvent.change(amountInput, { target: { value: '500' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Payment' }));

    await waitFor(() => expect(requestBody).not.toBeNull());
    expect(requestBody).toMatchObject({ method: 'check', amountCents: 50_000 });
  });

  it('closes the form and refreshes payment history after a successful manual payment', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Record Payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Payment' }));
    await waitFor(() => expect(screen.queryByText('Record a payment')).not.toBeInTheDocument());
  });

  it('disables Record Payment when there is no remaining balance', async () => {
    renderCard({ order: { order: { ...ACTIVE_ORDER, balanceDue: 0 }, lineItems: LINE_ITEMS, auditEntries: [] } });
    expect(await screen.findByRole('button', { name: 'Record Payment' })).toBeDisabled();
  });
});

describe('CaseOrderCard — Additional Items & Services / Set Up Services & Charges', () => {
  it('opens EditServicesModal prefilled from the current order\'s selections when editing (Manors label: "Additional Items & Services")', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    await screen.findByText('Direct Cremation');
    fireEvent.click(screen.getByRole('button', { name: 'Additional Items & Services' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Prefilled from LINE_ITEMS: the 201–250 lb radio should be checked.
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const checkedRadio = radios.find((r) => r.checked);
    expect(checkedRadio).toBeDefined();
  });

  it('opens a "Set Up Services & Charges" modal (create path) when there is no order yet — never relabeled, even for Manors', async () => {
    renderCard({ order: { order: null, lineItems: [], auditEntries: [] } });
    await screen.findByText('No case order yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Set Up Services & Charges' }));
    expect(await screen.findByRole('dialog', { name: 'Set Up Services & Charges' })).toBeInTheDocument();
  });

  it('saving from the modal closes it', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    await screen.findByText('Direct Cremation');
    fireEvent.click(screen.getByRole('button', { name: 'Additional Items & Services' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('19: shows "Additional Items & Services" for Manors, with the supporting text, on an existing order', async () => {
    renderCard({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    await screen.findByText('Direct Cremation');
    fireEvent.click(screen.getByRole('button', { name: 'Additional Items & Services' }));
    expect(await screen.findByRole('dialog', { name: 'Additional Items & Services' })).toBeInTheDocument();
    expect(screen.getByText('Add items or services the family requests after the original arrangements.')).toBeInTheDocument();
  });

  it('C2/C1 scope: a non-Manors organization keeps the plain "Edit Services" label — this is Manors-specific terminology, not a platform-wide rename', async () => {
    stubFetch({ order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] } });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider organizationId="some-other-funeral-home">
          <CaseOrderCard caseId="case-1" caseName="Robert Ellison" caseNumber="B2026-001" />
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Direct Cremation');
    expect(screen.getByRole('button', { name: 'Edit Services' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Additional Items & Services' })).not.toBeInTheDocument();
  });
});

describe('CaseOrderCard — permission gating (Manors launch-prep)', () => {
  it('renders nothing at all for a caller without caseOrder.read', async () => {
    const { container } = renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [],
      permissions: [],
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText('Case Order')).not.toBeInTheDocument();
    expect(screen.queryByText('Direct Cremation')).not.toBeInTheDocument();
  });

  it('shows line items (operational add-ons) for caseOrder.read alone — no financial totals, no Additional Items & Services, no payment actions', async () => {
    // The exact "normal employee without payment access" case: officeStaff
    // holds caseOrder.read but neither caseOrder.update nor any payment.*
    // key — must still see what's on the order, just not touch pricing or
    // money. This is the whole point of splitting the gate three ways.
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [],
      permissions: ['caseOrder.read'],
    });
    expect(await screen.findByText('Direct Cremation')).toBeInTheDocument();
    expect(screen.queryByText('Balance due')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Additional Items & Services' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collect Balance with Clover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
  });

  it('additionally shows "Additional Items & Services" for caseOrder.read + caseOrder.update — additional case charges must stay addable without financial access', async () => {
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [],
      permissions: ['caseOrder.read', 'caseOrder.update'],
    });
    expect(await screen.findByText('Direct Cremation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Additional Items & Services' })).toBeInTheDocument();
    expect(screen.queryByText('Balance due')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collect Balance with Clover' })).not.toBeInTheDocument();
  });

  it('additionally shows totals, balance, and payment history for caseOrder.read + payment.read — but still not the action buttons without payment.collect', async () => {
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [],
      permissions: ['caseOrder.read', 'payment.read'],
    });
    expect(await screen.findByText('Direct Cremation')).toBeInTheDocument();
    expect(screen.getAllByText('Balance due').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Additional Items & Services' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collect Balance with Clover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
  });

  it('shows everything for a caller with all four permissions', async () => {
    renderCard({
      order: { order: ACTIVE_ORDER, lineItems: LINE_ITEMS, auditEntries: [] },
      payments: [],
      permissions: ['caseOrder.read', 'caseOrder.update', 'payment.read', 'payment.collect'],
    });
    expect(await screen.findByText('Direct Cremation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Additional Items & Services' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collect Balance with Clover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeInTheDocument();
  });
});
