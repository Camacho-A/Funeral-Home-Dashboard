'use client';

import { useEffect, useState } from 'react';
import { PdfViewer } from '@/components/documents/PdfViewer';

/**
 * The permit PDF itself, shown inside the window where staff confirm or
 * choose it (2026-10) — never a name or a link to open elsewhere. Reads the
 * file, checks it is a PDF, computes its SHA-256 and, for a stored
 * document, that it is exactly the one on record; only once the page has
 * been drawn does it report `onVerified(checksum)`. Any failure is shown
 * and reported, and the caller keeps its confirmation disabled.
 */
export type PermitPdfSource = { kind: 'stored'; url: string; expectedChecksumSha256: string } | { kind: 'file'; file: File };

/** A chosen file's bytes — FileReader where Blob.arrayBuffer is unavailable. */
function readFile(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function PermitPdfPreview({
  source,
  fileName,
  onVerified,
  onFailed,
}: {
  source: PermitPdfSource;
  fileName: string;
  onVerified: (checksumSha256: string) => void;
  onFailed: () => void;
}) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; bytes: ArrayBuffer; checksum: string }>({ kind: 'loading' });
  const key = source.kind === 'stored' ? source.url : source.file;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      let bytes: ArrayBuffer;
      if (source.kind === 'stored') {
        const response = await fetch(source.url, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'You do not have permission to view this permit.' : `The permit could not be loaded (error ${response.status}).`);
        bytes = await response.arrayBuffer();
      } else {
        bytes = await readFile(source.file);
      }
      const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 5)));
      if (head !== '%PDF-') throw new Error('This file is not a PDF.');
      const checksum = await sha256Hex(bytes);
      if (source.kind === 'stored' && checksum !== source.expectedChecksumSha256) {
        throw new Error('The file shown does not match the permit on record. Do not confirm it — reopen and try again.');
      }
      if (!cancelled) setState({ kind: 'ready', bytes, checksum });
    })().catch((error: unknown) => {
      if (cancelled) return;
      setState({ kind: 'error', message: error instanceof Error && error.message ? error.message : 'The permit could not be shown.' });
      onFailed();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per file
  }, [key]);

  if (state.kind === 'error') {
    return (
      <div className="sx-form-banner sx-form-banner-error" role="alert">
        {state.message} It cannot be confirmed from here.
      </div>
    );
  }
  if (state.kind === 'loading') return <p role="status">Loading {fileName}…</p>;
  return (
    <PdfViewer
      data={state.bytes}
      fileName={fileName}
      onLoaded={() => onVerified(state.checksum)}
      onFailed={(message) => {
        setState({ kind: 'error', message });
        onFailed();
      }}
    />
  );
}
