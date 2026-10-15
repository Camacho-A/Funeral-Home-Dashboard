import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VaNotificationPanel } from './VaNotificationPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import type { VaNotificationResponsibility } from '@/types/case';

function renderPanel({
  organizationId,
  responsibility = null,
  onSet = vi.fn(),
}: {
  organizationId: string;
  responsibility?: VaNotificationResponsibility | null;
  onSet?: (r: VaNotificationResponsibility) => void;
}) {
  render(
    <OrganizationProvider organizationId={organizationId}>
      <VaNotificationPanel
        vaSteps={[]}
        vaCallbackDone={false}
        vaPublishChoice={null}
        vaNotificationResponsibility={responsibility}
        onToggleStep={vi.fn()}
        onSetPublishChoice={vi.fn()}
        onSetVaNotificationResponsibility={onSet}
      />
    </OrganizationProvider>,
  );
  return { onSet };
}

describe('VaNotificationPanel — organization-specific label, legacy stored key', () => {
  it('Manors: button reads MANORS and stores the legacy key "manors" (unchanged)', () => {
    const { onSet } = renderPanel({ organizationId: 'managed-cremations' });
    fireEvent.click(screen.getByRole('button', { name: 'MANORS' }));
    expect(onSet).toHaveBeenCalledWith('manors');
  });

  it('Manors: family note unchanged', () => {
    renderPanel({ organizationId: 'managed-cremations', responsibility: 'family' });
    expect(screen.getByText('Family is handling VA notification — no action needed from Manors staff.')).toBeInTheDocument();
  });

  it("Gus: button reads Gus's own short name, still stores the backward-compatible key, never shows MANORS", () => {
    const { onSet } = renderPanel({ organizationId: 'gus-camacho-jr', responsibility: 'family' });
    expect(screen.queryByText(/manors/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'GUS CAMACHO JR.' }));
    expect(onSet).toHaveBeenCalledWith('manors');
    expect(screen.getByText('Family is handling VA notification — no action needed from Gus Camacho Jr. staff.')).toBeInTheDocument();
  });

  it('a stored "manors" value on a Gus case renders as Gus selected', () => {
    renderPanel({ organizationId: 'gus-camacho-jr', responsibility: 'manors' });
    expect(screen.getByRole('button', { name: 'GUS CAMACHO JR.' }).className).toMatch(/Active/);
  });

  it('unknown organization: generic label', () => {
    renderPanel({ organizationId: 'some-future-funeral-home' });
    expect(screen.getByRole('button', { name: 'FUNERAL HOME' })).toBeInTheDocument();
    expect(screen.queryByText(/manors/i)).toBeNull();
  });
});
