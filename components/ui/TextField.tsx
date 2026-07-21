import type { InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';

type TextFieldProps = InputHTMLAttributes<HTMLInputElement>;

export function TextField({ className, ...rest }: TextFieldProps) {
  return <input className={[styles.field, className].filter(Boolean).join(' ')} {...rest} />;
}
