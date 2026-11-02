import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { buildServiceChangeCasePatch, caseRevision, type WixCaseItem } from '../lib/wixCaseMapper';
import { loadCaseRow, writeCaseFields } from './caseWriteService';
import { caseFixtures } from './__mocks__/fixtures';
import { listOrganizationWorkflowTemplates } from './organizationWorkflowTemplates';
import {
  getActiveCaseOrder,
  getServiceCatalog,
  listLineItemsForOrder,
  prepareCaseOrderChange,
  commitPreparedCaseOrderChange,
  revertCommittedCaseOrderChange,
  CaseOrderCommitError,
  CaseOrderInterruptedError,
  CaseOrderJournalUnavailableError,
  UnpricedCatalogItemError,
  type CommittedCaseOrderChange,
  type PreparedCaseOrderChange,
} from './pricingService';
import {
  recordCaseOrderChanged,
  recordWorkflowChanged,
  recordServiceChangeCompensated,
  recordServiceChangeFailed,
  type ActivityContext,
  type ServiceChangeFailureDetails,
} from './activityService';
import { normalizeSelections, serviceTypeItems } from '../domain/pricing/calculateOrder';
import {
  applyWorkflowChangeToCase,
  planCaseWorkflowChange,
  type WorkflowChangePreview,
  type WorkflowChangeWrite,
} from '../domain/workflow/planCaseWorkflowChange';
import type { Case } from '../types/case';
import { CASE_REVISION_CONFLICT_REASON, CASE_REVISION_REQUIRED_MESSAGE, CASE_REVISION_REQUIRED_REASON } from '../domain/cases/caseRevisionConflict';
import { recordServiceChangeJournal, type ServiceChangeJournalDetails, type ServiceChangeJournalStatus } from './serviceChangeJournal';
import type { CaseOrder, CaseOrderLineItem } from '../types/caseOrder';
import { caseOrderInterruptionBody } from '../domain/pricing/caseOrderInterruption';

/**
 * Consistent service changes (2026-10). ONE server operation for changing
 * a case's service type — the case's workflow (snapshot, remapped
 * progress, history) and its case order (new priced version) change
 * together or not at all. Before this, Edit Services saved them in two
 * independent requests; if the second failed the first stood, leaving a
 * case on the new workflow with the old order (or vice versa).
 *
 * Wix Data has no multi-document transactions, so this is NOT atomic in
 * the database sense. It is prepare → commit → compensate:
 *
 *  PREPARE (reads only — any refusal here writes nothing):
 *   - the case, scoped to the caller's organization (404 otherwise);
 *   - the workflow plan (planCaseWorkflowChange: only an APPROVED target,
 *     409 if the case's workflow moved since the preview);
 *   - the order recalculation (prepareCaseOrderChange: 422 for an
 *     unpriced selection, 503 if the catalog can't be read);
 *   - the order precondition: the active order must still be the one the
 *     preview was computed against (409 otherwise).
 *
 *  COMMIT, in this order:
 *   1. the order (commitPreparedCaseOrderChange) — a new version behind a
 *      compare-and-swap on the previous version's status, so a concurrent
 *      order edit is detected (409) before anything visible is written;
 *   2. the case — ONE conditional patch (conditionalPatchWixDataItemFields)
 *      setting the new snapshot, remapped checklist/field values, stage,
 *      appended workflowHistory entry and the `lastServiceChangeId` fencing
 *      token together, conditioned on the workflow/stage/token the plan was
 *      made from. This single atomic write is the commit point.
 *
 *  COMPENSATE: if step 2 is refused (concurrent change → 409) or fails
 *  (→ 503), step 1 is undone by APPENDING a restoring order version with
 *  the exact previous lines plus a reversing revenue entry
 *  (revertCommittedCaseOrderChange) — nothing is ever deleted, so billing
 *  history shows what happened. A clean undo records
 *  `case.service_change.compensated` (warning). If the undo itself fails,
 *  `case.service_change.failed` (critical, `needsRepair: true`) is
 *  recorded and the response is a 500 that says so — never a silent
 *  inconsistency.
 *
 *  IDEMPOTENCY: a confirmed change carries a client-generated
 *  `idempotencyKey`, stored on the appended history entry
 *  (`serviceChangeId`) and as the case's fencing token. A retry of an
 *  already-applied change finds it and returns the stored result without
 *  writing. A retry after a crash between steps 1 and 2 finds the order
 *  already at the requested selections (no new version) and only writes
 *  the case.
 *
 *  JOURNAL (case concurrency, 2026-10): every confirmed change appends
 *  `case.service_change.journal` entries — `prepared` BEFORE the first
 *  write (refused with 503, nothing written, if that can't be recorded),
 *  then `order_committed`, `case_committed` / `compensated` / `failed`
 *  (services/serviceChangeJournal.ts). The prepared entry carries the
 *  plan, including the new order's id, so an operation a crash cut off
 *  between the two writes can be FOUND afterwards — GET
 *  /api/cases/service-change-operations — and an administrator can
 *  complete or compensate exactly that one operation.
 *
 *  The case patch is conditioned on the case's `revision` too (every case
 *  write increments it — services/caseWriteService.ts), so a checklist
 *  tick, field edit or payment landing between the plan and the write is
 *  detected (409, compensated) rather than silently overwritten with the
 *  plan's remapped copy.
 *
 *  WHAT IS NOT COVERED: a process crash between steps 1 and 2 still
 *  leaves the new order without the new workflow until someone acts —
 *  no compensation can run in a dead process. It is now journaled and
 *  listed (after SERVICE_CHANGE_INTERRUPTED_AFTER_MS) for an
 *  administrator, and retrying the same request (same idempotencyKey)
 *  still converges. The multi-field conditional patch is not yet
 *  live-verified against Wix (see docs/WIX_LIVE_VERIFICATION_PLAN.md).
 *  See docs/CASE_CONCURRENCY.md for the full failure-window analysis.
 *
 * Success records `case.order.changed` and `case.workflow.changed` with
 * the same correlation id, so the activity feed links the two halves.
 */

export type ServiceChangeOrderPreview = {
  unchanged: boolean;
  currentOrderId: string | null;
  currentTotal: number | null;
  newTotal: number;
  changes: string[];
};

export type ServiceChangeRequest = {
  organizationId: string;
  caseId: string;
  userId: string;
  role: string | null;
  correlationId: string;
  serviceTypeCode: string;
  expectedWorkflowTemplateId: string;
  /** The active order id the preview was computed against (null = the case
      had none). Undefined = not checked (preview only). */
  expectedOrderId?: string | null;
  selections: Record<string, unknown>;
  confirm: boolean;
  idempotencyKey: string | null;
  /**
   * Phase 5A.1. The case revision the confirmed preview was computed
   * against (every preview returns it as `caseRevision`). A confirm against
   * a case anyone has changed since is refused 409 `revision_conflict`
   * before anything is written. The staff route requires it with
   * `confirm`; `'repair'` is the administrator repair of a journaled,
   * interrupted operation (app/api/cases/service-change-operations/…) — a
   * server-side writer pinned to its own fresh read: the case write is
   * still conditional on the revision it read, never an overwrite.
   */
  expectedRevision?: number | 'repair';
};

export type ServiceChangeOutcome = { status: number; body: Record<string, unknown> };

type LoadedCase = { case_: Case; wixItem: { id: string; data: WixCaseItem } | null };

async function loadCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<LoadedCase | null> {
  if (dataAdapterMode === 'mock') {
    const found = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    return found ? { case_: found, wixItem: null } : null;
  }
  // Scoped to the organization; a row of another organization the backend
  // returned anyway is never treated as this organization's case.
  const row = await loadCaseRow(organizationId, caseId);
  return row ? { case_: row.case_, wixItem: { id: row.id, data: row.data } } : null;
}

function selectionsServiceTypeCode(selections: Record<string, unknown>): string | null {
  const services = selections.services && typeof selections.services === 'object' ? (selections.services as Record<string, unknown>) : selections;
  const normalized = normalizeSelections(services);
  return typeof normalized.serviceTypeCode === 'string' ? normalized.serviceTypeCode : null;
}

function orderPreview(prepared: PreparedCaseOrderChange): ServiceChangeOrderPreview {
  if (prepared.kind === 'unchanged') {
    return { unchanged: true, currentOrderId: prepared.order.id, currentTotal: prepared.order.total, newTotal: prepared.order.total, changes: [] };
  }
  return {
    unchanged: false,
    currentOrderId: prepared.current?.id ?? null,
    currentTotal: prepared.current?.total ?? null,
    newTotal: prepared.newOrder.total,
    changes: (prepared.diffEntries.length > 0 ? prepared.diffEntries : prepared.auditEntries).map((entry) => entry.description),
  };
}

type CaseWriteResult = { result: 'applied'; case_: Case } | { result: 'conflict' | 'failed'; reason: string };

/**
 * The commit point: the case's workflow change as one compare-and-swap.
 * Mock: an in-memory comparison of the same fields the Wix condition uses.
 * Wix: a refused/failed patch is re-read before being reported, so a lost
 * response to a patch that DID apply is recognised as applied.
 */
async function writeCaseWorkflow(
  loaded: LoadedCase,
  write: WorkflowChangeWrite,
  stamp: { changedAt: string; changedByUserId: string },
  serviceChangeId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseWriteResult> {
  const before = loaded.case_;
  if (dataAdapterMode === 'mock') {
    const index = caseFixtures.findIndex((c) => c.id === before.id && c.organizationId === before.organizationId);
    const current = index === -1 ? null : caseFixtures[index];
    if (
      !current ||
      current.workflowTemplateId !== before.workflowTemplateId ||
      current.workflowTemplateVersion !== before.workflowTemplateVersion ||
      current.rawStage !== before.rawStage ||
      (current.lastServiceChangeId ?? null) !== (before.lastServiceChangeId ?? null) ||
      caseRevision(current) !== caseRevision(before)
    ) {
      return { result: 'conflict', reason: 'the case changed since it was read' };
    }
    const applied = applyWorkflowChangeToCase(current, write, stamp);
    const history = applied.workflowHistory ?? [];
    const updated: Case = {
      ...applied,
      lastServiceChangeId: serviceChangeId,
      workflowHistory: [...history.slice(0, -1), { ...history[history.length - 1], serviceChangeId }],
      revision: caseRevision(current) + 1,
    };
    caseFixtures[index] = updated;
    return { result: 'applied', case_: updated };
  }

  const wixItem = loaded.wixItem!;
  const patch = buildServiceChangeCasePatch(wixItem.data, {
    workflowTemplateId: write.workflowTemplateId,
    workflowTemplateVersion: write.workflowTemplateVersion,
    workflowSnapshot: write.workflowSnapshot,
    caseType: write.caseType,
    rawStage: write.rawStage,
    checklistState: write.checklistState,
    fieldValues: write.fieldValues,
    historyEntry: { ...write.previous, ...stamp },
    serviceChangeId,
  });
  const written = await writeCaseFields(wixItem, patch.fields, { extraCondition: patch.extraCondition });
  if (written.result === 'applied') return { result: 'applied', case_: written.case_ };
  // writeCaseFields already re-read the row: a lost response to a patch
  // that DID apply is reported as applied. Belt and braces — the fencing
  // token in history is the operation's own proof of having landed.
  const reread = await loadCase(before.organizationId, before.id, dataAdapterMode).catch(() => null);
  if (reread?.case_.workflowHistory?.some((entry) => entry.serviceChangeId === serviceChangeId)) {
    return { result: 'applied', case_: reread.case_ };
  }
  if (written.result === 'conflict') return { result: 'conflict', reason: 'the case changed since it was read' };
  if (written.result === 'not_found') return { result: 'failed', reason: 'the case no longer exists' };
  return { result: 'failed', reason: written.reason };
}

/** Previews (confirm: false) or applies (confirm: true) a service change.
    Authorization and the organization feature flag are the caller's
    (app/api/cases/[caseId]/service-change/route.ts). Throws only for an
    unexpected read failure before any write (the route answers 503). */
export async function changeCaseService(request: ServiceChangeRequest, dataAdapterMode: DataAdapterMode): Promise<ServiceChangeOutcome> {
  const { organizationId, caseId, userId, serviceTypeCode, idempotencyKey } = request;
  const idFactory = () => crypto.randomUUID();
  const activityContext: ActivityContext = {
    organizationId,
    actorIdentityId: userId,
    actorMembershipId: null,
    actorRoleKey: request.role,
    correlationId: request.correlationId,
  };

  if (selectionsServiceTypeCode(request.selections) !== serviceTypeCode) {
    return { status: 400, body: { error: "selections.serviceTypeCode must be the service the case is changing to." } };
  }

  // ---- PREPARE (no writes) -------------------------------------------
  const loaded = await loadCase(organizationId, caseId, dataAdapterMode);
  if (!loaded) return { status: 404, body: { error: `Case ${caseId} not found for this organization` } };
  const existing = loaded.case_;
  if (existing.isDeleted) {
    return { status: 409, body: { error: 'Archived cases are read-only. Restore the case before changing its service.' } };
  }

  // Idempotent retry of a change that already applied: report it, write nothing.
  if (request.confirm && idempotencyKey && existing.workflowHistory?.some((entry) => entry.serviceChangeId === idempotencyKey)) {
    const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
    const lineItems = order ? await listLineItemsForOrder(organizationId, order.id, dataAdapterMode) : [];
    return { status: 200, body: { applied: true, replayed: true, serviceChangeId: idempotencyKey, case: existing, order, lineItems } };
  }

  // Phase 5A.1: a confirm is pinned to the revision its preview was made
  // on — anything written to the case since (a checklist tick, a payment,
  // another service change) means staff confirmed something they no longer
  // see. Refused before any write; the client re-previews.
  if (request.confirm && request.expectedRevision !== 'repair') {
    if (typeof request.expectedRevision !== 'number') {
      return { status: 428, body: { error: CASE_REVISION_REQUIRED_MESSAGE, reason: CASE_REVISION_REQUIRED_REASON } };
    }
    if (caseRevision(existing) !== request.expectedRevision) {
      return {
        status: 409,
        body: {
          error: 'This case was changed by someone else since the preview was shown. Nothing was changed — reload the case and try again.',
          reason: CASE_REVISION_CONFLICT_REASON,
          case: existing,
          currentRevision: caseRevision(existing),
        },
      };
    }
  }

  const [templates, catalog] = await Promise.all([
    listOrganizationWorkflowTemplates(organizationId, dataAdapterMode),
    getServiceCatalog(organizationId, dataAdapterMode),
  ]);
  const serviceTypes = serviceTypeItems(catalog);
  const plan = planCaseWorkflowChange(
    existing,
    templates,
    { serviceTypeCode, expectedWorkflowTemplateId: request.expectedWorkflowTemplateId },
    {
      activeServiceTypeCodes: serviceTypes.map((item) => item.serviceCode),
      serviceDisplayName: (code) => serviceTypes.find((item) => item.serviceCode === code)?.displayName,
    },
  );
  if (!plan.ok) return { status: plan.status, body: { error: plan.message, reason: plan.reason } };

  let prepared: PreparedCaseOrderChange;
  try {
    prepared = await prepareCaseOrderChange(
      { organizationId, caseId, selections: request.selections, performedBy: userId, idFactory },
      dataAdapterMode,
    );
  } catch (error) {
    if (error instanceof UnpricedCatalogItemError) {
      return {
        status: 422,
        body: {
          error: error.message,
          reason: 'unpriced',
          unpricedItems: error.unpricedItems.map((item) => ({ serviceCode: item.serviceCode, displayName: item.displayName })),
        },
      };
    }
    // Phase 5A.2: an unfinished order change holds the case's order — the
    // service change is refused before anything (its journal included) is
    // written.
    if (error instanceof CaseOrderInterruptedError) {
      return { status: 409, body: caseOrderInterruptionBody(error.interruption, error.message) };
    }
    throw error;
  }

  // The order must still be the one the preview was computed against —
  // unless it already IS what this change asks for (a retry after a crash
  // between the two writes), in which case nothing of anyone's is
  // overwritten.
  const activeOrderId = prepared.kind === 'unchanged' ? prepared.order.id : prepared.current?.id ?? null;
  if (request.expectedOrderId !== undefined && activeOrderId !== request.expectedOrderId && prepared.kind !== 'unchanged') {
    return {
      status: 409,
      body: { error: "This case's services were changed by someone else since the preview was shown. Reload the case and try again.", reason: 'stale_order' },
    };
  }

  const preview: WorkflowChangePreview = plan.preview;
  if (!request.confirm) {
    return { status: 200, body: { applied: false, preview, order: orderPreview(prepared), caseRevision: caseRevision(existing) } };
  }
  if (!idempotencyKey) return { status: 400, body: { error: 'idempotencyKey is required to confirm a service change.' } };
  if (plan.write === null && prepared.kind === 'unchanged') {
    return { status: 200, body: { applied: false, preview, order: orderPreview(prepared) } };
  }

  const failureDetails = (failedStep: 'order' | 'case', reason: string): ServiceChangeFailureDetails => ({
    serviceChangeId: idempotencyKey,
    failedStep,
    reason,
    fromServiceTypeCode: preview.from.serviceTypeCode,
    toServiceTypeCode: serviceTypeCode,
    committedOrderId: null,
    restoredOrderId: null,
  });

  /** Operation journal (services/serviceChangeJournal.ts). Best-effort
      after `prepared`: the journal only points at an operation; the case
      and order are always what is inspected. */
  async function journal(status: Exclude<ServiceChangeJournalStatus, 'prepared' | 'resolved'>, details: ServiceChangeJournalDetails = {}): Promise<void> {
    try {
      await recordServiceChangeJournal(activityContext, { serviceChangeId: idempotencyKey!, caseId, status, details }, dataAdapterMode);
    } catch (error) {
      console.error(`Failed to record service change journal entry (${status}):`, error instanceof Error ? error.message : error, JSON.stringify({ caseId, organizationId, serviceChangeId: idempotencyKey }));
    }
  }

  async function recordFailure(kind: 'compensated' | 'failed', details: ServiceChangeFailureDetails): Promise<void> {
    await journal(kind, {
      reason: details.reason,
      committedOrderId: details.committedOrderId,
      restoredOrderId: details.restoredOrderId,
    });
    try {
      if (kind === 'compensated') await recordServiceChangeCompensated(activityContext, caseId, details, dataAdapterMode);
      else await recordServiceChangeFailed(activityContext, caseId, details, dataAdapterMode);
    } catch (error) {
      // Last resort when even the marker can't be written: the full
      // details go to the server log, never nowhere.
      console.error(`Failed to record case.service_change.${kind} activity event:`, error instanceof Error ? error.message : error, JSON.stringify({ caseId, organizationId, ...details }));
    }
  }

  const needsRepairResponse = (message: string): ServiceChangeOutcome => ({
    status: 500,
    body: {
      error: `${message} The case's services and workflow may disagree and need repair — this has been recorded in Activity (reference ${request.correlationId}).`,
      reason: 'needs_repair',
      needsRepair: true,
      correlationId: request.correlationId,
    },
  });

  // ---- JOURNAL: prepared (before ANY write) ----------------------------
  // Case concurrency (2026-10): what this operation is about to do, with
  // the new order's id known in advance — so if the process dies between
  // the two writes, the interrupted operation can be FOUND and repaired
  // (services/serviceChangeJournal.ts). If even this can't be recorded,
  // nothing is written: an unjournaled partial change is the one outcome
  // this must never risk.
  try {
    await recordServiceChangeJournal(
      activityContext,
      {
        serviceChangeId: idempotencyKey,
        caseId,
        status: 'prepared',
        details: {
          fromServiceTypeCode: preview.from.serviceTypeCode,
          toServiceTypeCode: serviceTypeCode,
          expectedWorkflowTemplateId: existing.workflowTemplateId,
          selections: request.selections,
          previousOrderId: prepared.kind === 'change' ? (prepared.current?.id ?? null) : prepared.order.id,
          plannedOrderId: prepared.kind === 'change' ? prepared.newOrder.id : prepared.order.id,
          serviceDelta: prepared.kind === 'change' ? prepared.serviceDelta : 0,
          merchandiseDelta: prepared.kind === 'change' ? prepared.merchandiseDelta : 0,
        },
      },
      dataAdapterMode,
    );
  } catch (error) {
    return {
      status: 503,
      body: { error: `The service change could not be started (${error instanceof Error ? error.message : 'journal unavailable'}). Nothing was changed — try again.`, reason: 'journal_unavailable' },
    };
  }

  // ---- COMMIT 1: the order --------------------------------------------
  let committed: CommittedCaseOrderChange | null = null;
  if (prepared.kind === 'change') {
    try {
      committed = await commitPreparedCaseOrderChange(prepared, { idFactory, journalContext: activityContext }, dataAdapterMode);
    } catch (error) {
      if (error instanceof CaseOrderInterruptedError || error instanceof CaseOrderJournalUnavailableError) {
        // Refused before any order write (the case's order is held by
        // another unfinished change, or its journal couldn't be started).
        await journal('compensated', { reason: `the case order could not be changed: ${error.message}` });
        return error instanceof CaseOrderInterruptedError
          ? { status: 409, body: caseOrderInterruptionBody(error.interruption, error.message) }
          : { status: 503, body: { error: error.message, reason: 'journal_unavailable' } };
      }
      if (!(error instanceof CaseOrderCommitError)) throw error;
      if (!error.compensated) {
        await recordFailure('failed', { ...failureDetails('order', error.message), compensationError: error.compensationError });
        return needsRepairResponse('The service change could not be saved.');
      }
      if (error.conflict) {
        await journal('compensated', { reason: 'the case order changed since the preview; nothing was written' });
        return { status: 409, body: { error: error.message, reason: 'stale_order' } };
      }
      await recordFailure('compensated', failureDetails('order', error.message));
      return { status: 503, body: { error: `${error.message} Nothing was changed — try again.`, reason: 'order_write_failed' } };
    }
  }

  if (committed) await journal('order_committed', { committedOrderId: committed.order.id, revenuePosted: committed.revenuePosted });

  // ---- COMMIT 2: the case (the commit point) ----------------------------
  let updatedCase: Case = existing;
  if (plan.write) {
    const written = await writeCaseWorkflow(
      loaded,
      plan.write,
      { changedAt: new Date().toISOString(), changedByUserId: userId },
      idempotencyKey,
      dataAdapterMode,
    );
    if (written.result !== 'applied') {
      // ---- COMPENSATE ---------------------------------------------------
      const details = { ...failureDetails('case', written.reason), committedOrderId: committed?.order.id ?? null };
      if (committed) {
        try {
          const restored = await revertCommittedCaseOrderChange(committed, { idFactory, reason: written.reason, journalContext: activityContext }, dataAdapterMode);
          await recordFailure('compensated', { ...details, restoredOrderId: restored?.id ?? null });
        } catch (error) {
          await recordFailure('failed', { ...details, compensationError: error instanceof Error ? error.message : String(error) });
          return needsRepairResponse('The service change could not be completed and could not be undone.');
        }
      }
      // With no order write of its own (the order was already as requested
      // — possibly by an EARLIER attempt of this same change), this request
      // wrote nothing, but the journal deliberately stays where it was: if
      // that earlier attempt's order is what is active, the case and order
      // still disagree, and the operation must stay findable.
      return written.result === 'conflict'
        ? { status: 409, body: { error: "This case was changed by someone else since the preview was shown. Nothing was changed — reload the case and try again.", reason: 'stale_case' } }
        : { status: 503, body: { error: `The case could not be saved (${written.reason}). Nothing was changed — try again.`, reason: 'case_write_failed' } };
    }
    updatedCase = written.case_;
  }

  await journal('case_committed');

  // ---- SUCCESS: linked activity events (best-effort) -------------------
  if (committed) {
    try {
      const entries = committed.prepared.diffEntries.length > 0 ? committed.prepared.diffEntries : committed.auditEntries;
      await recordCaseOrderChanged(activityContext, caseId, committed.order.id, entries, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record case.order.changed activity event:', error instanceof Error ? error.message : error);
    }
  }
  if (plan.write) {
    try {
      await recordWorkflowChanged(
        activityContext,
        caseId,
        {
          from: {
            workflowTemplateId: preview.from.workflowTemplateId,
            workflowName: preview.from.workflowName,
            serviceTypeCode: preview.from.serviceTypeCode,
            stage: preview.from.stageLabel,
          },
          to: {
            workflowTemplateId: preview.to.workflowTemplateId,
            workflowName: preview.to.workflowName ?? preview.to.workflowTemplateId,
            serviceTypeCode: preview.to.serviceTypeCode,
            stage: preview.to.stageLabel,
          },
          keptCount: preview.kept.length,
          notCarriedCount: preview.notCarried.length,
          newRequirementCount: preview.newRequirements.length,
        },
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Failed to record case.workflow.changed activity event:', error instanceof Error ? error.message : error);
    }
  }

  const order: CaseOrder | null = committed ? committed.order : prepared.kind === 'unchanged' ? prepared.order : null;
  const lineItems: CaseOrderLineItem[] = committed ? committed.lineItems : prepared.kind === 'unchanged' ? prepared.lineItems : [];
  return {
    status: 200,
    body: { applied: true, serviceChangeId: idempotencyKey, correlationId: request.correlationId, preview, case: updatedCase, order, lineItems },
  };
}
