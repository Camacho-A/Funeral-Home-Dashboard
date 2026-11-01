import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesPricingPanel, parseDollarsToCents } from './ServicesPricingPanel';
import { SettingsHub } from '@/app/(portal)/settings/SettingsHub';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { GUS_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { serviceCatalogFixtures, gusServiceCatalogItemId } from '@/services/__mocks__/pricingFixtures';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). Settings › Services & Pricing:
 * the panel lists the org's catalog with "Price not set" for unpriced rows,
 * submits integer cents, is permission-gated, and is linked from the hub.
 */

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});
vi.mock('@/components/modals/ImportHistoricalCaseModal', () => ({ ImportHistoricalCaseModal: () => null }));

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-gus-admin', roleKey: 'administrator', permissions });
}

const gusCatalog = () => serviceCatalogFixtures.filter((i) => i.organizationId === GUS_ORGANIZATION_ID).map((i) => ({ ...i }));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { defaultPrice: number | null };
      const item = gusCatalog().find((i) => url.endsWith(encodeURIComponent(i.id)))!;
      return { ok: true, json: async () => ({ item: { ...item, defaultPrice: body.defaultPrice } }) };
    }
    // A foreign-org row in the response must never be shown.
    return { ok: true, json: async () => ({ catalog: [...gusCatalog(), { ...serviceCatalogFixtures[0] }] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderWithOrg(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={GUS_ORGANIZATION_ID}>{ui}</OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('ServicesPricingPanel', () => {
  it("lists Gus's six services, each showing Price not set, and no other organization's row", async () => {
    mockPermissions(['serviceCatalog.edit']);
    renderWithOrg(<ServicesPricingPanel />);
    expect(await screen.findByText('Cremation with Viewing')).toBeInTheDocument();
    expect(screen.getAllByText('Price not set')).toHaveLength(6);
    expect(screen.getByText('U.S. Veterans, Graveside Burial Service Only (No Viewing)')).toBeInTheDocument();
    expect(screen.getByText(/6 services have no price set/)).toBeInTheDocument();
    expect(screen.queryByText('Weight Surcharge (201–250 lb)')).not.toBeInTheDocument();
  });

  it('saves a dollar price as integer cents for that one item', async () => {
    mockPermissions(['serviceCatalog.edit']);
    renderWithOrg(<ServicesPricingPanel />);
    const input = await screen.findByLabelText('Price for Cremation with Viewing (dollars)');
    fireEvent.change(input, { target: { value: '$4,950.50' } });
    const row = input.closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(url).toBe(`/api/service-catalog/${encodeURIComponent(gusServiceCatalogItemId('CREMATION_WITH_VIEWING'))}`);
    expect(JSON.parse(String(init.body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, defaultPrice: 495_050 });
  });

  it('disables Save for an invalid amount', async () => {
    mockPermissions(['serviceCatalog.edit']);
    renderWithOrg(<ServicesPricingPanel />);
    const input = await screen.findByLabelText('Price for Direct Cremation (dollars)');
    fireEvent.change(input, { target: { value: '-5' } });
    expect(within(input.closest('tr')!).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/Enter a dollar amount/)).toBeInTheDocument();
  });

  it('shows no editor to a caller without serviceCatalog.edit', async () => {
    mockPermissions(['serviceCatalog.read']);
    renderWithOrg(<ServicesPricingPanel />);
    expect(await screen.findByText(/You don.t have access to Services & Pricing/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Price for/)).not.toBeInTheDocument();
  });
});

describe('Settings hub link', () => {
  it('shows Services & Pricing only with serviceCatalog.edit', async () => {
    mockPermissions(['serviceCatalog.edit']);
    const { unmount } = renderWithOrg(<SettingsHub authAdapterMode="mock" />);
    expect(await screen.findByText('Services & Pricing')).toBeInTheDocument();
    unmount();

    mockPermissions(['serviceCatalog.read']);
    renderWithOrg(<SettingsHub authAdapterMode="mock" />);
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Services & Pricing')).not.toBeInTheDocument();
  });
});

describe('parseDollarsToCents', () => {
  it('parses dollars exactly, rejecting negatives, >2 decimals and junk', () => {
    expect(parseDollarsToCents('1234')).toBe(123_400);
    expect(parseDollarsToCents('1234.5')).toBe(123_450);
    expect(parseDollarsToCents('$1,234.56')).toBe(123_456);
    expect(parseDollarsToCents('0.07')).toBe(7);
    expect(parseDollarsToCents('-1')).toBeNull();
    expect(parseDollarsToCents('1.234')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
  });
});
