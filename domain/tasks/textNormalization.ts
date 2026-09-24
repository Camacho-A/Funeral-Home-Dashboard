/**
 * SOLIS-wide ALL-CAPS data standard (2026-09). CaseTask's own explicit
 * normalization policy — mirrors domain/cases/textNormalization.ts's shape
 * exactly, but kept as its own small module (not folded into the Case
 * policy) since Task is a structurally distinct entity with its own
 * persistence boundary (lib/wixTaskMapper.ts), per-domain rather than one
 * generic function.
 *
 * `text` is CaseTask's only staff-entered free-text field — everything
 * else on the type (assigneeStaffId, isDone, caseId, dueDate, createdAt,
 * id, organizationId) is an id, boolean, date, or timestamp, never prose.
 */
export function normalizeTaskTextFields<T extends { text?: unknown }>(input: T): T {
  if (typeof input.text === 'string') {
    return { ...input, text: input.text.toUpperCase() };
  }
  return input;
}
