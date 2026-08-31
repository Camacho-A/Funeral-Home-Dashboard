import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VariantsPanel } from './VariantsPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as merchClient from '@/lib/merchandiseClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { MerchandiseProductVariant } from '@/types/merchandiseProductVariant';

vi.mock('@/lib/merchandiseClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/merchandiseClient')>('@/lib/merchandiseClient');
  return { ...actual, fetchVariants: vi.fn(), createVariant: vi.fn(), archiveVariant: vi.fn() };
});

const VARIANT: MerchandiseProductVariant = {
  id: 'v1', organizationId: DEFAULT_ORGANIZATION_ID, productId: 'p1', sku: 'URN-BRZ', name: 'Bronze',
  optionValues: JSON.stringify({ Material: 'Bronze' }), retailPriceOverride: 60_000, costOverride: null,
  taxableOverride: null, supplierIdOverride: null, isActive: true, createdAt: 't', updatedAt: 't',
};

function renderPanel() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <VariantsPanel productId="p1" productName="Urn" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('VariantsPanel', () => {
  it('lists variants with inherited/overridden pricing labels', async () => {
    vi.mocked(merchClient.fetchVariants).mockResolvedValue([VARIANT]);
    renderPanel();
    expect(await screen.findByText('Bronze', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/URN-BRZ/)).toBeInTheDocument();
    expect(screen.getByText(/price \$600\.00/)).toBeInTheDocument();
  });

  it('creates a variant, converting a dollar override to cents and parsing options', async () => {
    vi.mocked(merchClient.fetchVariants).mockResolvedValue([]);
    vi.mocked(merchClient.createVariant).mockResolvedValue(VARIANT);
    renderPanel();
    await screen.findByText(/No variants yet/);
    fireEvent.change(screen.getByPlaceholderText('SKU'), { target: { value: 'URN-SLV' } });
    fireEvent.change(screen.getByPlaceholderText(/^Name/), { target: { value: 'Silver' } });
    fireEvent.change(screen.getByPlaceholderText(/^Options/), { target: { value: 'Material=Silver, Size=Companion' } });
    fireEvent.change(screen.getByPlaceholderText(/Retail price override/), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Variant' }));
    await waitFor(() => expect(merchClient.createVariant).toHaveBeenCalledWith('p1', expect.objectContaining({
      sku: 'URN-SLV', name: 'Silver', optionValues: { Material: 'Silver', Size: 'Companion' }, retailPriceOverride: 5_500,
    })));
  });

  it('surfaces a server error (e.g. duplicate SKU / archive-blocked)', async () => {
    vi.mocked(merchClient.fetchVariants).mockResolvedValue([VARIANT]);
    vi.mocked(merchClient.archiveVariant).mockRejectedValue(new Error('Cannot archive a variant that still holds stock or active reservations.'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/still holds stock/);
  });
});
