import { FTC_CLASS } from '@/domain/billing/ftcComplianceRegistry';

/**
 * Gus Phase 5C-3 (finalization). The FTC classification choices shown in
 * Settings › Price Catalog — exactly the existing registry's values
 * (domain/billing/ftcComplianceRegistry.ts), with "Pending review" for an
 * item no administrator has classified yet (stored as null). Labels only;
 * the legal wording on statements is unchanged.
 */
export const FTC_CLASS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Pending review' },
  { value: FTC_CLASS.BASIC_SERVICES_FEE, label: 'Basic services fee' },
  { value: FTC_CLASS.GOODS_AND_SERVICES, label: 'Goods and services' },
  { value: FTC_CLASS.CASH_ADVANCE, label: 'Cash advance' },
];

/** The select value for an item's stored classification ('' = pending review). */
export function ftcClassValue(stored: string | null | undefined): string {
  return FTC_CLASS_OPTIONS.some((option) => option.value === stored) && stored ? stored : '';
}

export function ftcClassLabel(stored: string | null | undefined): string {
  return FTC_CLASS_OPTIONS.find((option) => option.value === ftcClassValue(stored))?.label ?? 'Pending review';
}
