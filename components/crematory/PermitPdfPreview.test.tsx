import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createHash } from 'crypto';

/** The permit preview (2026-10): the exact stored PDF, checked by checksum, before anything can be confirmed. Fictional bytes. */
vi.mock('@/components/documents/PdfViewer', async () => {
  const { useEffect } = await import('react');
  return {
    // pdf.js cannot draw in jsdom: "drawn" as soon as it is given the bytes.
    PdfViewer: ({ data, onLoaded }: { data: ArrayBuffer; onLoaded: () => void }) => {
      useEffect(() => onLoaded(), [onLoaded]);
      return <div data-testid="pdf">{data.byteLength} bytes</div>;
    },
  };
});
const { PermitPdfPreview } = await import('./PermitPdfPreview');

const PDF = new TextEncoder().encode('%PDF-1.7 fictional permit');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const serve = (body: Uint8Array, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body as unknown as BodyInit, { status })));
afterEach(() => vi.unstubAllGlobals());

function show(source: Parameters<typeof PermitPdfPreview>[0]['source']) {
  const onVerified = vi.fn();
  const onFailed = vi.fn();
  render(<PermitPdfPreview source={source} fileName="FICTIONAL PERMIT.pdf" onVerified={onVerified} onFailed={onFailed} />);
  return { onVerified, onFailed };
}

describe('PermitPdfPreview', () => {
  it('shows the stored PDF and reports its checksum once drawn — only when it is exactly the permit on record', async () => {
    serve(PDF);
    const { onVerified, onFailed } = show({ kind: 'stored', url: '/api/cases/c/documents/permit/download', expectedChecksumSha256: sha(PDF) });
    expect(await screen.findByTestId('pdf')).toBeInTheDocument();
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(sha(PDF)));
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('a different file than the one on record is not shown as the permit, and cannot be confirmed', async () => {
    serve(PDF);
    const { onVerified, onFailed } = show({ kind: 'stored', url: '/x', expectedChecksumSha256: 'f'.repeat(64) });
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the permit on record');
    expect(onFailed).toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pdf')).toBeNull();
  });

  it('a failed load or a file that is not a PDF is an error, never a confirmation', async () => {
    serve(new Uint8Array(), 404);
    let handlers = show({ kind: 'stored', url: '/x', expectedChecksumSha256: sha(PDF) });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded (error 404)');
    expect(handlers.onVerified).not.toHaveBeenCalled();
    cleanup();

    const notPdf = new TextEncoder().encode('<html>sign in</html>');
    serve(notPdf);
    handlers = show({ kind: 'stored', url: '/y', expectedChecksumSha256: sha(notPdf) });
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a PDF');
    expect(handlers.onVerified).not.toHaveBeenCalled();
  });

  it('a new file chosen for a replacement is shown from the computer, with its own checksum', async () => {
    const file = new File([PDF], 'NEW PERMIT.pdf', { type: 'application/pdf' });
    const { onVerified } = show({ kind: 'file', file });
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(sha(PDF)));
  });
});
