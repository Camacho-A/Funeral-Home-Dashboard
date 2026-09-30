import type { HTMLAttributes } from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'brand' | 'danger' | 'success' | 'warning';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: styles.neutral,
  brand: styles.brand,
  danger: styles.danger,
  success: styles.success,
  warning: styles.warning,
};

/**
 * Which real-world condition maps to which variant is a domain decision
 * (e.g. "this stage is the bottleneck," "this case is overdue") and belongs
 * in the relevant domain/ module (Phase 4), not decided here — Badge only
 * renders whatever variant it's told. See docs/adr/ADR-002 and
 * docs/adr/ADR-004 for why that split exists.
 *
 * Task #14 Phase C (2026-09, SOLIS shared-component unification):
 *  - `neutral` previously rendered brand-tinted (identical to `brand`, just
 *    lighter) — now a real gray (see Badge.module.css), so it visually
 *    reads as "inactive/informational" rather than "notable."
 *  - `warning` is new, using the Phase A canonical warning tokens. No
 *    existing domain `xStatusVariant()` call site was remapped to it —
 *    every current status's semantic meaning and variant assignment is
 *    unchanged; this only adds the capability for a future status to use.
 */
export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={[styles.badge, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
