'use client';

import { Checkbox } from '@/components/ui/Checkbox';
import styles from './PermissionMatrix.module.css';

export type PermissionMatrixEntry = { key: string; category: string; description: string };

/**
 * Phase 22 (Role-Based Access Control). Renders the permission catalog
 * grouped by category, checked against one role's currently-granted set.
 * Used two ways: read-only (Permission Inspector, viewing a platform
 * default role) and interactive (Role Editor, editing a custom role's
 * permission set) — `onToggle` being provided at all is what switches
 * between the two; this component never knows *why* it's read-only.
 */
export function PermissionMatrix({
  permissions,
  grantedKeys,
  onToggle,
  disabled = false,
}: {
  permissions: PermissionMatrixEntry[];
  grantedKeys: Set<string>;
  onToggle?: (key: string) => void;
  disabled?: boolean;
}) {
  const categories = Array.from(new Set(permissions.map((p) => p.category))).sort();

  return (
    <div className={styles.matrix}>
      {categories.map((category) => (
        <div key={category} className={styles.category}>
          <span className={styles.categoryLabel}>{category}</span>
          {permissions
            .filter((p) => p.category === category)
            .map((permission) => {
              const granted = grantedKeys.has(permission.key);
              return (
                <label key={permission.key} className={styles.row}>
                  <Checkbox
                    checked={granted}
                    onChange={onToggle ? () => onToggle(permission.key) : undefined}
                    disabled={disabled || !onToggle}
                    aria-label={permission.description}
                  />
                  <span className={[styles.rowLabel, !onToggle && !granted ? styles.rowLabelDisabled : ''].filter(Boolean).join(' ')}>
                    {permission.description}
                  </span>
                </label>
              );
            })}
        </div>
      ))}
    </div>
  );
}
