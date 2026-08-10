/**
 * Phase 31 (Financial Management & General Ledger). Pure AR-aging bucket
 * calculation — no I/O, no organizationId, shared by
 * services/financialReportsService.ts's `getArAgingReport` and any future
 * client-side preview. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * **The anchor date is always the case's first CaseOrder version's
 * createdAt — never the current (possibly-superseded) version's own
 * createdAt.** A routine price edit via `services/pricingService.ts`'s
 * `recalculateOrder` must never reset an overdue balance's age back to
 * zero; callers are responsible for resolving that v1 anchor date before
 * calling this function (see `getArAgingReport`), not this module.
 */
export type ArAgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export function ageDaysBetween(anchorDate: string, asOfDate: string): number {
  const anchorMs = new Date(anchorDate).getTime();
  const asOfMs = new Date(asOfDate).getTime();
  return Math.max(0, Math.floor((asOfMs - anchorMs) / (24 * 60 * 60 * 1000)));
}

export function bucketForAgeDays(ageDays: number): ArAgingBucket {
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

export function bucketForAging(anchorDate: string, asOfDate: string): ArAgingBucket {
  return bucketForAgeDays(ageDaysBetween(anchorDate, asOfDate));
}
