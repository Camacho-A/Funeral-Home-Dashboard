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

/**
 * A run of consecutive pages that belong together — in a fax bundle, one
 * application ("Request 2 of 3"). Labels only: the PDF itself is untouched.
 */
export type PdfViewerSection = { label: string; pageCount: number };

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; doc: PDFDocumentProxy }
  | { kind: 'error'; message: string };

export function PdfViewer({
  url,
  data,
  fileName,
  onLoaded,
  onFailed,
  variant = 'compact',
  sections,
  className,
}: {
  url?: string;
  /** The PDF's bytes, already fetched (2026-10, the permit preview) — used instead of `url`. */
  data?: ArrayBuffer;
  fileName: string;
  /** Called once the PDF has been read and its first page drawn. */
  onLoaded?: () => void;
  /** Called when it cannot be shown. */
  onFailed?: (message: string) => void;
  /**
   * 'review' (2026-11, the fax bundle preview): the page controls sit ABOVE
   * the page and are always shown, labelled "Previous page" / "Next page",
   * with a Fit width / Whole page switch — every page must be checked
   * before a send, so the controls may never be pushed out of view by the
   * page they control. 'compact' is the original viewer, unchanged.
   */
  variant?: 'compact' | 'review';
  /** Review only: what each run of pages is. Ignored unless the counts add up to the PDF's own page count. */
  sections?: readonly PdfViewerSection[];
  /** Sizes the viewer (its height) for the place it is shown. */
  className?: string;
}) {
  const onLoadedRef = useRef(onLoaded);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onFailedRef.current = onFailed;
  });
  const reportedLoaded = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pageNumber, setPageNumber] = useState(1);
  /** Review only: fit the page's width (read it), or the whole page (see all of it). */
  const [fit, setFit] = useState<'width' | 'page'>('width');
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
      reportedLoaded.current = false;
      setPageNumber(1);
      try {
        const pdfjs = await import('pdfjs-dist');
        // Bundled worker — the bundler rewrites this to a local asset.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

        let bytes: ArrayBuffer;
        if (data) {
          // A copy: pdf.js takes ownership of what it is given.
          bytes = data.slice(0);
        } else {
          const response = await fetch(url!, { credentials: 'include' });
          if (!response.ok) {
            throw new Error(
              response.status === 403 || response.status === 401
                ? 'You do not have permission to view this document.'
                : `This document could not be loaded (error ${response.status}).`,
            );
          }
          bytes = await response.arrayBuffer();
        }
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setState({ kind: 'ready', doc });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error && error.message ? error.message : 'This document could not be loaded.';
        setState({ kind: 'error', message });
        onFailedRef.current?.(message);
      }
    }

    void load();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      void loadingTask?.destroy();
    };
  }, [url, data]);

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
      let scale = available && available > 0 ? available / unscaled.width : 1;
      if (fit === 'page') {
        // The scroll box's height less its 12px + 12px padding.
        const height = (scrollRef.current?.clientHeight ?? 0) - 24;
        if (height > 0) scale = Math.min(scale, height / unscaled.height);
      }
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
        if (!cancelled && !reportedLoaded.current) {
          reportedLoaded.current = true;
          onLoadedRef.current?.();
        }
      } catch {
        // A cancelled render is the expected result of paging quickly or
        // resizing mid-draw — not an error worth showing anyone.
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [state, pageNumber, resizeToken, fit]);

  // A new page starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [pageNumber]);

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

  if (variant === 'review') {
    const starts = sectionStarts(sections, pageCount);
    const current = starts ? starts.reduce((found, start, i) => (start <= pageNumber ? i : found), -1) : -1;
    const section = starts && current >= 0 ? sections![current] : null;
    return (
      <div className={`${styles.viewer} ${className ?? ''}`}>
        <div className={styles.toolbar} role="toolbar" aria-label="PDF pages">
          <div className={styles.toolbarPager}>
            <button type="button" className={styles.pagerButton} onClick={() => goTo(pageNumber - 1)} disabled={pageNumber <= 1}>
              ‹ Previous page
            </button>
            <span className={styles.pagerLabel} aria-live="polite">
              Page {pageNumber} of {pageCount}
            </span>
            <button type="button" className={styles.pagerButton} onClick={() => goTo(pageNumber + 1)} disabled={pageNumber >= pageCount}>
              Next page ›
            </button>
          </div>
          <div className={styles.toolbarTools}>
            {starts && sections!.length > 1 && (
              <select className={styles.jump} aria-label="Go to" value={starts[current]} onChange={(e) => goTo(Number(e.target.value))}>
                {sections!.map((s, i) => (
                  <option key={i} value={starts[i]}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={styles.pagerButton} aria-pressed={fit === 'page'} onClick={() => setFit(fit === 'page' ? 'width' : 'page')}>
              {fit === 'page' ? 'Fit width' : 'Whole page'}
            </button>
          </div>
          {/* The Go to menu already names a one-page request; say more only when there is more to say. */}
          {section && (sections!.length === 1 || section.pageCount > 1) && (
            <p className={styles.sectionLabel}>
              {section.label}
              {section.pageCount > 1 ? ` · its page ${pageNumber - starts![current] + 1} of ${section.pageCount}` : ''}
            </p>
          )}
        </div>
        <div className={styles.canvasScroll} ref={scrollRef}>
          <div className={styles.canvasFrame}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              role="img"
              aria-label={`${fileName}, page ${pageNumber} of ${pageCount}${section ? ` — ${section.label}` : ''}`}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.viewer} ${className ?? ''}`}>
      <div className={styles.canvasScroll} ref={scrollRef}>
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

/** The first page (1-based) of each section, or null when the sections do not account for exactly every page. */
function sectionStarts(sections: readonly PdfViewerSection[] | undefined, pageCount: number): number[] | null {
  if (!sections || sections.length === 0) return null;
  if (sections.some((s) => !Number.isInteger(s.pageCount) || s.pageCount < 1)) return null;
  const starts: number[] = [];
  let next = 1;
  for (const s of sections) {
    starts.push(next);
    next += s.pageCount;
  }
  return next - 1 === pageCount ? starts : null;
}
