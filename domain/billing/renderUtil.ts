/**
 * Phase 39 (Family Billing & FTC Compliance). Small pure helpers for the
 * compliance renderers. Deliberately local (not coupled to the merge engine).
 */

/** Formats integer cents as USD currency. */
export function formatCents(cents: number, currency = 'USD'): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = (abs % 100).toString().padStart(2, '0');
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'USD' ? '$' : '';
  return `${negative ? '-' : ''}${symbol}${grouped}.${rem}`;
}

/** HTML-escapes untrusted text. Every dynamic string in a rendered compliance
    document passes through this — the documents reach a headless-Chromium
    render step, so no unescaped data ever enters the HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
