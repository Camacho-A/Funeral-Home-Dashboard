import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export type CardVariant = 'bordered' | 'elevated';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** bordered = detail-tier (Case Information, Checklist, ...); elevated =
      dashboard/stat-tier. Beacon-Design-System.md Section 9 explicitly calls
      for exactly these two elevation tiers and no third. */
  variant?: CardVariant;
};

export function Card({ variant = 'bordered', className, ...rest }: CardProps) {
  const variantClass = variant === 'elevated' ? styles.elevated : styles.bordered;
  return (
    <div className={[styles.card, variantClass, className].filter(Boolean).join(' ')} {...rest} />
  );
}
