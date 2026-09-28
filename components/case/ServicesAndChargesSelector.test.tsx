import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServicesAndChargesSelector } from './ServicesAndChargesSelector';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';
import type { ServiceSelections, CustomLineItemSelection } from '@/types/caseOrder';

const NOW = '2026-07-20T00:00:00.000Z';

const CATALOG: ServiceCatalogItem[] = [
  {
    id: 'svc-1',
    organizationId: 'org-1',
    serviceCode: 'DIRECT_CREMATION',
    displayName: 'Direct Cremation',
    category: 'base',
    pricingType: 'flat',
    defaultPrice: 89_000,
    isActive: true,
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const SELECTIONS: ServiceSelections = {
  weightTier: 'under_200',
  extraDeathCertificateQuantity: 0,
  mailCremated: false,
  keepsakeTransferQuantity: 0,
  urnTransfer: false,
  shipping: false,
};

/**
 * SOLIS cleanup item #11 (2026-09). Additional Items & Services custom
 * item — component-level tests for the UI added to ServicesAndChargesSelector.
 */
describe('ServicesAndChargesSelector — predefined items (unaffected by item #11)', () => {
  it('1: predefined base service still renders', () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[]}
        onChangeCustomItems={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Direct Cremation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Always included')).toBeInTheDocument();
  });
});

describe('ServicesAndChargesSelector — Custom Item (item #11, 2026-09)', () => {
  it('renders no Custom Item section at all when onChangeCustomItems is omitted (New Case / Set Up Services & Charges flow)', () => {
    render(<ServicesAndChargesSelector catalog={CATALOG} selections={SELECTIONS} onChange={vi.fn()} />);
    expect(screen.queryByText('Custom Item')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Custom item description')).not.toBeInTheDocument();
  });

  it('2: staff can add a custom item with Description + Price', () => {
    const onChangeCustomItems = vi.fn();
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[]}
        onChangeCustomItems={onChangeCustomItems}
      />,
    );
    fireEvent.change(screen.getByLabelText('Custom item description'), { target: { value: 'Additional keepsake requested by family' } });
    fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: '75.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Custom Item' }));

    expect(onChangeCustomItems).toHaveBeenCalledTimes(1);
    const added = onChangeCustomItems.mock.calls[0][0] as CustomLineItemSelection[];
    expect(added).toHaveLength(1);
    expect(added[0].description).toBe('Additional keepsake requested by family');
    expect(added[0].amountCents).toBe(7500);
    expect(typeof added[0].id).toBe('string');
    expect(added[0].id.length > 0).toBe(true);
  });

  it('6/7: the Add Custom Item button is disabled for a blank or whitespace-only description', () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[]}
        onChangeCustomItems={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: '75.00' } });
    expect(screen.getByRole('button', { name: 'Add Custom Item' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Custom item description'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Add Custom Item' })).toBeDisabled();
  });

  it('8/9: the Add Custom Item button is disabled for an invalid price (blank, malformed, or negative) — integer cents only', () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[]}
        onChangeCustomItems={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Custom item description'), { target: { value: 'Special item' } });
    expect(screen.getByRole('button', { name: 'Add Custom Item' })).toBeDisabled(); // no price yet

    fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: 'Add Custom Item' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: '-5' } });
    expect(screen.getByRole('button', { name: 'Add Custom Item' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Custom item price (dollars)'), { target: { value: '75.00' } });
    expect(screen.getByRole('button', { name: 'Add Custom Item' })).not.toBeDisabled();
  });

  it('10: an already-added custom item is displayed in both the Custom Item list and the Live Itemized Summary', () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[{ id: 'c1', description: 'ADDITIONAL KEEPSAKE', amountCents: 7500 }]}
        onChangeCustomItems={vi.fn()}
      />,
    );
    expect(screen.getAllByText('ADDITIONAL KEEPSAKE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$75.00').length).toBeGreaterThanOrEqual(1);
  });

  it("11: the Live Itemized Summary's total includes the custom item's amount", () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[{ id: 'c1', description: 'ADDITIONAL KEEPSAKE', amountCents: 7500 }]}
        onChangeCustomItems={vi.fn()}
      />,
    );
    // Base $890.00 + custom $75.00 = $965.00
    expect(screen.getByText('$965.00')).toBeInTheDocument();
  });

  it('17/18: removing a custom item recalculates the summary total', () => {
    const onChangeCustomItems = vi.fn();
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[{ id: 'c1', description: 'ADDITIONAL KEEPSAKE', amountCents: 7500 }]}
        onChangeCustomItems={onChangeCustomItems}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove ADDITIONAL KEEPSAKE' }));
    expect(onChangeCustomItems).toHaveBeenCalledWith([]);
  });

  it('19: predefined items remain unaffected by adding a custom item', () => {
    render(
      <ServicesAndChargesSelector
        catalog={CATALOG}
        selections={SELECTIONS}
        onChange={vi.fn()}
        customItems={[{ id: 'c1', description: 'ADDITIONAL KEEPSAKE', amountCents: 7500 }]}
        onChangeCustomItems={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Direct Cremation').length).toBeGreaterThanOrEqual(1);
  });
});
