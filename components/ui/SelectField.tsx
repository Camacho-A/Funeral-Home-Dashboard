import type { SelectHTMLAttributes } from 'react';
import styles from './SelectField.module.css';

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement>;

export function SelectField({ className, children, ...rest }: SelectFieldProps) {
  return (
    <select className={[styles.field, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}
