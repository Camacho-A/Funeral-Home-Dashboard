import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServicesAndChargesSelector } from './ServicesAndChargesSelector';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { ServiceSelections } from '@/types/caseOrder';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). The "Service" radio group,
 * "Price not set" display, and the Live Itemized Summary for an unpriced
 * selection — and that Manors' controls are unchanged.
 */

const SELECTIONS: ServiceSelections = {
  weightTier: 'under_200',
  extraDeathCertificateQuantity: 0,
  mailCremated: false,
  keepsakeTransferQuantity: 0,
  urnTransfer: false,
  shipping: false,
};
const gusCatalog = () => serviceCatalogFixtures.filter((i) => i.organizationId === GUS_ORGANIZATION_ID);
const manorsCatalog = () => serviceCatalogFixtures.filter((i) => i.organizationId === DEFAULT_ORGANIZATION_ID);

describe('ServicesAndChargesSelector — Gus service types', () => {
  it('renders one Service radio per service type, none pre-selected, each Price not set — and no Manors-only groups', () => {
    render(<ServicesAndChargesSelector catalog={gusCatalog()} selections={SELECTIONS} onChange={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getAllByText('Price not set')).toHaveLength(6);
    expect(screen.queryByText('Weight')).not.toBeInTheDocument();
    expect(screen.queryByText('Additional Charges')).not.toBeInTheDocument();
    expect(screen.queryByText('Always included')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00', { exact: false })).toBeInTheDocument(); // only the empty Total
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('choosing a service type reports serviceTypeCode', () => {
    const onChange = vi.fn();
    render(<ServicesAndChargesSelector catalog={gusCatalog()} selections={SELECTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Cremation with Viewing/));
    expect(onChange).toHaveBeenCalledWith({ ...SELECTIONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' });
  });

  it('an unpriced choice shows Price not set in the summary, a total that says it excludes it, and a warning', () => {
    render(
      <ServicesAndChargesSelector
        catalog={gusCatalog()}
        selections={{ ...SELECTIONS, serviceTypeCode: 'DIRECT_ENTOMBMENT' }}
        onChange={vi.fn()}
        unpricedNotice="Custom next step."
      />,
    );
    expect(screen.getByText('Total (excludes items with no price set)')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No price is set for Direct Entombment (Embalming Required)');
    expect(alert).toHaveTextContent('Settings › Services & Pricing');
    expect(alert).toHaveTextContent('Custom next step.');
  });

  it('a priced choice is itemized at its price', () => {
    const catalog = gusCatalog().map((i) => (i.serviceCode === 'CREMATION_WITH_VIEWING' ? { ...i, defaultPrice: 495_000 } : i));
    render(<ServicesAndChargesSelector catalog={catalog} selections={{ ...SELECTIONS, serviceTypeCode: 'CREMATION_WITH_VIEWING' }} onChange={vi.fn()} />);
    expect(screen.getAllByText('$4,950.00').length).toBeGreaterThanOrEqual(2); // radio hint, summary line, total
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ServicesAndChargesSelector — Manors unchanged', () => {
  it('keeps the base service, Weight and Additional Charges groups, and no Service group', () => {
    render(<ServicesAndChargesSelector catalog={manorsCatalog()} selections={SELECTIONS} onChange={vi.fn()} />);
    expect(screen.getByText('Always included')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('Additional Charges')).toBeInTheDocument();
    expect(screen.queryByText('Service')).not.toBeInTheDocument();
    expect(screen.queryByText('Price not set')).not.toBeInTheDocument();
  });
});
