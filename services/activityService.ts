import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem } from '../lib/wixDataApi';
import { mapWixActivityEventItem, buildWixActivityEventData, type WixActivityEventItem } from '../lib/wixActivityEventMapper';
import { ACTIVITY_EVENT_TYPES, type ActivityEvent, type ActivityEventCategory, type ActivitySeverity, type NewActivityEventInput } from '../types/activityEvent';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { buildCsv, EXPORT_ROW_CAP } from '../domain/reporting/csvExport';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The single service
 * every module records activity events into — see ADR-028 and
 * `types/activityEvent.ts`'s own comment for the full architecture.
 *
 * **Append-only, immutable, permanently.** This module imports only
 * `insertWixDataItem` from `lib/wixDataApi.ts` — never `updateWixDataItem`
 * or `deleteWixDataItem` — for the `activityEvents` collection. A
 * correction to a past event is always a *new* event (its `metadata` may
 * reference the event it corrects); nothing here ever mutates or removes
 * an existing row. `services/activityService.test.ts`'s "immutability"
 * test asserts this file never imports either function.
 *
 * **Pagination is keyset (seek), not offset, not native-cursor** — Wix
 * Data has neither. A `cursor` is a base64url encoding of `{createdAt, id}`,
 * pushed down as a `createdAt <= cursor.createdAt` range filter against the
 * `(organizationId, createdAt)` index (narrowing what Wix scans), with the
 * exact `<` / same-timestamp `id <` tie-break applied in application code
 * on the resulting bounded window — see `listForOrganization`'s own
 * comment for why a compound "OR" condition isn't attempted server-side.
 */

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
/** How many rows to pull from Wix per fetch when narrowing by cursor —
    generous enough that the in-app tie-break/filter slice below rarely
    needs a second round-trip, without ever fetching an organization's
    entire history at once. */
const WIX_FETCH_WINDOW = 250;

// ---------------------------------------------------------------------------
// record() — the one function every module calls to write an event.
// ---------------------------------------------------------------------------

export async function record(input: NewActivityEventInput, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  const event: ActivityEvent = {
    ...input,
    id: crypto.randomUUID(),
    eventVersion: 1,
    createdAt: nowIso(),
  };

  if (dataAdapterMode === 'mock') {
    activityEventFixtures.push(event);
    return event;
  }

  await insertWixDataItem<WixActivityEventItem>('activityEvents', buildWixActivityEventData(event), event.id);
  return event;
}

// ---------------------------------------------------------------------------
// Cursor encode/decode
// ---------------------------------------------------------------------------

export type ActivityCursor = { createdAt: string; id: string };

export function encodeCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Returns null for anything malformed or unparseable — an invalid cursor
    is treated as "start from the beginning," never a thrown error, since
    it's client-supplied. */
export function decodeCursor(raw: string): ActivityCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type ActivityListFilters = {
  caseId?: string;
  category?: ActivityEventCategory;
  resourceType?: string;
  eventType?: string;
  actorIdentityId?: string;
  severity?: ActivitySeverity;
  /** Free-text, matched against `description` only (case-insensitive
      substring) — not index-backed; see this module's own comment and
      ADR-028 for the documented scaling ceiling this implies. */
  query?: string;
  from?: string;
  to?: string;
};

export type ActivityListResult = { events: ActivityEvent[]; nextCursor: string | null };

function matchesFilters(event: ActivityEvent, filters: ActivityListFilters): boolean {
  if (filters.caseId !== undefined && event.caseId !== filters.caseId) return false;
  if (filters.category !== undefined && event.category !== filters.category) return false;
  if (filters.resourceType !== undefined && event.resourceType !== filters.resourceType) return false;
  if (filters.eventType !== undefined && event.eventType !== filters.eventType) return false;
  if (filters.actorIdentityId !== undefined && event.actorIdentityId !== filters.actorIdentityId) return false;
  if (filters.severity !== undefined && event.severity !== filters.severity) return false;
  if (filters.from !== undefined && event.createdAt < filters.from) return false;
  if (filters.to !== undefined && event.createdAt > filters.to) return false;
  if (filters.query) {
    if (!event.description.toLowerCase().includes(filters.query.toLowerCase())) return false;
  }
  return true;
}

/** Newest-first, with `id` as a deterministic tiebreaker for same-millisecond
    events — the exact ordering keyset pagination depends on. */
function sortNewestFirst(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** The exact keyset comparison: strictly older than the cursor, or the
    same millisecond with a strictly smaller id. Applied in application
    code even in wix mode (see this module's own comment on why the
    server-side filter alone — `createdAt <= cursor.createdAt` — is only
    an efficiency narrowing, not the correctness boundary). */
function isPastCursor(event: ActivityEvent, cursor: ActivityCursor): boolean {
  if (event.createdAt < cursor.createdAt) return true;
  if (event.createdAt > cursor.createdAt) return false;
  return event.id < cursor.id;
}

function paginate(events: ActivityEvent[], limit: number): ActivityListResult {
  const page = events.slice(0, limit);
  const hasMore = events.length > limit;
  const last = page[page.length - 1];
  return {
    events: page,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.trunc(limit), MAX_PAGE_LIMIT);
}

export async function listForOrganization(
  organizationId: string,
  filters: ActivityListFilters,
  cursorRaw: string | null,
  limit: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityListResult> {
  const limitToUse = boundedLimit(limit);
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

  let candidates: ActivityEvent[];
  if (dataAdapterMode === 'mock') {
    candidates = activityEventFixtures.filter((e) => e.organizationId === organizationId);
  } else {
    // Push down the two dimensions that are actually index-backed
    // (organizationId always; caseId/category when present — see this
    // collection's 3-index design in ADR-028) plus a coarse createdAt
    // upper bound from the cursor, to keep what Wix scans small. The
    // *exact* cursor boundary and every remaining filter are still
    // applied in application code below — this is a narrowing
    // optimization, not the correctness mechanism.
    const wixFilter: Record<string, unknown> = { organizationId };
    if (filters.caseId) wixFilter.caseId = filters.caseId;
    if (filters.category) wixFilter.category = filters.category;
    if (cursor) wixFilter.createdAt = { $lte: cursor.createdAt };

    const response = await queryWixDataItems<WixActivityEventItem>('activityEvents', {
      filter: wixFilter,
      sort: [{ fieldName: 'createdAt', order: 'DESC' }],
      paging: { limit: WIX_FETCH_WINDOW },
    });
    candidates = response.dataItems.map((item) => mapWixActivityEventItem(item.data)).filter((e): e is ActivityEvent => e !== null);
  }

  let filtered = sortNewestFirst(candidates.filter((e) => matchesFilters(e, filters)));
  if (cursor) filtered = filtered.filter((e) => isPastCursor(e, cursor));
  return paginate(filtered, limitToUse);
}

export async function listForCase(
  organizationId: string,
  caseId: string,
  cursorRaw: string | null,
  limit: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityListResult> {
  return listForOrganization(organizationId, { caseId }, cursorRaw, limit, dataAdapterMode);
}

// ---------------------------------------------------------------------------
// CSV export — bounded, never unbounded
// ---------------------------------------------------------------------------

const CSV_COLUMNS: ReadonlyArray<{ header: string; value: (e: ActivityEvent) => string }> = [
  { header: 'createdAt', value: (e) => e.createdAt },
  { header: 'category', value: (e) => e.category },
  { header: 'eventType', value: (e) => e.eventType },
  { header: 'severity', value: (e) => e.severity },
  { header: 'actorIdentityId', value: (e) => e.actorIdentityId ?? '' },
  { header: 'actorRoleKey', value: (e) => e.actorRoleKey ?? '' },
  { header: 'caseId', value: (e) => e.caseId ?? '' },
  { header: 'resourceType', value: (e) => e.resourceType },
  { header: 'resourceId', value: (e) => e.resourceId ?? '' },
  { header: 'description', value: (e) => e.description },
];

export async function exportCsv(organizationId: string, filters: ActivityListFilters, dataAdapterMode: DataAdapterMode): Promise<string> {
  const rows: ActivityEvent[] = [];
  let cursor: string | null = null;
  do {
    const page = await listForOrganization(organizationId, filters, cursor, MAX_PAGE_LIMIT, dataAdapterMode);
    rows.push(...page.events);
    cursor = page.nextCursor;
  } while (cursor && rows.length < EXPORT_ROW_CAP);

  const capped = rows.slice(0, EXPORT_ROW_CAP);
  return buildCsv(capped, CSV_COLUMNS);
}

// ---------------------------------------------------------------------------
// Typed event-builder helpers — the only way any call site produces an
// event; nothing outside this file ever hand-constructs a raw payload.
// `ctx` bundles what every call site already has from its own resolved
// auth context, resolved once per request.
// ---------------------------------------------------------------------------

export type ActivityContext = {
  organizationId: string;
  actorIdentityId: string | null;
  actorMembershipId: string | null;
  actorRoleKey: string | null;
  /** Generated once per request, threaded through every `record*` call
      that request makes — never invented per-event independently. */
  correlationId: string;
  isSystemGenerated?: boolean;
};

/** Every field on `previousValue`/`newValue` for an update-shaped event is
    keyed by field name, structurally nudging callers toward "just the
    fields that changed" rather than a full entity snapshot — a caller
    would have to deliberately enumerate every field on the entity to
    bloat this, rather than doing so by accident. */
export type FieldChange = { previous: unknown; next: unknown };

function envelope(ctx: ActivityContext, base: Omit<NewActivityEventInput, keyof ActivityContext | 'isSystemGenerated'> & { isSystemGenerated?: boolean }): NewActivityEventInput {
  return {
    organizationId: ctx.organizationId,
    actorIdentityId: ctx.actorIdentityId,
    actorMembershipId: ctx.actorMembershipId,
    actorRoleKey: ctx.actorRoleKey,
    correlationId: ctx.correlationId,
    isSystemGenerated: base.isSystemGenerated ?? ctx.isSystemGenerated ?? false,
    ...base,
  };
}

function fieldChangesToJson(changedFields: Record<string, FieldChange>, side: 'previous' | 'next'): string {
  return JSON.stringify(Object.fromEntries(Object.entries(changedFields).map(([key, change]) => [key, change[side]])));
}

export function recordCaseCreated(
  ctx: ActivityContext,
  caseId: string,
  identifyingSnapshot: { caseNumber: string; decedentName: string },
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: ACTIVITY_EVENT_TYPES.CASE_CREATED,
      resourceType: 'case',
      resourceId: caseId,
      previousValue: null,
      newValue: JSON.stringify(identifyingSnapshot),
      description: `Case ${identifyingSnapshot.caseNumber} created for ${identifyingSnapshot.decedentName}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordCaseUpdated(ctx: ActivityContext, caseId: string, changedFields: Record<string, FieldChange>, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  const fieldNames = Object.keys(changedFields);
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: ACTIVITY_EVENT_TYPES.CASE_UPDATED,
      resourceType: 'case',
      resourceId: caseId,
      previousValue: fieldChangesToJson(changedFields, 'previous'),
      newValue: fieldChangesToJson(changedFields, 'next'),
      description: `Case updated (${fieldNames.join(', ')})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordStageChanged(ctx: ActivityContext, caseId: string, fromStage: string, toStage: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: ACTIVITY_EVENT_TYPES.CASE_STAGE_CHANGED,
      resourceType: 'case',
      resourceId: caseId,
      previousValue: JSON.stringify({ stage: fromStage }),
      newValue: JSON.stringify({ stage: toStage }),
      description: `Case stage changed from "${fromStage}" to "${toStage}"`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordCaseNoteAdded(
  ctx: ActivityContext,
  caseId: string,
  logEntryId: string,
  kind: 'note' | 'contact',
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: kind === 'note' ? ACTIVITY_EVENT_TYPES.CASE_NOTE_ADDED : ACTIVITY_EVENT_TYPES.CASE_CONTACT_LOGGED,
      resourceType: 'caseLogEntry',
      resourceId: logEntryId,
      previousValue: null,
      newValue: null,
      description: kind === 'note' ? 'Note added to case log' : 'Contact logged on case',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordTaskCompleted(ctx: ActivityContext, caseId: string, taskId: string, taskText: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: ACTIVITY_EVENT_TYPES.CASE_TASK_COMPLETED,
      resourceType: 'task',
      resourceId: taskId,
      previousValue: JSON.stringify({ isDone: false }),
      newValue: JSON.stringify({ isDone: true }),
      description: `Task completed: ${taskText}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordTaskCreated(ctx: ActivityContext, caseId: string, taskId: string, taskText: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: ACTIVITY_EVENT_TYPES.CASE_TASK_CREATED,
      resourceType: 'task',
      resourceId: taskId,
      previousValue: null,
      newValue: null,
      description: `Task created: ${taskText}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordPaymentRecorded(ctx: ActivityContext, caseId: string, paymentId: string, amountCents: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'payments',
      eventType: ACTIVITY_EVENT_TYPES.PAYMENT_RECORDED,
      resourceType: 'payment',
      resourceId: paymentId,
      previousValue: null,
      newValue: JSON.stringify({ amountCents }),
      description: `Payment recorded for $${(amountCents / 100).toFixed(2)}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordPaymentCheckoutCreated(ctx: ActivityContext, caseId: string, paymentId: string, amountCents: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'payments',
      eventType: ACTIVITY_EVENT_TYPES.PAYMENT_CHECKOUT_CREATED,
      resourceType: 'payment',
      resourceId: paymentId,
      previousValue: null,
      newValue: JSON.stringify({ amountCents }),
      description: `Payment checkout started for $${(amountCents / 100).toFixed(2)}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordPaymentFailed(ctx: ActivityContext, caseId: string, paymentId: string, reason: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'payments',
      eventType: ACTIVITY_EVENT_TYPES.PAYMENT_FAILED,
      resourceType: 'payment',
      resourceId: paymentId,
      previousValue: null,
      newValue: JSON.stringify({ reason }),
      description: `Payment failed: ${reason}`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordPaymentCancelled(ctx: ActivityContext, caseId: string, paymentId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'payments',
      eventType: ACTIVITY_EVENT_TYPES.PAYMENT_CANCELLED,
      resourceType: 'payment',
      resourceId: paymentId,
      previousValue: JSON.stringify({ status: 'pending' }),
      newValue: JSON.stringify({ status: 'cancelled' }),
      description: 'Payment cancelled',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Phase 31 (Financial Management & General Ledger). `PAYMENT_REFUNDED`
    existed since Phase 19C as a reserved type with no emitter — this is
    its first real one, called from
    `services/financialTransactionService.ts#postRefundTransaction`. */
export function recordPaymentRefunded(ctx: ActivityContext, caseId: string, paymentId: string, amountCents: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'payments',
      eventType: ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED,
      resourceType: 'payment',
      resourceId: paymentId,
      previousValue: JSON.stringify({ status: 'succeeded' }),
      newValue: JSON.stringify({ status: 'refunded', amountCents }),
      description: `Payment refunded for $${(amountCents / 100).toFixed(2)}`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordCaseOrderChanged(
  ctx: ActivityContext,
  caseId: string,
  caseOrderId: string,
  diffEntries: Array<{ action: string; previousValue: string | null; newValue: string | null; description: string }>,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'cases',
      eventType: ACTIVITY_EVENT_TYPES.CASE_ORDER_CHANGED,
      resourceType: 'caseOrder',
      resourceId: caseOrderId,
      previousValue: JSON.stringify(diffEntries.map((d) => ({ action: d.action, value: d.previousValue }))),
      newValue: JSON.stringify(diffEntries.map((d) => ({ action: d.action, value: d.newValue }))),
      description: diffEntries.map((d) => d.description).join('; ') || 'Case order updated',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

// --- Team-management helpers: built for forward-compatibility per ADR-028,
// not called from any route this phase (roleService/invitationService keep
// their own organizationRoleAuditEntries writer — see ADR-028). ---

export function recordTeamMemberInvited(ctx: ActivityContext, targetIdentityId: string, roleKey: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'team_management',
      eventType: ACTIVITY_EVENT_TYPES.TEAM_MEMBER_INVITED,
      resourceType: 'membership',
      resourceId: targetIdentityId,
      previousValue: null,
      newValue: JSON.stringify({ role: roleKey }),
      description: `Team member invited as ${roleKey}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordTeamMemberRoleChanged(
  ctx: ActivityContext,
  targetIdentityId: string,
  fromRole: string,
  toRole: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'team_management',
      eventType: ACTIVITY_EVENT_TYPES.TEAM_MEMBER_ROLE_CHANGED,
      resourceType: 'membership',
      resourceId: targetIdentityId,
      previousValue: JSON.stringify({ role: fromRole }),
      newValue: JSON.stringify({ role: toRole }),
      description: `Role changed from ${fromRole} to ${toRole}`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordTeamMemberStatusChanged(
  ctx: ActivityContext,
  targetIdentityId: string,
  fromStatus: string,
  toStatus: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'team_management',
      eventType: ACTIVITY_EVENT_TYPES.TEAM_MEMBER_STATUS_CHANGED,
      resourceType: 'membership',
      resourceId: targetIdentityId,
      previousValue: JSON.stringify({ status: fromStatus }),
      newValue: JSON.stringify({ status: toStatus }),
      description: `Membership status changed from ${fromStatus} to ${toStatus}`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordInvitationRevoked(ctx: ActivityContext, targetIdentityId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'team_management',
      eventType: ACTIVITY_EVENT_TYPES.TEAM_INVITATION_REVOKED,
      resourceType: 'membership',
      resourceId: targetIdentityId,
      previousValue: null,
      newValue: null,
      description: 'Invitation revoked',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 25 (Document Generation & Template Management). Every write in
// services/documentService.ts and services/documentTemplatesService.ts
// records through exactly one of these — never a hand-constructed
// payload at the call site, matching every helper above.
// ---------------------------------------------------------------------------

export function recordDocumentUploaded(ctx: ActivityContext, caseId: string, documentId: string, fileName: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_UPLOADED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: JSON.stringify({ fileName }),
      description: `Document uploaded: ${fileName}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordDocumentGenerated(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  templateId: string,
  templateVersion: number,
  templateName: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_GENERATED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: JSON.stringify({ templateId, templateVersion }),
      description: `Document generated from "${templateName}" (v${templateVersion})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordDocumentDownloaded(ctx: ActivityContext, caseId: string, documentId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_DOWNLOADED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: null,
      description: 'Document downloaded',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** A regeneration's own event, distinct from `recordDocumentGenerated` —
    `supersedesId` names the document row this new one replaces (that
    row's own status flips to 'superseded', never edited otherwise — see
    this phase's Invariants). */
export function recordDocumentRegenerated(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  supersedesId: string,
  templateVersion: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_REGENERATED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: JSON.stringify({ supersedesId }),
      newValue: JSON.stringify({ templateVersion }),
      description: `Document regenerated (supersedes ${supersedesId})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordDocumentArchived(ctx: ActivityContext, caseId: string, documentId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_ARCHIVED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: JSON.stringify({ status: 'active' }),
      newValue: JSON.stringify({ status: 'archived' }),
      description: 'Document archived',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordDocumentTemplateCreated(ctx: ActivityContext, templateId: string, templateName: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_TEMPLATE_CREATED,
      resourceType: 'documentTemplate',
      resourceId: templateId,
      previousValue: null,
      newValue: JSON.stringify({ name: templateName }),
      description: `Document template "${templateName}" created`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Fires only when an edit produces a new `DocumentTemplateVersion` —
    never for a metadata-only change (name/category), which has no
    dedicated event this phase since no route mutates those independently
    of a body edit (see services/documentTemplatesService.ts). */
export function recordDocumentTemplateUpdated(ctx: ActivityContext, templateId: string, newVersion: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_TEMPLATE_UPDATED,
      resourceType: 'documentTemplate',
      resourceId: templateId,
      previousValue: null,
      newValue: JSON.stringify({ version: newVersion }),
      description: `Document template updated (v${newVersion})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordDocumentTemplateArchived(ctx: ActivityContext, templateId: string, templateName: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_TEMPLATE_ARCHIVED,
      resourceType: 'documentTemplate',
      resourceId: templateId,
      previousValue: JSON.stringify({ status: 'active' }),
      newValue: JSON.stringify({ status: 'archived' }),
      description: `Document template "${templateName}" archived`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordDocumentTemplateRestored(ctx: ActivityContext, templateId: string, templateName: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.DOCUMENT_TEMPLATE_RESTORED,
      resourceType: 'documentTemplate',
      resourceId: templateId,
      previousValue: JSON.stringify({ status: 'archived' }),
      newValue: JSON.stringify({ status: 'active' }),
      description: `Document template "${templateName}" restored`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 26 (Electronic Signatures & Authorization Workflows). Every write in
// services/signatureService.ts records through exactly one of these — never
// a hand-constructed payload at the call site, matching every helper above.
// `resourceType`/`resourceId` always name the CaseDocument being signed
// (not the SignatureRequest itself), matching Phase 25's own document.*
// events; `signatureRequestId` travels in `metadata` for staff-facing
// traceability — never in a public-facing response body (see
// docs/adr/ADR-030-electronic-signatures-and-authorization-workflows.md).
// ---------------------------------------------------------------------------

export function recordSignatureRequested(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  signatureRequestId: string,
  signerName: string,
  signerEmail: string,
  signerRole: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_REQUESTED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: JSON.stringify({ signerEmail, signerRole }),
      description: `Signature requested from ${signerName} (${signerEmail})`,
      metadata: JSON.stringify({ signatureRequestId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Distinct from `recordSignatureRequested` — fires only once the
    signer's notification actually dispatches successfully (the
    request's own draft -> pending transition), never at request-creation
    time itself, since those two things can fail independently. */
export function recordSignatureEmailSent(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  signatureRequestId: string,
  signerEmail: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_EMAIL_SENT,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: null,
      description: `Signature request email sent to ${signerEmail}`,
      metadata: JSON.stringify({ signatureRequestId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Recorded on every access, not just the first — the request's own
    `viewedAt` timestamp is set only once, but every view is still worth
    an audit trail entry. */
export function recordSignatureViewed(ctx: ActivityContext, caseId: string, documentId: string, signatureRequestId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_VIEWED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: null,
      description: 'Signature request viewed by signer',
      metadata: JSON.stringify({ signatureRequestId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** The one signature event that corresponds to a real CaseDocument
    state transition (signatureStatus: 'pending_signature' -> 'signed') —
    ip/user-agent travel in metadata as a narrative copy of what the
    corresponding SignatureRecord row already stores structurally (see
    types/signatureRecord.ts's own header comment for why both exist). */
export function recordSignatureCompleted(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  signatureRequestId: string,
  signerName: string,
  ipAddress: string,
  userAgent: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_COMPLETED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: JSON.stringify({ signatureStatus: 'pending_signature' }),
      newValue: JSON.stringify({ signatureStatus: 'signed' }),
      description: `Signed by ${signerName}`,
      metadata: JSON.stringify({ signatureRequestId, ipAddress, userAgent }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordSignatureDeclined(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  signatureRequestId: string,
  signerName: string,
  reason: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_DECLINED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: reason ? JSON.stringify({ reason }) : null,
      description: `Signature declined by ${signerName}`,
      metadata: JSON.stringify({ signatureRequestId }),
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordSignatureCancelled(ctx: ActivityContext, caseId: string, documentId: string, signatureRequestId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_CANCELLED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: null,
      description: 'Signature request cancelled',
      metadata: JSON.stringify({ signatureRequestId }),
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordSignatureExpired(ctx: ActivityContext, caseId: string, documentId: string, signatureRequestId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'documents',
      eventType: ACTIVITY_EVENT_TYPES.SIGNATURE_EXPIRED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: null,
      description: 'Signature request expired',
      metadata: JSON.stringify({ signatureRequestId }),
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 27 (Scheduling & Resource Management). Every write in
// services/schedulingService.ts records through exactly one of these — never
// a hand-constructed payload at the call site, matching every helper above.
// `resourceType`/`resourceId` always name the Appointment (mirroring Phase
// 26's own `resourceType: 'caseDocument'` convention for every signature
// event) — the actual physical/staff Resource being assigned/released
// travels in `metadata`, never as `resourceId`, since one appointment can
// have many resources but this event stream is anchored to one appointment.
// ---------------------------------------------------------------------------

export function recordAppointmentCreated(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  appointmentType: string,
  startAt: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_CREATED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: JSON.stringify({ appointmentType, startAt }),
      description: `Appointment created for ${startAt}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordAppointmentUpdated(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  changedFields: Record<string, FieldChange>,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  const fieldNames = Object.keys(changedFields);
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_UPDATED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: fieldChangesToJson(changedFields, 'previous'),
      newValue: fieldChangesToJson(changedFields, 'next'),
      description: `Appointment updated (${fieldNames.join(', ')})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordAppointmentRescheduled(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  from: { startAt: string; endAt: string },
  to: { startAt: string; endAt: string },
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_RESCHEDULED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: JSON.stringify(from),
      newValue: JSON.stringify(to),
      description: `Appointment rescheduled to ${to.startAt}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordAppointmentCancelled(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  reason: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_CANCELLED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: reason ? JSON.stringify({ reason }) : null,
      description: 'Appointment cancelled',
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

/** `outcome` distinguishes a genuine `completed` appointment from a
    `no_show` terminal outcome — both are covered by this one event type,
    the `newValue` payload carries which. */
export function recordAppointmentCompleted(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  outcome: 'completed' | 'no_show',
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_COMPLETED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: JSON.stringify({ status: outcome }),
      description: outcome === 'no_show' ? 'Appointment marked as no-show' : 'Appointment completed',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordResourceAssigned(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  resourceId: string,
  resourceName: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.RESOURCE_ASSIGNED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: null,
      description: `${resourceName} assigned`,
      metadata: JSON.stringify({ resourceId, resourceName }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordResourceReleased(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  resourceId: string,
  resourceName: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.RESOURCE_RELEASED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: null,
      description: `${resourceName} released`,
      metadata: JSON.stringify({ resourceId, resourceName }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Fires only when a hard conflict was detected and an authorized
    override proceeded anyway — never for a soft (warning-only) conflict,
    which has nothing to "override." Always `severity: 'critical'`. */
export function recordResourceConflictOverridden(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  resourceId: string,
  resourceName: string,
  reason: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.RESOURCE_CONFLICT_OVERRIDDEN,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: JSON.stringify({ reason }),
      description: `Conflict overridden for ${resourceName}`,
      metadata: JSON.stringify({ resourceId, resourceName, reason }),
      severity: 'critical',
    }),
    dataAdapterMode,
  );
}

/** Phase 34 (Scheduling Integrations, Calendar Sync & Automated
    Reminders). Recorded exclusively from
    `services/calendarConnectionService.ts#completeAuthorization`, with
    `ctx.actorIdentityId` resolved from the connecting StaffProfile's own
    `identityId` (the OAuth callback route has no ordinary session-derived
    actor to pass in — see that function's own comment). */
export function recordCalendarConnected(
  ctx: ActivityContext,
  connectionId: string,
  provider: 'google' | 'microsoft',
  externalAccountEmail: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.CALENDAR_CONNECTED,
      resourceType: 'calendarConnection',
      resourceId: connectionId,
      previousValue: null,
      newValue: JSON.stringify({ provider, externalAccountEmail }),
      description: `${provider === 'google' ? 'Google' : 'Microsoft'} calendar connected (${externalAccountEmail})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Recorded exclusively from `services/calendarConnectionService.ts` —
    the DELETE route builds `ctx` from its own resolved caller (the
    owning staff member, or an administrator acting via `calendar.manage`),
    exactly like every other route-triggered activity event in this
    codebase. */
export function recordCalendarDisconnected(ctx: ActivityContext, connectionId: string, provider: 'google' | 'microsoft', dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.CALENDAR_DISCONNECTED,
      resourceType: 'calendarConnection',
      resourceId: connectionId,
      previousValue: null,
      newValue: null,
      description: `${provider === 'google' ? 'Google' : 'Microsoft'} calendar disconnected`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Recorded exclusively from `services/appointmentReminderService.ts`'s
    cron-triggered sweep — always system-generated (`ctx.actorIdentityId:
    null`), matching `recordNotificationSent`'s own posture for
    cron-originated writes. */
export function recordAppointmentReminderSent(ctx: ActivityContext, caseId: string | null, appointmentId: string, reminderId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_REMINDER_SENT,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: null,
      description: 'Appointment reminder sent',
      metadata: JSON.stringify({ reminderId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordAppointmentReminderFailed(
  ctx: ActivityContext,
  caseId: string | null,
  appointmentId: string,
  reminderId: string,
  failureReason: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'scheduling',
      eventType: ACTIVITY_EVENT_TYPES.APPOINTMENT_REMINDER_FAILED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: JSON.stringify({ failureReason }),
      description: 'Appointment reminder failed',
      metadata: JSON.stringify({ reminderId }),
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

/** Recorded exclusively from `services/calendarSyncService.ts`, only on
    the `retry_pending -> failed` terminal transition — never per
    transient retry (matches this event registry's own "no event for
    routine successful syncs" discipline, applied symmetrically to
    failures: only the terminal one is noise-worthy). Always
    system-generated — the cron sweep has no human actor. */
export function recordCalendarSyncFailed(ctx: ActivityContext, appointmentId: string, calendarConnectionId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'system',
      eventType: ACTIVITY_EVENT_TYPES.CALENDAR_SYNC_FAILED,
      resourceType: 'appointment',
      resourceId: appointmentId,
      previousValue: null,
      newValue: null,
      description: 'Calendar sync failed permanently for this appointment',
      metadata: JSON.stringify({ calendarConnectionId }),
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 28 (Communications & Notifications). Every write in
// services/notificationService.ts records through exactly one of these —
// never a hand-constructed payload at the call site, matching every helper
// above. `resourceType`/`resourceId` always name the Notification itself
// (mirroring Phase 27's own `resourceType: 'appointment'` convention for
// every scheduling event) — the recipient identity and channel a given
// Delivery-level event concerns travel in `metadata`, never as `resourceId`,
// since one Notification can have many recipients and this event stream is
// anchored to one notification.
// ---------------------------------------------------------------------------

export function recordNotificationCreated(
  ctx: ActivityContext,
  caseId: string | null,
  notificationId: string,
  notificationType: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'notifications',
      eventType: ACTIVITY_EVENT_TYPES.NOTIFICATION_CREATED,
      resourceType: 'notification',
      resourceId: notificationId,
      previousValue: null,
      newValue: JSON.stringify({ notificationType }),
      description: `Notification created (${notificationType})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Fires once, when the Notification's own production lifecycle reaches
    `active` — every Delivery has been attempted at least once. Says
    nothing about whether any individual Delivery actually succeeded; see
    `recordNotificationDelivered`/`recordNotificationFailed` for that. */
export function recordNotificationSent(ctx: ActivityContext, caseId: string | null, notificationId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'notifications',
      eventType: ACTIVITY_EVENT_TYPES.NOTIFICATION_SENT,
      resourceType: 'notification',
      resourceId: notificationId,
      previousValue: null,
      newValue: null,
      description: 'Notification sent',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordNotificationDelivered(
  ctx: ActivityContext,
  caseId: string | null,
  notificationId: string,
  identityId: string,
  channel: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'notifications',
      eventType: ACTIVITY_EVENT_TYPES.NOTIFICATION_DELIVERED,
      resourceType: 'notification',
      resourceId: notificationId,
      previousValue: null,
      newValue: null,
      description: `Delivered via ${channel}`,
      metadata: JSON.stringify({ identityId, channel }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordNotificationRead(
  ctx: ActivityContext,
  caseId: string | null,
  notificationId: string,
  identityId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'notifications',
      eventType: ACTIVITY_EVENT_TYPES.NOTIFICATION_READ,
      resourceType: 'notification',
      resourceId: notificationId,
      previousValue: null,
      newValue: null,
      description: 'Notification read',
      metadata: JSON.stringify({ identityId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordNotificationFailed(
  ctx: ActivityContext,
  caseId: string | null,
  notificationId: string,
  identityId: string,
  channel: string,
  reason: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'notifications',
      eventType: ACTIVITY_EVENT_TYPES.NOTIFICATION_FAILED,
      resourceType: 'notification',
      resourceId: notificationId,
      previousValue: null,
      newValue: JSON.stringify({ reason }),
      description: `Delivery failed via ${channel}`,
      metadata: JSON.stringify({ identityId, channel, reason }),
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordNotificationCancelled(ctx: ActivityContext, caseId: string | null, notificationId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'notifications',
      eventType: ACTIVITY_EVENT_TYPES.NOTIFICATION_CANCELLED,
      resourceType: 'notification',
      resourceId: notificationId,
      previousValue: null,
      newValue: null,
      description: 'Notification cancelled',
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 29 (Family Portal & External Collaboration). `recordPortalInvited`/
// `recordPortalAccessRevoked` are staff-initiated — called with the
// caller's own real `ActivityContext`, exactly like every helper above.
// `recordPortalAccepted`/`recordPortalLogin` are the Portal User's own
// actions — called with `services/portal/portalActivityContext.ts`'s
// anonymous-actor context (`actorIdentityId: null, isSystemGenerated:
// true`), mirroring `signatureService.ts`'s `signerActivityContext()`
// precedent exactly. Real, queryable attribution (which PortalUser, which
// relationshipType) is carried in `metadata` for those two, never in
// `actorIdentityId` — see `types/portalUser.ts`'s own header comment on
// why a PortalUser can never be identity-space.
// ---------------------------------------------------------------------------

export function recordPortalInvited(
  ctx: ActivityContext,
  caseId: string,
  invitationId: string,
  email: string,
  relationshipType: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_INVITED,
      resourceType: 'portalInvitation',
      resourceId: invitationId,
      previousValue: null,
      newValue: JSON.stringify({ email, relationshipType }),
      description: `Family Portal invitation sent to ${email} (${relationshipType})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordPortalAccepted(
  ctx: ActivityContext,
  caseId: string,
  invitationId: string,
  portalUserId: string,
  relationshipType: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_ACCEPTED,
      resourceType: 'portalInvitation',
      resourceId: invitationId,
      previousValue: null,
      newValue: null,
      description: 'Family Portal invitation accepted',
      metadata: JSON.stringify({ portalUserId, relationshipType }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordPortalAccessRevoked(
  ctx: ActivityContext,
  caseId: string,
  portalAccessId: string,
  relationshipType: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_ACCESS_REVOKED,
      resourceType: 'portalAccess',
      resourceId: portalAccessId,
      previousValue: null,
      newValue: null,
      description: `Family Portal access revoked (${relationshipType})`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordPortalDocumentViewed(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  portalUserId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_DOCUMENT_VIEWED,
      resourceType: 'caseDocument',
      resourceId: documentId,
      previousValue: null,
      newValue: null,
      description: 'Document viewed via Family Portal',
      metadata: JSON.stringify({ portalUserId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Recorded alongside `services/signatureService.ts`'s own (anonymously-
    attributed) `document.signature.completed` event whenever a family
    member — not an external one-shot signer — completes a signature via
    the Family Portal. Carries the real `portalUserId` in `metadata`,
    mirroring every other `recordPortal*` helper's own convention. */
export function recordPortalSignatureCompleted(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  signatureRequestId: string,
  portalUserId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_SIGNATURE_COMPLETED,
      resourceType: 'signatureRequest',
      resourceId: signatureRequestId,
      previousValue: null,
      newValue: null,
      description: 'Signature completed via Family Portal',
      metadata: JSON.stringify({ portalUserId, documentId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Recorded only for a family-sent message — `services/portal/portalMessagingService.ts`'s
    `sendFamilyMessage`. A staff-sent message has no equivalent
    `recordPortal*` call (it's a real, non-anonymous staff action, no
    different from any other staff activity event). */
export function recordPortalMessageSent(ctx: ActivityContext, caseId: string, messageId: string, portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_MESSAGE_SENT,
      resourceType: 'portalMessage',
      resourceId: messageId,
      previousValue: null,
      newValue: null,
      description: 'Message sent via Family Portal',
      metadata: JSON.stringify({ portalUserId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordPortalLogin(ctx: ActivityContext, portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'family_portal',
      eventType: ACTIVITY_EVENT_TYPES.PORTAL_LOGIN,
      resourceType: 'portalUser',
      resourceId: portalUserId,
      previousValue: null,
      newValue: null,
      description: 'Family Portal login',
      metadata: JSON.stringify({ portalUserId }),
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 31 (Financial Management & General Ledger). Category 'financial' —
// every one of these is called exclusively from
// services/chartOfAccountsService.ts / services/generalLedgerService.ts /
// services/financialTransactionService.ts / services/bankingService.ts —
// enforced by a structural test mirroring every other domain's own
// "only this service calls these record* builders" boundary.
// ---------------------------------------------------------------------------

export function recordJournalEntryPosted(
  ctx: ActivityContext,
  caseId: string | null,
  journalEntryId: string,
  entryNumber: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.JOURNAL_ENTRY_POSTED,
      resourceType: 'journalEntry',
      resourceId: journalEntryId,
      previousValue: null,
      newValue: null,
      description: `Journal entry ${entryNumber} posted`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordJournalEntryReversed(
  ctx: ActivityContext,
  caseId: string | null,
  journalEntryId: string,
  originalEntryNumber: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.JOURNAL_ENTRY_REVERSED,
      resourceType: 'journalEntry',
      resourceId: journalEntryId,
      previousValue: null,
      newValue: null,
      description: `Journal entry ${originalEntryNumber} reversed`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordJournalEntryVoided(
  ctx: ActivityContext,
  caseId: string | null,
  journalEntryId: string,
  entryNumber: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.JOURNAL_ENTRY_VOIDED,
      resourceType: 'journalEntry',
      resourceId: journalEntryId,
      previousValue: JSON.stringify({ status: 'draft' }),
      newValue: JSON.stringify({ status: 'void' }),
      description: `Journal entry ${entryNumber} voided`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordLedgerAccountCreated(
  ctx: ActivityContext,
  accountId: string,
  accountNumber: string,
  name: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.LEDGER_ACCOUNT_CREATED,
      resourceType: 'ledgerAccount',
      resourceId: accountId,
      previousValue: null,
      newValue: JSON.stringify({ accountNumber, name }),
      description: `Ledger account ${accountNumber} (${name}) created`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordLedgerAccountDeactivated(
  ctx: ActivityContext,
  accountId: string,
  accountNumber: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.LEDGER_ACCOUNT_DEACTIVATED,
      resourceType: 'ledgerAccount',
      resourceId: accountId,
      previousValue: JSON.stringify({ isActive: true }),
      newValue: JSON.stringify({ isActive: false }),
      description: `Ledger account ${accountNumber} deactivated`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordCaseWriteOffPosted(
  ctx: ActivityContext,
  caseId: string,
  writeOffId: string,
  amountCents: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.CASE_WRITE_OFF_POSTED,
      resourceType: 'caseWriteOff',
      resourceId: writeOffId,
      previousValue: null,
      newValue: JSON.stringify({ amountCents }),
      description: `$${(amountCents / 100).toFixed(2)} written off`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}

export function recordFinancialAdjustmentPosted(
  ctx: ActivityContext,
  caseId: string | null,
  journalEntryId: string,
  amountCents: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.FINANCIAL_ADJUSTMENT_POSTED,
      resourceType: 'journalEntry',
      resourceId: journalEntryId,
      previousValue: null,
      newValue: JSON.stringify({ amountCents }),
      description: `Adjustment posted for $${(amountCents / 100).toFixed(2)}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordBankDepositPosted(
  ctx: ActivityContext,
  bankDepositId: string,
  totalAmountCents: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.BANK_DEPOSIT_POSTED,
      resourceType: 'bankDeposit',
      resourceId: bankDepositId,
      previousValue: null,
      newValue: JSON.stringify({ totalAmountCents }),
      description: `Deposit posted for $${(totalAmountCents / 100).toFixed(2)}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordFundsTransferPosted(
  ctx: ActivityContext,
  journalEntryId: string,
  amountCents: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.FUNDS_TRANSFER_POSTED,
      resourceType: 'journalEntry',
      resourceId: journalEntryId,
      previousValue: null,
      newValue: JSON.stringify({ amountCents }),
      description: `Transfer posted for $${(amountCents / 100).toFixed(2)}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordBankStatementImported(
  ctx: ActivityContext,
  bankStatementImportId: string,
  lineCount: number,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.BANK_STATEMENT_IMPORTED,
      resourceType: 'bankStatementImport',
      resourceId: bankStatementImportId,
      previousValue: null,
      newValue: JSON.stringify({ lineCount }),
      description: `Bank statement imported (${lineCount} lines)`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordBankReconciliationStarted(
  ctx: ActivityContext,
  reconciliationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.BANK_RECONCILIATION_STARTED,
      resourceType: 'bankReconciliation',
      resourceId: reconciliationId,
      previousValue: null,
      newValue: null,
      description: 'Bank reconciliation started',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordBankReconciliationCompleted(
  ctx: ActivityContext,
  reconciliationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'financial',
      eventType: ACTIVITY_EVENT_TYPES.BANK_RECONCILIATION_COMPLETED,
      resourceType: 'bankReconciliation',
      resourceId: reconciliationId,
      previousValue: JSON.stringify({ status: 'in_progress' }),
      newValue: JSON.stringify({ status: 'completed' }),
      description: 'Bank reconciliation completed',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Phase 35 (Merchandise, Inventory & Commerce). `merchandise.product.*`
// recorded exclusively from services/merchandiseService.ts; `inventory.*`
// exclusively from services/inventoryService.ts (structural-test enforced).
// ---------------------------------------------------------------------------

export function recordMerchandiseProductCreated(
  ctx: ActivityContext,
  productId: string,
  snapshot: { sku: string; name: string },
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'inventory',
      eventType: ACTIVITY_EVENT_TYPES.MERCHANDISE_PRODUCT_CREATED,
      resourceType: 'merchandiseProduct',
      resourceId: productId,
      previousValue: null,
      newValue: JSON.stringify(snapshot),
      description: `Merchandise product created — ${snapshot.name} (${snapshot.sku})`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordMerchandiseProductUpdated(
  ctx: ActivityContext,
  productId: string,
  changedFields: Record<string, FieldChange>,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  const fieldNames = Object.keys(changedFields);
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'inventory',
      eventType: ACTIVITY_EVENT_TYPES.MERCHANDISE_PRODUCT_UPDATED,
      resourceType: 'merchandiseProduct',
      resourceId: productId,
      previousValue: fieldChangesToJson(changedFields, 'previous'),
      newValue: fieldChangesToJson(changedFields, 'next'),
      description: `Merchandise product updated — ${fieldNames.join(', ')}`,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordMerchandiseProductArchived(ctx: ActivityContext, productId: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'inventory',
      eventType: ACTIVITY_EVENT_TYPES.MERCHANDISE_PRODUCT_ARCHIVED,
      resourceType: 'merchandiseProduct',
      resourceId: productId,
      previousValue: JSON.stringify({ isActive: true }),
      newValue: JSON.stringify({ isActive: false }),
      description: 'Merchandise product archived',
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

/** Shared builder for the six stock-movement activity events — every
    inventory movement records who/what/where/how-many through one shape. */
function recordInventoryMovementEvent(
  ctx: ActivityContext,
  eventType: string,
  caseId: string | null,
  productId: string,
  description: string,
  metadata: Record<string, unknown>,
  dataAdapterMode: DataAdapterMode,
): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId,
      category: 'inventory',
      eventType,
      resourceType: 'merchandiseProduct',
      resourceId: productId,
      previousValue: null,
      newValue: JSON.stringify(metadata),
      description,
      metadata: null,
      severity: 'info',
    }),
    dataAdapterMode,
  );
}

export function recordInventoryReceived(ctx: ActivityContext, productId: string, locationId: string, quantity: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return recordInventoryMovementEvent(ctx, ACTIVITY_EVENT_TYPES.INVENTORY_RECEIVED, null, productId, `Received ${quantity} unit${quantity === 1 ? '' : 's'} into stock`, { locationId, quantity }, dataAdapterMode);
}

export function recordInventoryReserved(ctx: ActivityContext, caseId: string, productId: string, locationId: string, quantity: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return recordInventoryMovementEvent(ctx, ACTIVITY_EVENT_TYPES.INVENTORY_RESERVED, caseId, productId, `Reserved ${quantity} unit${quantity === 1 ? '' : 's'} for a case`, { caseId, locationId, quantity }, dataAdapterMode);
}

export function recordInventoryReleased(ctx: ActivityContext, caseId: string, productId: string, locationId: string, quantity: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return recordInventoryMovementEvent(ctx, ACTIVITY_EVENT_TYPES.INVENTORY_RELEASED, caseId, productId, `Released ${quantity} reserved unit${quantity === 1 ? '' : 's'}`, { caseId, locationId, quantity }, dataAdapterMode);
}

export function recordInventoryFulfilled(ctx: ActivityContext, caseId: string, productId: string, locationId: string, quantity: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return recordInventoryMovementEvent(ctx, ACTIVITY_EVENT_TYPES.INVENTORY_FULFILLED, caseId, productId, `Fulfilled ${quantity} unit${quantity === 1 ? '' : 's'} from stock`, { caseId, locationId, quantity }, dataAdapterMode);
}

export function recordInventoryReturned(ctx: ActivityContext, caseId: string, productId: string, locationId: string, quantity: number, restocked: boolean, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return recordInventoryMovementEvent(ctx, ACTIVITY_EVENT_TYPES.INVENTORY_RETURNED, caseId, productId, `Returned ${quantity} unit${quantity === 1 ? '' : 's'} (${restocked ? 'restocked' : 'not restocked'})`, { caseId, locationId, quantity, restocked }, dataAdapterMode);
}

export function recordInventoryTransferred(ctx: ActivityContext, productId: string, fromLocationId: string, toLocationId: string, quantity: number, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return recordInventoryMovementEvent(ctx, ACTIVITY_EVENT_TYPES.INVENTORY_TRANSFERRED, null, productId, `Transferred ${quantity} unit${quantity === 1 ? '' : 's'} between locations`, { fromLocationId, toLocationId, quantity }, dataAdapterMode);
}

export function recordInventoryAdjusted(ctx: ActivityContext, productId: string, locationId: string, quantityDelta: number, reason: string, dataAdapterMode: DataAdapterMode): Promise<ActivityEvent> {
  return record(
    envelope(ctx, {
      caseId: null,
      category: 'inventory',
      eventType: ACTIVITY_EVENT_TYPES.INVENTORY_ADJUSTED,
      resourceType: 'merchandiseProduct',
      resourceId: productId,
      previousValue: null,
      newValue: JSON.stringify({ locationId, quantityDelta, reason }),
      description: `Inventory adjusted by ${quantityDelta > 0 ? '+' : ''}${quantityDelta} — ${reason}`,
      metadata: null,
      severity: 'warning',
    }),
    dataAdapterMode,
  );
}
