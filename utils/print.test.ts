import { describe, expect, it, vi } from 'vitest';
import { printTextLog } from './print';

describe('printTextLog escapes what it writes into the print window (2026-10)', () => {
  it('escapes the title and case header', () => {
    const write = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn() } as unknown as Window);
    printTextLog('Case Log', '<img src=x onerror=alert(1)>', 'B2026-001', [], () => '');
    const html = write.mock.calls[0][0] as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
