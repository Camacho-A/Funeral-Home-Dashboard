import type { CaseTask } from '../types/task';

/**
 * Phase 15D (Wix Task Read Integration). Mirrors lib/wixCaseMapper.ts's
 * role exactly: the one place a raw Wix `tasks` collection item is ever
 * touched. See docs/adr/ADR-014-wix-task-read-integration.md.
 *
 * Identifier handling:
 * - Wix item `_id`: never read, never used as a Beacon id.
 * - `beaconTaskId` → CaseTask.id.
 * - `organizationId` → CaseTask.organizationId (unchanged name).
 * - `assigneeId` → CaseTask.assigneeStaffId (RENAMED — matches
 *   docs/WIX_DATA_SCHEMA.md's Collection 6 mapping table; the identity-
 *   space fork this field carries is unresolved and out of this phase's
 *   scope, same as Phase 15C's caseHandlerId).
 * - `caseId` → CaseTask.caseId (unchanged name, nullable — null means a
 *   general office task, not a missing relationship; validated here only
 *   as "string or null", never checked against a real case — that
 *   relationship-integrity concern is documented as a known limitation,
 *   not resolved in this phase, matching "do not redesign identity
 *   mapping").
 * - `text`, `isDone`, `createdAt` → unchanged names.
 *
 * `CaseTask` has no due date, priority, status enum beyond `isDone`, or
 * ordering field — none exist in the domain model, so none are mapped or
 * invented here.
 */

export type WixTaskItem = {
  beaconTaskId?: unknown;
  organizationId?: unknown;
  text?: unknown;
  assigneeId?: unknown;
  isDone?: unknown;
  caseId?: unknown;
  createdAt?: unknown;
};

/**
 * Validates and maps one `tasks` Wix item into Beacon's CaseTask domain
 * type. Returns null (skip, don't throw) if any required field is missing
 * or the wrong type. `assigneeId`/`caseId` are optional/nullable — allowed
 * to be null or absent, but not the wrong type if present.
 */
export function mapWixTaskItem(item: WixTaskItem | undefined): CaseTask | null {
  if (
    !item ||
    typeof item.beaconTaskId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.text !== 'string' ||
    typeof item.isDone !== 'boolean' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  if (item.assigneeId !== undefined && item.assigneeId !== null && typeof item.assigneeId !== 'string') {
    return null;
  }
  if (item.caseId !== undefined && item.caseId !== null && typeof item.caseId !== 'string') {
    return null;
  }

  return {
    id: item.beaconTaskId,
    organizationId: item.organizationId,
    text: item.text,
    assigneeStaffId: typeof item.assigneeId === 'string' ? item.assigneeId : null,
    isDone: item.isDone,
    caseId: typeof item.caseId === 'string' ? item.caseId : null,
    createdAt: item.createdAt,
  };
}
