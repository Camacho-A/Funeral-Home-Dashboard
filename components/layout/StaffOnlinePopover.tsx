'use client';

import { useState } from 'react';
import { useActiveStaffList } from '@/hooks/useIdentitySessions';
import styles from './StaffOnlinePopover.module.css';

/** Mirrors `components/settings/TeamMemberList.tsx`'s own `initialsFor` —
    a small, per-component helper, not a shared utility (this codebase's
    established precedent for this exact kind of initials derivation). */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('');
}

const GROUP_LABELS = ['Administrators', 'Managers', 'Funeral Directors', 'Other staff'] as const;
type GroupLabel = (typeof GROUP_LABELS)[number];

/** Groups by the exact Phase 22 default role key (see
    domain/rbac/defaultRoles.ts) the task named — anything else (a legacy
    role value, a custom role, arranger/officeStaff/accounting/readOnly/
    dispatch) falls under "Other staff" rather than being guessed into
    one of the three named groups. */
function groupLabelFor(roleKey: string): GroupLabel {
  if (roleKey === 'administrator') return 'Administrators';
  if (roleKey === 'manager') return 'Managers';
  if (roleKey === 'funeralDirector') return 'Funeral Directors';
  return 'Other staff';
}

/**
 * Addendum 2, item #1 (2026-10). Hover/focus popover for the sidebar
 * footer's "N staff online" card — lists who's online, grouped. The list
 * itself (`useActiveStaffList`) is fetched only while `open` is true, not
 * on every sidebar render; the count (`count` prop) is the sidebar's own
 * already-fetched `useActiveStaffCount` value, never refetched here.
 *
 * `children` is the existing "N staff online" dot+text markup, rendered
 * completely unchanged — this component only adds the interactive
 * wrapper and the popover itself, per "the card itself looks the same
 * as it does today."
 */
export function StaffOnlinePopover({
  organizationId,
  count,
  className,
  children,
}: {
  organizationId: string;
  count: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data: staff } = useActiveStaffList(organizationId, open);

  const groups = GROUP_LABELS.map((label) => ({
    label,
    members: (staff ?? []).filter((member) => groupLabelFor(member.roleKey) === label),
  })).filter((group) => group.members.length > 0);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      tabIndex={0}
      aria-haspopup="true"
      aria-expanded={open}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      {children}
      {open && (
        <div className={styles.popover} role="group" aria-label={`${count} staff online`}>
          <div className={styles.title}>{count} staff online</div>
          {groups.map((group) => (
            <div key={group.label}>
              <div className={styles.groupLabel}>{group.label}</div>
              {group.members.map((member, index) => (
                <div key={`${group.label}-${index}`} className={styles.row}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initialsFor(member.displayName)}
                  </span>
                  <span className={styles.name}>{member.displayName}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
