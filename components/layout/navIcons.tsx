/**
 * SOLIS Final Phase §1.2 — inline 16×16 menu-item icons for AccountMenu's
 * popover. Presentation only: `aria-hidden`, since each menu item's own
 * text already names the control.
 */
function iconProps() {
  return { width: 16, height: 16, viewBox: '0 0 16 16', stroke: 'currentColor', strokeWidth: 1.5, fill: 'none' as const, 'aria-hidden': true as const };
}

export function AuditIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M3 2.5h7l3 3v8H3z M5.5 8h5 M5.5 10.5h5" />
    </svg>
  );
}

export function TemplatesIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </svg>
  );
}

export function SignOutIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9.5 3H4v10h5.5M7 8h6.5M11 5.5 13.5 8 11 10.5" />
    </svg>
  );
}
