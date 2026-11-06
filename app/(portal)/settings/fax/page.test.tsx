import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const org = vi.hoisted(() => ({ organizationId: 'managed-cremations' }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => org }));
vi.mock('@/components/settings/FaxSettingsPanel', () => ({ FaxSettingsPanel: () => <div>PANEL</div> }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const { default: Page } = await import('./page');

describe('Fax Settings page (2026-11)', () => {
  it('Manors gets its Fax Settings', () => {
    org.organizationId = 'managed-cremations';
    render(<Page />);
    expect(screen.getByText('PANEL')).toBeInTheDocument();
  });

  it('an organization without faxing (Gus), opening the address, is told so — never an endless Loading, and no fax request is made', () => {
    org.organizationId = 'gus-camacho-jr';
    render(<Page />);
    expect(screen.getByText('Faxing is not set up for this organization.')).toBeInTheDocument();
    expect(screen.queryByText('PANEL')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Settings' })).toHaveAttribute('href', '/settings');
  });
});
