import styles from './ProductBrand.module.css';

const SOLISCODE_MARK_SRC = '/brand/soliscode-mark.png';

/**
 * Task #13 (2026-09, SOLIS product branding). The shared "[SolisCode mark]
 * SOLIS" lockup — previously a plain CSS-filled square (Sidebar.module.css's
 * old `.brandMark`) beside the Sidebar's wordmark, and no mark at all on
 * the Login screen. Both now render this same component so the real
 * SolisCode brand asset (public/brand/soliscode-mark.png — supplied
 * directly by the user, never redrawn/traced/approximated here) and the
 * visible "SOLIS" product name can never drift out of sync between the
 * two surfaces.
 *
 * Deliberately a plain function component (no 'use client', no hooks) —
 * the Login screen is a Server Component and must be able to render this
 * directly.
 *
 * Accessibility: the mark is `alt=""` + `aria-hidden` — decorative, since
 * the visible "SOLIS" text (a real, non-image text node passed as
 * children) already carries the product name. This avoids a screen
 * reader announcing "SolisCode logo SOLIS" when "SOLIS" alone is the
 * correct accessible name. Callers control the wrapping element for the
 * text (e.g. Login's own `<h1>`) via `children`/`wordmarkClassName` — this
 * component only owns the mark + layout, never the text's semantic tag,
 * so each site keeps its own existing heading/heading-less structure.
 */
export function ProductBrand({
  markSize = 32,
  wordmarkClassName,
  className,
}: {
  /** Pixel size of the (square) mark. Defaults to a modest bump over the
      previous 30px placeholder — the real artwork is more detailed and
      needs slightly more room to stay recognizable. */
  markSize?: number;
  /** Typography for the "SOLIS" text — left to the caller so each site's
      own existing font-size/weight (Sidebar's small wordmark vs. Login's
      larger page title) is preserved exactly, not reset by this shared
      component. */
  wordmarkClassName?: string;
  className?: string;
}) {
  return (
    <div className={className ? `${styles.brand} ${className}` : styles.brand}>
      {/* Small, always-local, fixed-size decorative mark — no next/image
          precedent exists anywhere else in this codebase, and its
          optimization pipeline (blur placeholders, remote loaders) buys
          nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SOLISCODE_MARK_SRC}
        alt=""
        aria-hidden="true"
        width={markSize}
        height={markSize}
        className={styles.mark}
      />
      <span className={wordmarkClassName}>SOLIS</span>
    </div>
  );
}
