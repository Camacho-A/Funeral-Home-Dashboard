import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SESSION, SessionProvider, useSession } from './useSession';

function Probe() {
  const session = useSession();
  return (
    <div>
      <span data-testid="staffId">{session.staffId ?? 'null'}</span>
      <span data-testid="displayName">{session.displayName}</span>
    </div>
  );
}

describe('useSession / SessionProvider', () => {
  it('resolves DEFAULT_SESSION (staffId: null, empty displayName) with no Provider in the tree', () => {
    render(<Probe />);
    expect(screen.getByTestId('staffId').textContent).toBe('null');
    expect(screen.getByTestId('displayName').textContent).toBe('');
    expect(DEFAULT_SESSION).toEqual({ staffId: null, displayName: '' });
  });

  it('resolves the value supplied by a SessionProvider, not the default', () => {
    render(
      <SessionProvider value={{ staffId: 'staff-123', displayName: 'Jordan Rivera' }}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('staffId').textContent).toBe('staff-123');
    expect(screen.getByTestId('displayName').textContent).toBe('Jordan Rivera');
  });

  it('supports staffId: null with a real displayName (authenticated identity with no StaffProfile provisioned yet)', () => {
    render(
      <SessionProvider value={{ staffId: null, displayName: 'Jordan Rivera' }}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('staffId').textContent).toBe('null');
    expect(screen.getByTestId('displayName').textContent).toBe('Jordan Rivera');
  });
});
