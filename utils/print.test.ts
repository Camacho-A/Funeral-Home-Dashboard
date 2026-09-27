import { afterEach, describe, expect, it, vi } from 'vitest';
import { printFile, printStoredDocument } from './print';

function makeFakePrintWindow() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    document: { write: vi.fn(), close: vi.fn() },
    focus: vi.fn(),
    print: vi.fn(),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    }),
    fireLoad: () => listeners.load?.forEach((h) => h()),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('printFile', () => {
  it('accepts a plain Blob (not just a File) and prints it via an object URL', () => {
    const fakeWindow = makeFakePrintWindow();
    vi.stubGlobal('open', vi.fn().mockReturnValue(fakeWindow));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-url') });

    const blob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
    printFile(blob, 'Doc.pdf', 'Jane Doe', 'B2026-001');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.open).toHaveBeenCalledWith('blob:fake-url', '_blank');
    fakeWindow.fireLoad();
    expect(fakeWindow.print).toHaveBeenCalled();
  });

  it('falls back to a placeholder page when no file is given', () => {
    const fakeWindow = makeFakePrintWindow();
    vi.stubGlobal('open', vi.fn().mockReturnValue(fakeWindow));

    printFile(undefined, 'Doc.pdf', 'Jane Doe', 'B2026-001');

    expect(fakeWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Placeholder'));
    expect(fakeWindow.print).toHaveBeenCalled();
  });
});

describe('printStoredDocument (item #2 — Documents tab Print)', () => {
  it('fetches the real document through the given authorized URL and prints the fetched bytes, never a synthetic placeholder', async () => {
    const blob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }));
    const fakeWindow = makeFakePrintWindow();
    vi.stubGlobal('open', vi.fn().mockReturnValue(fakeWindow));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-url') });

    await printStoredDocument('/api/cases/case-1/documents/doc-1/download?organizationId=org-1', 'Cremation Authorization.pdf', 'Jane Doe', 'B2026-001');

    expect(fetch).toHaveBeenCalledWith('/api/cases/case-1/documents/doc-1/download?organizationId=org-1');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    fakeWindow.fireLoad();
    expect(fakeWindow.print).toHaveBeenCalled();
  });

  it('throws (never silently prints a placeholder) when the authorized route responds with a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(
      printStoredDocument('/api/cases/case-1/documents/doc-1/download?organizationId=org-1', 'Missing.pdf', 'Jane Doe', 'B2026-001'),
    ).rejects.toThrow(/404/);
  });
});
