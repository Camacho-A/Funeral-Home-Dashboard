import type { HTMLAttributes } from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'brand' | 'danger' | 'success';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: styles.neutral,
  brand: styles.brand,
  danger: styles.danger,
  success: styles.success,
};

/**
 * Which real-world condition maps to which variant is a domain decision
 * (e.g. "this stage is the bottleneck," "this case is overdue") and belongs
 * in the relevant domain/ module (Phase 4), not decided here — Badge only
 * renders whatever variant it's told. See docs/adr/ADR-002 and
 * docs/adr/ADR-004 for why that split exists.
 */
export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={[styles.badge, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
