'use client';

import { isSandboxEnabled } from '@/lib/sandbox';
import { resetSandboxBrowserData } from '@/services/__mocks__/mockStore';
import styles from './SandboxBanner.module.css';

/**
 * SOLIS sandbox (2026-10). Always visible in the sandbox so nobody mistakes
 * it for the live system; renders nothing anywhere else.
 */
export function SandboxBanner() {
  if (!isSandboxEnabled()) return null;

  function reset() {
    resetSandboxBrowserData();
    window.location.reload();
  }

  return (
    <div className={styles.banner} role="note" aria-label="Sandbox">
      <span className={styles.label}>Sandbox</span>
      <span className={styles.text}>Fictional data only. Nothing here reaches Production, email or SMS.</span>
      <button type="button" className={styles.reset} onClick={reset}>
        Reset fictional data
      </button>
    </div>
  );
}
