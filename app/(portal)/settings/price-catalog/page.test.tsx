import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const org = vi.hoisted(() => ({ organizationId: 'managed-cremations' }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => org }));
vi.mock('@/components/settings/PriceCatalogPanel', () => ({ PriceCatalogPanel: () => <div>PANEL</div> }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const { default: Page } = await import('./page');

describe('Price Catalog page (2026-11)', () => {
  it('Gus keeps its Price Catalog', () => {
    org.organizationId = 'gus-camacho-jr';
    render(<Page />);
    expect(screen.getByText('PANEL')).toBeInTheDocument();
  });

  it('Manors, opening the address, is told it is not available — the catalog panel never loads', () => {
    org.organizationId = 'managed-cremations';
    render(<Page />);
    expect(screen.getByText('The Price Catalog is not managed in SOLIS for this organization.')).toBeInTheDocument();
    expect(screen.queryByText('PANEL')).not.toBeInTheDocument();
  });
});
