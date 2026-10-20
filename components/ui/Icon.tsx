/**
 * SOLIS true redesign, Phase 1 (2026-10). A small shared set of inline SVG
 * line-icon glyphs — this repo has no icon library and this phase's own
 * Implementation Notes call for "small inline SVG glyphs in one shared Icon
 * component. No new dependency." rather than adding one. Paths are copied
 * directly from the approved design/solis-phase1-handoff/SOLIS Phase 1.dc.html
 * mockup (generic geometric glyphs — rectangles/circles/paths, not any
 * third-party icon set), so Sidebar nav icons render pixel-identical to the
 * approved design. `currentColor` + no fill (stroke-only) so each caller's
 * own CSS `color` drives the glyph color, matching every other icon in this
 * codebase (e.g. NotificationBell's own inline bell SVG).
 */
import type { ReactNode } from 'react';

export type IconName =
  | 'dashboard'
  | 'tasks'
  | 'calendar'
  | 'reports'
  | 'accounting'
  | 'settings'
  | 'search'
  | 'notifications'
  | 'flame'
  | 'checkCircle'
  | 'document'
  | 'info';

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  tasks: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M5.5 8l2 2 3-4" />
    </>
  ),
  /* The same bell the TopBar bell button already draws, scaled to the
     16px line-glyph grid — the nav entry and the bell must read as the
     same thing. */
  notifications: (
    <>
      <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6v2.06c0 .33-.12.65-.33.9l-.87 1.02c-.4.48-.06 1.2.56 1.2h8.48c.62 0 .96-.72.56-1.2l-.87-1.02a1.4 1.4 0 0 1-.33-.9V5.6A3.6 3.6 0 0 0 8 2Z" />
      <path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  reports: <path d="M3 13V8M8 13V3M13 13V6" />,
  accounting: (
    <>
      <rect x="2" y="4" width="12" height="8.5" rx="1.5" />
      <path d="M2 7h12" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="8" cy="8" r="5.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  /* Schedule tab redesign (2026-10): the Cremains Pickup fields. Same
     stroke-only 16px grid as the glyphs above. */
  flame: <path d="M8 14c2.5 0 4-1.6 4-3.9C12 7 9.5 5.6 8.6 2c-1.9 1.4-2.6 3.3-2.4 5-.8-.4-1.3-1.1-1.4-1.9C3.9 6.2 4 7.6 4 10.1 4 12.4 5.5 14 8 14Z" />,
  checkCircle: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.6 8.2l1.7 1.7 3.1-3.6" />
    </>
  ),
  document: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3M6 8.5h4M6 11h4" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.3v3.6M8 5.1v.1" />
    </>
  ),
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
