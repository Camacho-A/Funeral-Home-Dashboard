import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriceCatalogPanel } from './PriceCatalogPanel';
import { parseDollarsToCents } from './CatalogItemEditorModal';
import { SettingsHub } from '@/app/(portal)/settings/SettingsHub';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { GUS_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { serviceCatalogFixtures, serviceCatalogCategoryFixtures, gusCatalogCategoryId } from '@/services/__mocks__/pricingFixtures';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Settings › Price
 * Catalog: onboarding guidance on an empty catalog, administrator-only
 * controls (staff see it read-only), search and filters, and the add/edit
 * form submitting integer cents with the item's revision. The server is the
 * real boundary (see app/api/service-catalog/priceCatalog.routes.test.ts).
 */

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});
vi.mock('@/components/modals/ImportHistoricalCaseModal', () => ({ ImportHistoricalCaseModal: () => null }));

const ADMIN = ['serviceCatalog.read', 'serviceCatalog.edit', 'organization.manage'];
const STAFF = ['serviceCatalog.read'];
function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-gus-admin', roleKey: 'administrator', permissions });
}

const DEMO_ITEMS: ServiceCatalogItem[] = [
  {
    id: 'catalog-item-1',
    organizationId: GUS_ORGANIZATION_ID,
    serviceCode: 'DEMO_COPY',
    displayName: 'DEMO Certified Copy',
    description: 'Fictional test item',
    category: 'catalog_item',
    categoryId: gusCatalogCategoryId('Documents and Permits'),
    pricingType: 'per_unit',
    defaultPrice: 2_550,
    isActive: true,
    sortOrder: 1000,
    revision: 3,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'catalog-item-2',
    organizationId: GUS_ORGANIZATION_ID,
    serviceCode: 'DEMO_RETIRED',
    displayName: 'DEMO Retired Urn',
    category: 'catalog_item',
    categoryId: gusCatalogCategoryId('Merchandise'),
    pricingType: 'flat',
    defaultPrice: 10_000,
    isActive: false,
    sortOrder: 1010,
    revision: 0,
    createdAt: '',
    updatedAt: '',
  },
];

let extraItems: ServiceCatalogItem[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
const gusCatalog = () => [...serviceCatalogFixtures.filter((i) => i.organizationId === GUS_ORGANIZATION_ID), ...extraItems].map((i) => ({ ...i }));
const gusCategories = () => serviceCatalogCategoryFixtures.filter((c) => c.organizationId === GUS_ORGANIZATION_ID).map((c) => ({ ...c }));

beforeEach(() => {
  extraItems = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ item: gusCatalog()[0] }) };
    }
    // A foreign-organization row in the response must never be shown.
    return { ok: true, status: 200, json: async () => ({ catalog: [...gusCatalog(), { ...serviceCatalogFixtures[0] }], categories: gusCategories() }) };
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

const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH');

describe('PriceCatalogPanel', () => {
  it("starts with onboarding guidance, the six unpriced primary services and the suggested categories — and no other organization's row", async () => {
    mockPermissions(ADMIN);
    renderWithOrg(<PriceCatalogPanel />);
    expect(await screen.findByText('Cremation with Viewing')).toBeInTheDocument();
    expect(screen.getByText(/Getting started/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is priced automatically/)).toBeInTheDocument();
    expect(screen.getAllByText('Price not set')).toHaveLength(6);
    expect(screen.getByText('DIRECT_ENTOMBMENT')).toBeInTheDocument();
    expect(screen.getByText(/6 active items have no price set/)).toBeInTheDocument();
    expect(screen.queryByText('Weight Surcharge (201–250 lb)')).not.toBeInTheDocument();
    const categories = screen.getByRole('heading', { name: 'Categories' }).closest('section')!;
    expect(within(categories).getByText('Documents and Permits')).toBeInTheDocument();
  });

  it('staff with serviceCatalog.read see it read-only — no add, edit, deactivate or category controls', async () => {
    mockPermissions(STAFF);
    extraItems = DEMO_ITEMS;
    renderWithOrg(<PriceCatalogPanel />);
    expect(await screen.findByText('DEMO Certified Copy')).toBeInTheDocument();
    expect(screen.getByText(/Only an administrator can change it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument();
  });

  it('a member without serviceCatalog.read is told so', async () => {
    mockPermissions([]);
    renderWithOrg(<PriceCatalogPanel />);
    expect(await screen.findByText(/You don.t have access to the Price Catalog/)).toBeInTheDocument();
  });

  it('searches by name or code and filters by category and status', async () => {
    mockPermissions(ADMIN);
    extraItems = DEMO_ITEMS;
    renderWithOrg(<PriceCatalogPanel />);
    expect(await screen.findByText('DEMO Certified Copy')).toBeInTheDocument();
    expect(screen.queryByText('DEMO Retired Urn')).not.toBeInTheDocument(); // inactive hidden by default
    expect(screen.getByText('$25.50 each')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    expect(screen.getByText('DEMO Retired Urn')).toBeInTheDocument();
    expect(screen.queryByText('DEMO Certified Copy')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate DEMO Retired Urn' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search the catalog'), { target: { value: 'demo_cop' } });
    expect(screen.getByText('DEMO Certified Copy')).toBeInTheDocument();
    expect(screen.queryByText('Direct Cremation')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search the catalog'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: gusCatalogCategoryId('Merchandise') } });
    expect(screen.getByText('DEMO Retired Urn')).toBeInTheDocument();
    expect(screen.queryByText('DEMO Certified Copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Direct Cremation')).not.toBeInTheDocument();
  });

  it('adds an item: code upper-cased, price sent as integer cents, blank price = not set', async () => {
    mockPermissions(ADMIN);
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Item code'), { target: { value: 'demo_transport' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'DEMO Transport' } });
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: gusCatalogCategoryId('Transportation') } });
    fireEvent.change(within(dialog).getByLabelText(/^Price/), { target: { value: '$1,234.56' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Item' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [url, init] = writes()[0];
    expect(url).toBe('/api/service-catalog');
    expect(JSON.parse(String(init.body))).toEqual({
      organizationId: GUS_ORGANIZATION_ID,
      itemCode: 'DEMO_TRANSPORT',
      displayName: 'DEMO Transport',
      description: null,
      categoryId: gusCatalogCategoryId('Transportation'),
      pricingType: 'flat',
      defaultPrice: 123_456,
      ftcClass: null,
    });
  });

  it('refuses to submit an invalid code or price', async () => {
    mockPermissions(ADMIN);
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Item code'), { target: { value: 'bad code' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'X' } });
    expect(within(dialog).getByRole('button', { name: 'Add Item' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Item code'), { target: { value: 'GOOD_CODE' } });
    fireEvent.change(within(dialog).getByLabelText(/^Price/), { target: { value: '-5' } });
    expect(within(dialog).getByText(/Enter a dollar amount/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Item' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("edits a primary service's price, sending only what changed and the item's revision; the code can't be edited", async () => {
    mockPermissions(ADMIN);
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Direct Cremation' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('textbox', { name: 'Item code' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('DIRECT_CREMATION')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Price/), { target: { value: '100' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [url, init] = writes()[0];
    expect(url).toBe(`/api/service-catalog/${encodeURIComponent('gus-camacho-jr-svc-direct-cremation')}`);
    expect(JSON.parse(String(init.body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, expectedRevision: 0, defaultPrice: 10_000 });
  });

  it('an added item deactivates directly, sending its revision', async () => {
    mockPermissions(ADMIN);
    extraItems = DEMO_ITEMS;
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate DEMO Certified Copy' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1].body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, expectedRevision: 3, isActive: false });
  });

  it('deactivating a primary service asks for confirmation with a warning, then sends the confirmation flag; Cancel sends nothing', async () => {
    mockPermissions(ADMIN);
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Direct Cremation' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('removes it from the services staff can choose for NEW cases');
    expect(dialog).toHaveTextContent('workflow assignment are unchanged');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(writes()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Direct Cremation' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate service' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1].body))).toEqual({
      organizationId: GUS_ORGANIZATION_ID,
      expectedRevision: 0,
      isActive: false,
      confirmPrimaryServiceDeactivation: true,
    });
  });

  it('an inactive primary service is labelled, and reactivates without a confirmation', async () => {
    mockPermissions(ADMIN);
    extraItems = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? { ok: true, status: 200, json: async () => ({ item: gusCatalog()[0] }) }
        : {
            ok: true,
            status: 200,
            json: async () => ({ catalog: gusCatalog().map((i) => (i.serviceCode === 'DIRECT_ENTOMBMENT' ? { ...i, isActive: false } : i)), categories: gusCategories() }),
          },
    );
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'inactive' } });
    expect(screen.getByText(/Not offered for new cases\. Existing cases are unaffected\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reactivate Direct Entombment/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1].body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, expectedRevision: 0, isActive: true });
  });

  it('shows each item’s FTC classification, flags pending review, and lets an administrator set it', async () => {
    mockPermissions(ADMIN);
    extraItems = [{ ...DEMO_ITEMS[0], ftcClass: 'cash_advance' }];
    renderWithOrg(<PriceCatalogPanel />);
    expect(await screen.findByText('Cash advance')).toBeInTheDocument();
    expect(screen.getAllByText('Pending review')).toHaveLength(6);
    expect(screen.getByText(/6 active items are pending FTC classification review/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Direct Cremation' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('FTC classification')).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText('FTC classification'), { target: { value: 'basic_services_fee' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1].body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, expectedRevision: 0, ftcClass: 'basic_services_fee' });
  });

  it('shows a linked item’s inventory record, stock and price read-only, and offers only unlinked active non-variant products to link', async () => {
    mockPermissions([...ADMIN, 'merchandise.read', 'inventory.read']);
    const product = (id: string, overrides: Record<string, unknown> = {}) => ({
      id, organizationId: GUS_ORGANIZATION_ID, sku: `DEMO-${id}`, name: `DEMO Urn ${id}`, description: null, category: 'urn', cost: 0, retailPrice: 45_000,
      taxable: false, isActive: true, trackInventory: true, reorderPoint: null, defaultLocationId: null, imageStorageKey: null, familyVisible: false,
      supplierName: null, supplierId: null, parentProductId: null, hasVariants: false, createdAt: '', updatedAt: '', ...overrides,
    });
    const products = [product('p1'), product('p2'), product('p3', { isActive: false }), product('p4', { hasVariants: true })];
    extraItems = [{ ...DEMO_ITEMS[0], serviceCode: 'DEMO_URN', displayName: 'DEMO Linked Urn', defaultPrice: null, merchandiseProductId: 'p1' }, { ...DEMO_ITEMS[0], id: 'catalog-item-9', serviceCode: 'DEMO_LOOSE', displayName: 'DEMO Loose Item', merchandiseProductId: null }];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method) return { ok: true, status: 200, json: async () => ({ item: gusCatalog()[0] }) };
      if (url.startsWith('/api/merchandise/products')) return { ok: true, status: 200, json: async () => ({ products }) };
      if (url.startsWith('/api/inventory')) {
        return { ok: true, status: 200, json: async () => ({ balances: [
          { id: 'b1', organizationId: GUS_ORGANIZATION_ID, productId: 'p1', variantId: null, locationId: 'l1', onHand: 4, reserved: 1, updatedAt: '' },
          { id: 'b2', organizationId: GUS_ORGANIZATION_ID, productId: 'p1', variantId: null, locationId: 'l2', onHand: 2, reserved: 0, updatedAt: '' },
        ] }) };
      }
      return { ok: true, status: 200, json: async () => ({ catalog: gusCatalog(), categories: gusCategories() }) };
    });
    renderWithOrg(<PriceCatalogPanel />);
    expect(await screen.findByText(/On hand 6 · Reserved 1 · Available 5/)).toBeInTheDocument();
    expect(screen.getByText(/Inventory: DEMO Urn p1 \(DEMO-p1\)/)).toBeInTheDocument();
    expect(screen.getByText('$450.00 (inventory record)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit DEMO Loose Item' }));
    const dialog = await screen.findByRole('dialog');
    const options = within(within(dialog).getByLabelText('Inventory record (merchandise)')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Not linked', 'DEMO Urn p2 (DEMO-p2)']);
    fireEvent.change(within(dialog).getByLabelText('Inventory record (merchandise)'), { target: { value: 'p2' } });
    expect(within(dialog).getByLabelText(/^Price/)).toBeDisabled();
    expect(within(dialog).getByText(/Price from the inventory record: \$450\.00/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1].body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, expectedRevision: 3, defaultPrice: null, merchandiseProductId: 'p2' });
  });

  it('shows the server’s refusal (e.g. someone else saved first)', async () => {
    mockPermissions(ADMIN);
    extraItems = DEMO_ITEMS;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? { ok: false, status: 409, json: async () => ({ error: 'This catalog entry was changed by someone else since you opened it.', reason: 'revision_conflict' }) }
        : { ok: true, status: 200, json: async () => ({ catalog: gusCatalog(), categories: gusCategories() }) },
    );
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate DEMO Certified Copy' }));
    expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument();
  });

  it('adds a category', async () => {
    mockPermissions(ADMIN);
    renderWithOrg(<PriceCatalogPanel />);
    fireEvent.change(await screen.findByLabelText('New category name'), { target: { value: 'DEMO Keepsakes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/api/service-catalog/categories');
    expect(JSON.parse(String(writes()[0][1].body))).toEqual({ organizationId: GUS_ORGANIZATION_ID, name: 'DEMO Keepsakes' });
  });
});

describe('Settings hub link', () => {
  it('shows Price Catalog to anyone holding serviceCatalog.read', async () => {
    mockPermissions(STAFF);
    const { unmount } = renderWithOrg(<SettingsHub authAdapterMode="mock" />);
    expect(await screen.findByText('Price Catalog')).toBeInTheDocument();
    unmount();

    mockPermissions([]);
    renderWithOrg(<SettingsHub authAdapterMode="mock" />);
    await waitFor(() => expect(identityAuthClient.fetchMyPermissions).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Price Catalog')).not.toBeInTheDocument();
  });
});

describe('parseDollarsToCents', () => {
  it('parses dollars exactly, rejecting negatives, >2 decimals, junk and absurd amounts', () => {
    expect(parseDollarsToCents('1234')).toBe(123_400);
    expect(parseDollarsToCents('1234.5')).toBe(123_450);
    expect(parseDollarsToCents('$1,234.56')).toBe(123_456);
    expect(parseDollarsToCents('0.07')).toBe(7);
    expect(parseDollarsToCents('-1')).toBeNull();
    expect(parseDollarsToCents('1.234')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('1000000.01')).toBeNull();
  });
});
