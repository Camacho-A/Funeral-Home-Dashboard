import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { updateCaseWithRetry, writeMockCase } from './caseWriteService';
import { recordChecklistItemCompletedAutomatically } from './activityService';
import { isArrangementFormLinked } from './workflowReconciliationService';
import type { Case } from '../types/case';
import {
  automaticChecklistCompletion,
  findArrangementFormChecklistItem,
  isChecklistAutomationEnabled,
  type AutomaticTrigger,
  type ChecklistItemLocation,
} from '../domain/workflow/checklistAutomation';
import { checklistItemKey } from '../domain/workflow/checklistItemKey';
import { presentedChecklistLabel } from '../domain/organization/checklistRelabel';

/**
 * Automatic checklist completion (2026-10) — the write side. The decision
 * is domain/workflow/checklistAutomation.ts; this applies it to the case as
 * it is at write time (field-scoped, revision-conditioned, re-decided on a
 * conflicting write) and records ONE activity event when — and only when —
 * the item actually changed.
 */

export type AutomaticCompletionOutcome = 'completed' | 'unchanged' | 'not_applicable';

const TRIGGER_DESCRIPTION: Record<string, string> = {
  'payment.paid_in_full': 'payment received in full',
  'crematory.package_submitted': 'sent to the crematory through SOLIS',
  'external_form.arrangement_received': 'Arrangement Form received',
  'sla.event_recorded': 'workflow event recorded',
};

function itemLabel(case_: Case, location: ChecklistItemLocation): string {
  const stage = case_.workflowSnapshot?.stages.find((candidate) => candidate.displayStage === location.displayStage);
  const item = stage?.checklist.items.find((candidate) => candidate.index === location.index);
  return item ? presentedChecklistLabel(case_.organizationId, location.displayStage, item) : 'Checklist item';
}

/** Records the audit event for an applied completion. Best-effort: the
    completion itself has already been written. */
export async function recordAutomaticCompletion(
  case_: Case,
  location: ChecklistItemLocation,
  trigger: AutomaticTrigger,
  dataAdapterMode: DataAdapterMode,
  correlationId: string = crypto.randomUUID(),
  /** The staff member whose action proved the item (2026-10); SOLIS otherwise. */
  actor: { identityId: string; roleKey: string | null } | null = null,
): Promise<void> {
  try {
    await recordChecklistItemCompletedAutomatically(
      {
        organizationId: case_.organizationId,
        actorIdentityId: actor?.identityId ?? null,
        actorMembershipId: null,
        actorRoleKey: actor?.roleKey ?? null,
        correlationId,
        isSystemGenerated: !actor,
      },
      case_.id,
      {
        key: checklistItemKey(location.displayStage, location.index),
        label: itemLabel(case_, location),
        source: trigger.source,
        eventType: trigger.eventType,
        eventId: trigger.eventId,
        sourceLabel: TRIGGER_DESCRIPTION[trigger.eventType] ?? trigger.eventType,
      },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record an automatic checklist completion:', error instanceof Error ? error.message : error);
  }
}

/**
 * Completes one checklist item from a verified event. `locate` finds the
 * item in the case's own snapshot (null: this template has no such item).
 */
export async function completeChecklistItemAutomatically(
  organizationId: string,
  caseId: string,
  trigger: AutomaticTrigger,
  locate: (case_: Case) => ChecklistItemLocation | null,
  dataAdapterMode: DataAdapterMode,
): Promise<AutomaticCompletionOutcome> {
  if (!isChecklistAutomationEnabled(organizationId)) return 'not_applicable';
  const now = new Date().toISOString();
  let applied: { case_: Case; location: ChecklistItemLocation } | null = null;

  if (dataAdapterMode === 'mock') {
    const current = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    const location = current ? locate(current) : null;
    const patch = current && location ? automaticChecklistCompletion(current, location, trigger, now) : null;
    if (current && location && patch) {
      writeMockCase(organizationId, caseId, (latest) => ({
        ...latest,
        checklistState: { ...latest.checklistState, ...patch.checklistState },
        checklistCompletions: { ...latest.checklistCompletions, ...patch.checklistCompletions },
      }));
      applied = { case_: current, location };
    }
  } else {
    const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
      applied = null;
      const location = locate(row.case_);
      const patch = location ? automaticChecklistCompletion(row.case_, location, trigger, now) : null;
      if (!location || !patch) return null;
      applied = { case_: row.case_, location };
      return buildCaseFieldPatch(row.data, patch);
    });
    if (outcome.result === 'conflict') throw new Error(`Automatic checklist completion for case ${caseId} lost to concurrent writes on every attempt.`);
    if (outcome.result === 'failed') throw new Error(`Automatic checklist completion for case ${caseId} failed: ${outcome.reason}`);
    if (outcome.result !== 'applied') applied = null;
  }

  const done = applied as { case_: Case; location: ChecklistItemLocation } | null;
  if (!done) return 'unchanged';
  await recordAutomaticCompletion(done.case_, done.location, trigger, dataAdapterMode);
  return 'completed';
}

/**
 * Several checklist items completed by ONE verified event, in ONE
 * revision-conditioned write (Send to Crematory, 2026-10: both crematory
 * paperwork items). `decideApplicable` re-checks, on the case as it is at
 * write time, that the event still holds — nothing is written otherwise.
 * Each item is decided by the shared rules (never on an archived case,
 * never twice, never over a staff tick); one activity event per item that
 * actually changed. Returns the keys completed.
 */
export async function completeChecklistItemsAutomatically(
  organizationId: string,
  caseId: string,
  trigger: AutomaticTrigger,
  locate: (case_: Case) => ChecklistItemLocation[],
  dataAdapterMode: DataAdapterMode,
  options: {
    decideApplicable?: (case_: Case) => boolean;
    actor?: { identityId: string; roleKey: string | null } | null;
    overrideEarlierReopen?: boolean;
    correlationId?: string;
  } = {},
): Promise<{ outcome: AutomaticCompletionOutcome; completedKeys: string[] }> {
  if (!isChecklistAutomationEnabled(organizationId)) return { outcome: 'not_applicable', completedKeys: [] };
  const now = new Date().toISOString();
  const completionOptions = { actorId: options.actor?.identityId ?? null, overrideEarlierReopen: options.overrideEarlierReopen === true };
  let applied: { case_: Case; locations: ChecklistItemLocation[] } | null = null;

  const decide = (case_: Case) => {
    applied = null;
    if (options.decideApplicable && !options.decideApplicable(case_)) return null;
    const locations: ChecklistItemLocation[] = [];
    const patch: { checklistState: Record<string, boolean>; checklistCompletions: NonNullable<Case['checklistCompletions']> } = { checklistState: {}, checklistCompletions: {} };
    for (const location of locate(case_)) {
      const one = automaticChecklistCompletion(case_, location, trigger, now, completionOptions);
      if (!one) continue;
      Object.assign(patch.checklistState, one.checklistState);
      Object.assign(patch.checklistCompletions, one.checklistCompletions);
      locations.push(location);
    }
    if (locations.length === 0) return null;
    applied = { case_, locations };
    return patch;
  };

  if (dataAdapterMode === 'mock') {
    const current = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    const patch = current ? decide(current) : null;
    if (current && patch) {
      writeMockCase(organizationId, caseId, (latest) => ({
        ...latest,
        checklistState: { ...latest.checklistState, ...patch.checklistState },
        checklistCompletions: { ...latest.checklistCompletions, ...patch.checklistCompletions },
      }));
    }
  } else {
    const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
      const patch = decide(row.case_);
      return patch ? buildCaseFieldPatch(row.data, patch) : null;
    });
    if (outcome.result === 'conflict') throw new Error(`Automatic checklist completion for case ${caseId} lost to concurrent writes on every attempt.`);
    if (outcome.result === 'failed') throw new Error(`Automatic checklist completion for case ${caseId} failed: ${outcome.reason}`);
    if (outcome.result !== 'applied') applied = null;
  }

  const done = applied as { case_: Case; locations: ChecklistItemLocation[] } | null;
  if (!done) return { outcome: 'unchanged', completedKeys: [] };
  for (const location of done.locations) {
    await recordAutomaticCompletion(done.case_, location, trigger, dataAdapterMode, options.correlationId, options.actor ?? null);
  }
  return { outcome: 'completed', completedKeys: done.locations.map((l) => checklistItemKey(l.displayStage, l.index)) };
}

/**
 * "Jotform application completed": the case's Arrangement Form submission
 * has been received and linked (the same evidence workflow reconciliation
 * uses to move past that stage). Called where a link is received — never
 * by historical imports or the repair action, so no existing case is
 * rewritten.
 */
export async function completeArrangementFormChecklistItem(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
  submissionId: string | null = null,
): Promise<AutomaticCompletionOutcome> {
  if (!isChecklistAutomationEnabled(organizationId)) return 'not_applicable';
  if (!(await isArrangementFormLinked(organizationId, caseId, dataAdapterMode))) return 'not_applicable';
  return completeChecklistItemAutomatically(
    organizationId,
    caseId,
    { source: 'verified_document_received', eventType: 'external_form.arrangement_received', eventId: submissionId },
    (case_) => findArrangementFormChecklistItem(case_.workflowSnapshot),
    dataAdapterMode,
  );
}
