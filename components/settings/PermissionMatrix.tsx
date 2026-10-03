'use client';

import { Checkbox } from '@/components/ui/Checkbox';

export type PermissionMatrixEntry = { key: string; category: string; description: string };

/**
 * Phase 22 (Role-Based Access Control). Renders the permission catalog
 * grouped by category, checked against one role's currently-granted set.
 * Used two ways: read-only (Permission Inspector, viewing a platform
 * default role) and interactive (Role Editor, editing a custom role's
 * permission set) — `onToggle` being provided at all is what switches
 * between the two; this component never knows *why* it's read-only.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S3): `.sx-perm-group`/
 * `.sx-perm-row`, each row showing the label plus its key in `.sx-perm-key`
 * — same grouping (by category, the only grouping this component ever
 * had), same checkbox inputs/handlers.
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
    <div>
      {categories.map((category) => (
        <div key={category} className="sx-perm-group">
          <div className="sx-perm-group-title">{category}</div>
          {permissions
            .filter((p) => p.category === category)
            .map((permission) => {
              const granted = grantedKeys.has(permission.key);
              return (
                <label key={permission.key} className="sx-perm-row">
                  <Checkbox
                    checked={granted}
                    onChange={onToggle ? () => onToggle(permission.key) : undefined}
                    disabled={disabled || !onToggle}
                    aria-label={permission.description}
                  />
                  <span>
                    {permission.description}
                    <span className="sx-perm-key">{permission.key}</span>
                  </span>
                </label>
              );
            })}
        </div>
      ))}
    </div>
  );
}
