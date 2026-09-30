import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Only meaningful for variant="primary" — see Button.module.css for which
      real prototype instance each combination maps to. */
  pill?: boolean;
};

/**
 * Task #14 Phase C (2026-09, SOLIS shared-component unification) note on
 * `variant="icon"`: a compact, square, glyph-only button (e.g. a close ×,
 * a stepper +/-) — always pass a real `aria-label` since its visible
 * content is typically a single non-descriptive character/icon, not text.
 * Added as a shared capability only; no existing ad hoc icon button in the
 * app was migrated onto it this phase (each lives in its own page-specific
 * component, out of this phase's scope — see the Phase C final report).
 */

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
  icon: styles.icon,
};

export function Button({
  variant = 'primary',
  pill = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const variantClass = variant === 'primary' && pill ? styles.primaryPill : VARIANT_CLASS[variant];

  return (
    <button
      type={type}
      className={[styles.button, variantClass, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
