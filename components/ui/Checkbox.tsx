import styles from './Checkbox.module.css';

export type CheckboxTone = 'brand' | 'success';

/**
 * The square check-mark box pattern from docs/UI_COMPONENTS.md, used across
 * checklist items, the veteran toggle, VA steps, dashboard bulk-select, and
 * case tasks — with only color and size varying, per that catalogue.
 *
 * `tone` is static per render, not per instance: the same box transitions
 * from brand (pending) to success (done) in checklist/VA-step usage by the
 * *caller* passing `tone={done ? 'success' : 'brand'}` — Checkbox itself
 * stays a simple, stateless primitive rather than encoding that transition
 * rule internally (that rule belongs in domain/cases/checklist.ts and
 * domain/cases/veteran.ts, per docs/adr/ADR-004).
 */
export function Checkbox({
  checked,
  onChange,
  tone = 'brand',
  size = 'md',
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange?: () => void;
  tone?: CheckboxTone;
  size?: 'sm' | 'md';
  disabled?: boolean;
  'aria-label': string;
}) {
  const toneClass = tone === 'success' ? styles.toneSuccess : styles.toneBrand;
  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={[styles.checkbox, toneClass, sizeClass, checked ? styles.checked : '']
        .filter(Boolean)
        .join(' ')}
    >
      {checked ? '✓' : ''}
    </button>
  );
}
