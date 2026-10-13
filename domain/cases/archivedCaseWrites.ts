/**
 * Archived cases are read-only (2026-10).
 *
 * Until now this was enforced by accident: every write path looked the
 * case up with `isArchived: false`, so a patch against an archived case
 * 404'd. That also made archived cases unreadable, which broke opening one
 * from the calendar or the Archived Cases list — and, because the only
 * Restore control lives on the case detail page, made restoring one
 * impossible.
 *
 * Reading is now allowed and the restriction moved here, where it says
 * what it means: an archived case accepts exactly one write, the restore
 * that un-archives it. Everything else is refused, so opening an archived
 * case can never become a way to edit one, and no edit can silently
 * resurrect a filed case as a side effect.
 *
 * Restoring is deliberately NOT a different permission from editing. A
 * caller who may edit cases may restore one; a caller who may not, cannot
 * — the authorization checks each write path already runs are unchanged
 * and still run first. This module only answers "is this patch allowed
 * against an archived case at all?".
 */

/** Fields a restore may carry. `isDeleted` is the restore itself;
    `archivedAt` is the stamp that accompanies it. Nothing else — a patch
    that bundles a real edit with the restore is refused, so "restore" can
    never be used as a wrapper to smuggle an edit past this guard. */
const RESTORE_PATCH_FIELDS = new Set(['isDeleted', 'archivedAt']);

/**
 * Whether this patch is the restore, and only the restore.
 *
 * `isDeleted: true` is NOT a restore: re-archiving an already-archived
 * case is a no-op write that this guard has no reason to admit.
 */
export function isRestorePatch(patch: object): boolean {
  const record = patch as Record<string, unknown>;
  if (record.isDeleted !== false) return false;
  return Object.keys(record).every((field) => RESTORE_PATCH_FIELDS.has(field));
}

export const ARCHIVED_CASE_READ_ONLY_MESSAGE =
  'This case is archived and cannot be edited. Restore it first.';

/**
 * The reason to refuse this write, or null when it may proceed.
 *
 * Returns null for any case that is not archived, so the ordinary write
 * path is completely unaffected — no new rule applies to a live case.
 */
export function archivedCaseWriteRefusal(
  existing: { isDeleted?: boolean | null },
  patch: object,
): string | null {
  if (existing.isDeleted !== true) return null;
  if (isRestorePatch(patch)) return null;
  return ARCHIVED_CASE_READ_ONLY_MESSAGE;
}
