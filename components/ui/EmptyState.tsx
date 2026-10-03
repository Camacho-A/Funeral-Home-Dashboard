/**
 * SOLIS Final Phase §0.8 — shared empty-state primitive, restyled to the
 * sx- system's literal markup. `message` stays the one required prop
 * (every existing call site's string is unchanged, verbatim); `helperText`
 * is new and optional (omitted everywhere except where this phase's spec
 * names one, e.g. NotificationDrawer/ActivityEventList). `center` is also
 * new and optional — only NotificationDrawer's empty state (§2) asks for
 * the centered `.sx-empty-center` treatment; every other existing caller
 * keeps the left-aligned default, unchanged.
 */
export function EmptyState({ message, helperText, center = false }: { message: string; helperText?: string; center?: boolean }) {
  return (
    <div className={center ? 'sx-empty sx-empty-center' : 'sx-empty'}>
      <div className="sx-empty-title">{message}</div>
      {helperText && <div className="sx-empty-text">{helperText}</div>}
    </div>
  );
}
