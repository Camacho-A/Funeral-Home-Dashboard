import type { Case } from '../../types/case';

/**
 * Case concurrency (2026-10). The words staff see when their edit was made
 * against a version of the case someone else has since changed — shared by
 * the PATCH route's 409, mock mode and the case page's banner. The message
 * and `reason` strings are identical to Gus SOLIS's, which answers the same
 * conflicts on the same shared Wix rows.
 */
export const CASE_REVISION_CONFLICT_MESSAGE = 'This case was changed by someone else — refresh to see the latest.';
export const CASE_REVISION_CONFLICT_REASON = 'revision_conflict';

/** Thrown by casesService.update when the case moved past the revision the
    edit was made against. `current` is the case as it is now (null when the
    server could not supply it). Nothing was written. */
export class CaseRevisionConflictError extends Error {
  readonly current: Case | null;
  constructor(current: Case | null, message: string = CASE_REVISION_CONFLICT_MESSAGE) {
    super(message);
    this.name = 'CaseRevisionConflictError';
    this.current = current;
  }
}

export function isCaseRevisionConflictError(error: unknown): error is CaseRevisionConflictError {
  return error instanceof CaseRevisionConflictError || (error instanceof Error && error.name === 'CaseRevisionConflictError');
}

/**
 * Every save to an EXISTING case must say which revision it was made
 * against — a missing revision is never treated as permission to
 * overwrite. The `reason` of the HTTP 428 the PATCH route answers when it is
 * absent; nothing is written. Server-side writers with no browser revision
 * use services/caseWriteService.ts#updateCaseWithRetry instead.
 */
export const CASE_REVISION_REQUIRED_REASON = 'revision_required';
export const CASE_REVISION_REQUIRED_MESSAGE =
  'This change could not be saved because the page did not say which version of the case it was made on. Refresh the case and try again.';

export class CaseRevisionRequiredError extends Error {
  constructor(message: string = CASE_REVISION_REQUIRED_MESSAGE) {
    super(message);
    this.name = 'CaseRevisionRequiredError';
  }
}

/** Parses an expectedRevision (a non-negative integer). `undefined` =
    absent (answer 428), `'invalid'` = present but malformed (400). */
export function parseExpectedRevisionValue(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 'invalid';
}

/** Reads a revision from an `If-Match` header (`"7"`, `W/"7"`, `7`).
    `*` and anything else non-numeric is 'invalid'; no header is undefined. */
export function parseIfMatchRevision(header: string | null): number | undefined | 'invalid' {
  if (header === null || header.trim() === '') return undefined;
  const match = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(header);
  return match ? Number(match[1]) : 'invalid';
}
