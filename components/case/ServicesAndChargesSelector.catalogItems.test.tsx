import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ServicesAndChargesSelector } from './ServicesAndChargesSelector';
import { serviceCatalogFixtures, serviceCatalogCategoryFixtures, gusCatalogCategoryId } from '@/services/__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { ServiceSelections } from '@/types/caseOrder';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). The "Catalog Items"
 * group on a case order: active items grouped by category, a quantity
 * stepper for per-unit items and Add/Remove for flat ones, catalog prices in
 * the Live Itemized Summary — and nothing new for an organization with no
 * catalog items (Manors). Fictional DEMO prices.
 */

const SELECTIONS: ServiceSelections = {
  serviceTypeCode: 'DIRECT_CREMATION',
  weightTier: 'under_200',
  extraDeathCertificateQuantity: 0,
  mailCremated: false,
  keepsakeTransferQuantity: 0,
  urnTransfer: false,
  shipping: false,
};

const item = (overrides: Partial<ServiceCatalogItem>): ServiceCatalogItem => ({
  id: `item-${overrides.serviceCode}`,
  organizationId: GUS_ORGANIZATION_ID,
  serviceCode: 'X',
  displayName: 'X',
  category: 'catalog_item',
  pricingType: 'flat',
  defaultPrice: 1_000,
  isActive: true,
  sortOrder: 1000,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const CATALOG: ServiceCatalogItem[] = [
  ...serviceCatalogFixtures.filter((i) => i.organizationId === GUS_ORGANIZATION_ID).map((i) => (i.serviceCode === 'DIRECT_CREMATION' ? { ...i, defaultPrice: 100_000 } : i)),
  item({ serviceCode: 'DEMO_COPY', displayName: 'DEMO Certified Copy', pricingType: 'per_unit', defaultPrice: 2_550, categoryId: gusCatalogCategoryId('Documents and Permits') }),
  item({ serviceCode: 'DEMO_TRANSPORT', displayName: 'DEMO Transport', defaultPrice: 12_345, categoryId: gusCatalogCategoryId('Transportation'), sortOrder: 1010 }),
  item({ serviceCode: 'DEMO_LOOSE', displayName: 'DEMO Uncategorized', defaultPrice: null, sortOrder: 1020 }),
  item({ serviceCode: 'DEMO_RETIRED', displayName: 'DEMO Retired', isActive: false, sortOrder: 1030 }),
];
const CATEGORIES = serviceCatalogCategoryFixtures.filter((c) => c.organizationId === GUS_ORGANIZATION_ID);

describe('ServicesAndChargesSelector — catalog items', () => {
  it('lists active items under their categories (others under "Other"), never an inactive one', () => {
    render(<ServicesAndChargesSelector catalog={CATALOG} categories={CATEGORIES} selections={SELECTIONS} onChange={vi.fn()} />);
    expect(screen.getByText('Catalog Items')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Documents and Permits' })).getByText('DEMO Certified Copy')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Transportation' })).getByText('DEMO Transport')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Other' })).getByText('DEMO Uncategorized')).toBeInTheDocument();
    expect(screen.queryByText('DEMO Retired')).not.toBeInTheDocument();
    expect(screen.getByText('$25.50 each')).toBeInTheDocument();
  });

  it('a per-unit item is a quantity stepper; a flat item is Add / Remove', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ServicesAndChargesSelector catalog={CATALOG} categories={CATEGORIES} selections={SELECTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase DEMO Certified Copy quantity' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 1 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Add DEMO Transport' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_TRANSPORT', quantity: 1 }] });

    const selected = { ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 3 }, { serviceCode: 'DEMO_TRANSPORT', quantity: 1 }] };
    rerender(<ServicesAndChargesSelector catalog={CATALOG} categories={CATEGORIES} selections={selected} onChange={onChange} />);
    expect(screen.getByLabelText('DEMO Certified Copy quantity')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: 'Remove DEMO Transport' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 3 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Decrease DEMO Certified Copy quantity' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_TRANSPORT', quantity: 1 }, { serviceCode: 'DEMO_COPY', quantity: 2 }] });
  });

  it('the Live Itemized Summary prices the selected items from the catalog', () => {
    const selected = { ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 3 }, { serviceCode: 'DEMO_TRANSPORT', quantity: 1 }] };
    render(<ServicesAndChargesSelector catalog={CATALOG} categories={CATEGORIES} selections={selected} onChange={vi.fn()} />);
    expect(screen.getByText('DEMO Certified Copy x3')).toBeInTheDocument();
    expect(screen.getByText('$76.50')).toBeInTheDocument();
    expect(screen.getByText('$1,199.95')).toBeInTheDocument(); // 1,000.00 + 76.50 + 123.45
  });

  it('an unpriced selected item is flagged, never charged $0, and points to the Price Catalog', () => {
    render(<ServicesAndChargesSelector catalog={CATALOG} selections={{ ...SELECTIONS, catalogItems: [{ serviceCode: 'DEMO_LOOSE', quantity: 1 }] }} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No price is set for DEMO Uncategorized');
    expect(screen.getByRole('alert')).toHaveTextContent('Settings › Price Catalog');
  });

  it('shows no catalog item group for an organization without catalog items', () => {
    render(<ServicesAndChargesSelector catalog={serviceCatalogFixtures.filter((i) => i.organizationId === DEFAULT_ORGANIZATION_ID)} selections={SELECTIONS} onChange={vi.fn()} />);
    expect(screen.queryByText('Catalog Items')).not.toBeInTheDocument();
  });
});

describe('ServicesAndChargesSelector — Phase 5C-3 finalization', () => {
  it('offers neither an inventory-linked item (it would bypass stock reservation) nor a deactivated primary service', () => {
    const catalog = [
      ...CATALOG.map((i) => (i.serviceCode === 'CREMATION_WITH_VIEWING' ? { ...i, isActive: false } : i)),
      item({ serviceCode: 'DEMO_URN', displayName: 'DEMO Linked Urn', merchandiseProductId: 'p1', defaultPrice: null, sortOrder: 1050 }),
    ];
    render(<ServicesAndChargesSelector catalog={catalog} categories={CATEGORIES} selections={SELECTIONS} onChange={vi.fn()} />);
    expect(screen.queryByText('DEMO Linked Urn')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Cremation with Viewing/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Direct Cremation/)).toBeInTheDocument();
  });

  it('shows existing custom items read-only when the user may not change them', () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[{ id: 'c1', description: 'EXISTING KEEPSAKE', amountCents: 2_500 }]}
      />,
    );
    expect(screen.getByText(/You are not allowed to add, change or remove custom items/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Custom item description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove EXISTING KEEPSAKE' })).not.toBeInTheDocument();
  });
});
