import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useResetMainContentScrollOnChange } from './useResetMainContentScrollOnChange';

function TestHarness({ scrollKey, containerId }: { scrollKey: string; containerId?: string }) {
  useResetMainContentScrollOnChange(scrollKey, containerId);
  return null;
}

describe('useResetMainContentScrollOnChange (Solis go-live checkpoint — Case Detail scroll-to-bottom fix)', () => {
  it('resets the target container\'s scroll to the top on mount', () => {
    const container = document.createElement('div');
    container.id = 'main-content';
    document.body.appendChild(container);
    const scrollToSpy = vi.fn();
    container.scrollTo = scrollToSpy;

    render(<TestHarness scrollKey="case-1" />);

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
    document.body.removeChild(container);
  });

  it('resets again whenever the key changes (e.g. navigating from one case to another)', () => {
    const container = document.createElement('div');
    container.id = 'main-content';
    document.body.appendChild(container);
    const scrollToSpy = vi.fn();
    container.scrollTo = scrollToSpy;

    const { rerender } = render(<TestHarness scrollKey="case-1" />);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    rerender(<TestHarness scrollKey="case-1" />);
    expect(scrollToSpy).toHaveBeenCalledTimes(1); // unchanged key — no extra reset

    rerender(<TestHarness scrollKey="case-2" />);
    expect(scrollToSpy).toHaveBeenCalledTimes(2); // key changed — resets again

    document.body.removeChild(container);
  });

  it('does nothing (never throws) when the target container is not present', () => {
    expect(() => render(<TestHarness scrollKey="case-1" containerId="does-not-exist" />)).not.toThrow();
  });

  it('never touches an unrelated container — a page opting out of this keeps its own scroll position', () => {
    const mainContent = document.createElement('div');
    mainContent.id = 'main-content';
    document.body.appendChild(mainContent);
    const mainScrollSpy = vi.fn();
    mainContent.scrollTo = mainScrollSpy;

    const otherContainer = document.createElement('div');
    otherContainer.id = 'some-other-scrollable';
    document.body.appendChild(otherContainer);
    const otherScrollSpy = vi.fn();
    otherContainer.scrollTo = otherScrollSpy;

    render(<TestHarness scrollKey="case-1" containerId="some-other-scrollable" />);

    expect(otherScrollSpy).toHaveBeenCalledWith(0, 0);
    expect(mainScrollSpy).not.toHaveBeenCalled();

    document.body.removeChild(mainContent);
    document.body.removeChild(otherContainer);
  });
});
