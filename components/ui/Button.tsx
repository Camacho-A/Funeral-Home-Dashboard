import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Only meaningful for variant="primary" — see Button.module.css for which
      real prototype instance each combination maps to. */
  pill?: boolean;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
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
