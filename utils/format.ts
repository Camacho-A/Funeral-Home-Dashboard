/**
 * Generic, domain-independent formatting helper — ported from
 * design/support.js's inline `daysAgo === 0 ? "Today" : ...` logic. Any app
 * could have this; it's not a funeral-home business rule, which is why
 * types/caseViewModel.ts's TimelineEntryViewModel exposes a raw `daysAgo`
 * number rather than a pre-formatted string (see that file's comment).
 */
export function formatDaysAgo(daysAgo: number): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return `${daysAgo} days ago`;
}

/**
 * The prototype hardcodes "Just now" for every case log entry (nothing
 * persists across a page reload there, so every entry really was just
 * added). This mock backend keeps entries for the life of the dev server,
 * so a real formatted timestamp is more honest for a longer-running
 * session than always claiming "Just now" — a deliberate, minor deviation.
 */
export function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Phase 19B (Clover Hosted Checkout Integration). Generic cents→display
 * string formatting — Clover (and every other major payment provider)
 * represents an amount in the smallest currency unit, matching
 * types/payment.ts's PaymentRecord.amount; this is the one place that gets
 * converted back to a human-facing string. Not a funeral-home business
 * rule, so it lives here rather than in domain/.
 */
export function formatCentsAsCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}
