'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import styles from './PdfViewer.module.css';

/**
 * In-browser PDF viewer (2026-10). SOLIS renders the PDF itself.
 *
 * Why not let the browser do it: the download route already serves
 * `Content-Disposition: inline` with the stored `application/pdf`, which is
 * correct HTTP — but Chrome's "Download PDFs instead of automatically
 * opening them" setting overrides inline for navigations AND refuses to
 * render the file inside an <object>/<embed>. Both were tried against
 * production and both saved `GOLLIS ATTESTATION.pdf` to disk instead of
 * showing it. No response header beats a client setting, so the only way
 * for "View" to mean view for every staff member on every machine is to
 * not involve the browser's PDF plugin at all.
 *
 * Document access is unchanged: the bytes are fetched from the SAME
 * authenticated, same-origin route Download uses, with cookies. No blob
 * URL, no signed URL, nothing new is exposed. pdf.js and its worker are
 * bundled, so no CDN is contacted either.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; doc: PDFDocumentProxy }
  | { kind: 'error'; message: string };

export function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pageNumber, setPageNumber] = useState(1);
  /** Bumped on resize so the current page re-renders at the new width. */
  const [resizeToken, setResizeToken] = useState(0);

  // Load the document once per URL.
  useEffect(() => {
    let cancelled = false;
    /** Destroying the loading task is what releases the document and its
        worker port — PDFDocumentProxy itself has no destroy. */
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function load() {
      setState({ kind: 'loading' });
      setPageNumber(1);
      try {
        const pdfjs = await import('pdfjs-dist');
        // Bundled worker — the bundler rewrites this to a local asset.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          throw new Error(
            response.status === 403 || response.status === 401
              ? 'You do not have permission to view this document.'
              : `This document could not be loaded (error ${response.status}).`,
          );
        }
        const data = await response.arrayBuffer();
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({ data });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setState({ kind: 'ready', doc });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: error instanceof Error && error.message ? error.message : 'This document could not be loaded.',
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      void loadingTask?.destroy();
    };
  }, [url]);

  // Re-render the page at the new size when the window changes width.
  useEffect(() => {
    function onResize() {
      setResizeToken((token) => token + 1);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Draw the current page.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const doc = state.doc;

    let cancelled = false;
    async function draw() {
      // A page still rendering when the user pages on would otherwise keep
      // painting onto the canvas underneath the new one.
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;

      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      // Fit the available width, then multiply by the device pixel ratio so
      // the page is sharp on a retina screen instead of an upscaled blur.
      const unscaled = page.getViewport({ scale: 1 });
      // Measured from the unpadded frame, so the page is sized to the
      // space it actually has rather than overflowing by the padding.
      const available = canvas!.parentElement?.clientWidth;
      const scale = available && available > 0 ? available / unscaled.width : 1;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;

      canvas!.width = Math.floor(viewport.width * ratio);
      canvas!.height = Math.floor(viewport.height * ratio);
      canvas!.style.width = `${Math.floor(viewport.width)}px`;
      canvas!.style.height = `${Math.floor(viewport.height)}px`;

      const context = canvas!.getContext('2d');
      if (!context) return;

      const task = page.render({
        canvasContext: context,
        canvas: canvas!,
        viewport,
        // pdf.js owns the context transform, so the DPI scale goes through
        // its own option rather than a setTransform it would overwrite.
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // A cancelled render is the expected result of paging quickly or
        // resizing mid-draw — not an error worth showing anyone.
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [state, pageNumber, resizeToken]);

  const goTo = useCallback(
    (next: number) => {
      if (state.kind !== 'ready') return;
      setPageNumber(Math.min(Math.max(1, next), state.doc.numPages));
    },
    [state],
  );

  if (state.kind === 'loading') {
    return (
      <div className={styles.message} role="status">
        Loading {fileName}…
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className={styles.message} role="alert">
        <p className={styles.errorText}>{state.message}</p>
        <p className={styles.errorHint}>You can still download it using the button below.</p>
      </div>
    );
  }

  const pageCount = state.doc.numPages;

  return (
    <div className={styles.viewer}>
      <div className={styles.canvasScroll}>
        <div className={styles.canvasFrame}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="img"
            aria-label={`${fileName}, page ${pageNumber} of ${pageCount}`}
          />
        </div>
      </div>
      {pageCount > 1 && (
        <div className={styles.pager}>
          <button type="button" className={styles.pagerButton} onClick={() => goTo(pageNumber - 1)} disabled={pageNumber <= 1}>
            Previous
          </button>
          <span className={styles.pagerLabel}>
            Page {pageNumber} of {pageCount}
          </span>
          <button type="button" className={styles.pagerButton} onClick={() => goTo(pageNumber + 1)} disabled={pageNumber >= pageCount}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
