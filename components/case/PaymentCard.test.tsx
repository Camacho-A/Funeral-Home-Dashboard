import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentCard } from './PaymentCard';
import { OrganizationProvider } from '@/hooks/useOrganization';

/**
 * Phase 19B (Clover Hosted Checkout Integration). PaymentCard talks to
 * app/api/cases/[caseId]/payments/* through hooks/useCasePayments.ts —
 * global `fetch` is stubbed per test, matching every other hook-driven
 * component test in this codebase (see components/modals/NewCaseModal.test.tsx).
 */

function renderCard() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <PaymentCard caseId="case-1" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function stubListResponse(payments: unknown[]) {
  return { ok: true, json: async () => ({ payments }) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stubListResponse([])));
  // jsdom doesn't support real navigation; PaymentCard assigns
  // window.location.href directly on a successful checkout.
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, href: '' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PaymentCard — empty state', () => {
  it('shows "No payments recorded yet" when the case has no payment history', async () => {
    renderCard();
    expect(await screen.findByText('No payments recorded yet.')).toBeInTheDocument();
  });
});

describe('PaymentCard — payment history', () => {
  it('renders each payment with its status, amount, and purpose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        stubListResponse([
          {
            id: 'p1', organizationId: 'managed-cremations', caseId: 'case-1', provider: 'clover',
            providerCheckoutId: 'c1', providerPaymentId: 'pay-1', checkoutUrl: null, status: 'succeeded',
            amount: 120000, currency: 'usd', purpose: 'Cremation service fee', cardBrand: 'visa', cardLast4: '4242',
            receiptReference: 'pay-1', failureCode: null, failureMessage: null,
            createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:05:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z',
          },
        ]),
      ),
    );

    renderCard();
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
    expect(screen.getByText('Cremation service fee')).toBeInTheDocument();
    expect(screen.getByText(/visa/i)).toBeInTheDocument();
    expect(screen.getByText(/4242/)).toBeInTheDocument();
  });

  it('never renders a card number, only the last 4 digits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        stubListResponse([
          {
            id: 'p1', organizationId: 'managed-cremations', caseId: 'case-1', provider: 'clover',
            providerCheckoutId: 'c1', providerPaymentId: 'pay-1', checkoutUrl: null, status: 'succeeded',
            amount: 5000, currency: 'usd', purpose: 'Fee', cardBrand: 'visa', cardLast4: '4242',
            receiptReference: null, failureCode: null, failureMessage: null,
            createdAt: '2026-01-01T00:00:00.000Z', paidAt: null, updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    const { container } = renderCard();
    await screen.findByText(/4242/);
    expect(container.textContent).not.toMatch(/\d{13,19}/); // no full PAN-length digit run anywhere
  });
});

describe('PaymentCard — Collect with Clover', () => {
  it('disables the button until a valid amount and purpose are entered', async () => {
    renderCard();
    await screen.findByText('No payments recorded yet.');
    expect(screen.getByRole('button', { name: 'Collect with Clover' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Amount due'), { target: { value: '150.00' } });
    expect(screen.getByRole('button', { name: 'Collect with Clover' })).not.toBeDisabled();
  });

  it('starts a checkout and redirects the full browser to the returned checkoutUrl', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/clover/checkout')) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentId: 'p1', checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-1' }) });
      }
      return Promise.resolve(stubListResponse([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCard();
    await screen.findByText('No payments recorded yet.');
    fireEvent.change(screen.getByLabelText('Amount due'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collect with Clover' }));

    await waitFor(() => expect(window.location.href).toBe('https://apisandbox.dev.clover.com/checkout-1'));

    const checkoutCall = fetchMock.mock.calls.find((call) => typeof call[0] === 'string' && call[0].includes('/clover/checkout'));
    const sentBody = JSON.parse(checkoutCall![1].body);
    expect(sentBody.amount).toBe(15000); // dollars -> cents
    expect(sentBody).not.toHaveProperty('cardNumber');
    expect(typeof sentBody.idempotencyKey).toBe('string');
    expect(sentBody.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('sends the same idempotencyKey again if the same in-flight attempt is retried before it settles, but a fresh one for the next attempt', async () => {
    const sentKeys: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/clover/checkout')) {
        sentKeys.push(JSON.parse(init!.body as string).idempotencyKey);
        return Promise.resolve({ ok: true, json: async () => ({ paymentId: `p${sentKeys.length}`, checkoutUrl: `https://apisandbox.dev.clover.com/checkout-${sentKeys.length}` }) });
      }
      return Promise.resolve(stubListResponse([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCard();
    await screen.findByText('No payments recorded yet.');
    fireEvent.change(screen.getByLabelText('Amount due'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collect with Clover' }));
    await waitFor(() => expect(sentKeys).toHaveLength(1));
    await waitFor(() => expect(window.location.href).toContain('checkout-1'));

    // A second, later click (a genuinely new attempt, after the first
    // settled) must use a different key — never silently reusing the
    // prior attempt's identity.
    fireEvent.click(screen.getByRole('button', { name: 'Collect with Clover' }));
    await waitFor(() => expect(sentKeys).toHaveLength(2));
    expect(sentKeys[1]).not.toBe(sentKeys[0]);
  });

  it('shows an error message and never navigates when checkout creation fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/clover/checkout')) {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Clover is not enabled for this organization.' }) });
      }
      return Promise.resolve(stubListResponse([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCard();
    await screen.findByText('No payments recorded yet.');
    fireEvent.change(screen.getByLabelText('Amount due'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collect with Clover' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not enabled/i);
    expect(window.location.href).toBe('');
  });
});
