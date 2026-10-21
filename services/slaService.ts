import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { buildCaseFieldPatch } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { updateCaseWithRetry, writeMockCase } from './caseWriteService';
import {
  recordSlaDelayRecorded,
  recordSlaDelayResolved,
  recordSlaEventRecorded,
  type ActivityContext,
} from './activityService';
import { completeChecklistItemAutomatically } from './automaticChecklistCompletion';
import { notifySlaHardSaveDue } from './caseNotifications';
import { getOrganization } from './organizationProvisioningService';
import { reconcileCaseWorkflow } from './workflowReconciliationService';
import { syncExpectedPickupForCase } from './cremainsPickupService';
import { loadCaseOnServer } from './serverCaseLoader';
import type { Case, CaseUpdate } from '../types/case';
import {
  SLA_DELAY_REASONS,
  SLA_EVENT_KEYS,
  SLA_MILESTONE_KEYS,
  type SlaDelayReason,
  type SlaDelayRecord,
  type SlaEventKey,
  type SlaMilestoneKey,
  type SlaResponsibleParty,
} from '../types/sla';
import { isSlaTrackingEnabled, resolveSlaSettings } from '../domain/sla/slaSettings';
import {
  SLA_DELAY_REASON_LABEL,
  SLA_DELAY_REASON_PARTY,
  SLA_EVENT_LABEL,
  SLA_MILESTONE_LABEL,
  checklistItemsForEvent,
  evaluateCaseSla,
} from '../domain/sla/slaMilestones';
import { toLocalDate } from '../domain/sla/businessCalendar';
import { composeDecedentName } from '../domain/cases/decedentName';

/**
 * SLA tracking (2026-10) — the write side. Staff record what SOLIS cannot
 * see for itself (the doctor's attestation, the state's approval, the
 * crematory's receipt); SOLIS records what it does know (a received Vital
 * Statistics form). Every write is field-scoped and revision-conditioned,
 * refuses an archived case, and leaves an activity event. Recording an
 * event that a checklist item stands for completes that item too
 * (domain/workflow/checklistAutomation.ts — never over a staff decision).
 */

export class SlaActionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'SlaActionError';
  }
}

/** Allow a little clock skew between the browser and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

type CaseDecision = (case_: Case) => CaseUpdate | null;

/** Applies a decision to the case as it is now. Map fields merge per key. */
async function applyToCase(organizationId: string, caseId: string, decide: CaseDecision, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    const current = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    if (!current) throw new SlaActionError('Case not found.', 404);
    const patch = decide(current);
    if (!patch) return null;
    return writeMockCase(organizationId, caseId, (latest) => ({
      ...latest,
      ...patch,
      ...(patch.slaEvents ? { slaEvents: { ...latest.slaEvents, ...patch.slaEvents } } : {}),
      ...(patch.slaDelays ? { slaDelays: { ...latest.slaDelays, ...patch.slaDelays } } : {}),
    }));
  }
  const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
    const patch = decide(row.case_);
    return patch ? buildCaseFieldPatch(row.data, patch) : null;
  });
  if (outcome.result === 'not_found') throw new SlaActionError('Case not found.', 404);
  if (outcome.result === 'conflict') throw new SlaActionError('The case changed while this was being saved. Please try again.', 409);
  if (outcome.result === 'failed') throw new Error(`SLA update for case ${caseId} failed: ${outcome.reason}`);
  return outcome.result === 'applied' ? outcome.case_ : null;
}

function refuseArchived(case_: Case): void {
  if (case_.isDeleted) throw new SlaActionError('This case is archived and read-only.', 409);
}

function assertEnabled(organizationId: string): void {
  if (!isSlaTrackingEnabled(organizationId)) throw new SlaActionError('SLA tracking is not enabled for this organization.', 404);
}

async function slaSettingsFor(organizationId: string, dataAdapterMode: DataAdapterMode) {
  const organization = await getOrganization(organizationId, dataAdapterMode);
  return resolveSlaSettings(organization ?? { id: organizationId });
}

/**
 * Records when an SLA event happened. Re-recording the same time changes
 * nothing; a different time is a correction (the previous one is kept in
 * the activity record).
 */
export async function recordSlaEvent(
  ctx: ActivityContext,
  caseId: string,
  key: string,
  at: string,
  dataAdapterMode: DataAdapterMode,
  nowIso: string = new Date().toISOString(),
): Promise<Case | null> {
  assertEnabled(ctx.organizationId);
  if (!(SLA_EVENT_KEYS as readonly string[]).includes(key)) throw new SlaActionError('Unknown SLA event.', 400);
  const eventKey = key as SlaEventKey;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new SlaActionError('Enter a valid date and time.', 422);
  if (when.getTime() > new Date(nowIso).getTime() + FUTURE_TOLERANCE_MS) throw new SlaActionError('The time cannot be in the future.', 422);
  const atIso = when.toISOString();

  let previousAt: string | null = null;
  const written = await applyToCase(
    ctx.organizationId,
    caseId,
    (case_) => {
      refuseArchived(case_);
      previousAt = case_.slaEvents?.[eventKey]?.at ?? null;
      if (previousAt && new Date(previousAt).getTime() === when.getTime()) return null;
      return { slaEvents: { [eventKey]: { at: atIso, recordedAt: nowIso, recordedBy: ctx.actorIdentityId, source: 'staff' } } };
    },
    dataAdapterMode,
  );
  if (!written) return null;

  try {
    await recordSlaEventRecorded(ctx, caseId, { key: eventKey, label: SLA_EVENT_LABEL[eventKey], at: atIso, previousAt }, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record an SLA event activity:', error instanceof Error ? error.message : error);
  }

  // The checklist item(s) this event stands for complete with it — and then
  // exactly what a staff tick triggers: workflow reconciliation (which only
  // ever advances a genuinely complete stage) and the expected-pickup sync
  // (the crematory-paperwork items schedule it).
  let checklistChanged = false;
  for (const location of checklistItemsForEvent(written, eventKey)) {
    try {
      const outcome = await completeChecklistItemAutomatically(
        ctx.organizationId,
        caseId,
        { source: 'workflow_event', eventType: 'sla.event_recorded', eventId: eventKey },
        () => location,
        dataAdapterMode,
      );
      checklistChanged ||= outcome === 'completed';
    } catch (error) {
      console.error('Failed to complete a checklist item from an SLA event:', error instanceof Error ? error.message : error);
    }
  }
  if (checklistChanged) await afterChecklistCompleted(ctx, caseId, dataAdapterMode);

  if (eventKey === 'attestation_received') await announceHardSaveDue(ctx, written, atIso, dataAdapterMode, nowIso);
  return written;
}

async function afterChecklistCompleted(ctx: ActivityContext, caseId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  try {
    await reconcileCaseWorkflow(ctx.organizationId, caseId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to reconcile workflow after an SLA event:', error instanceof Error ? error.message : error);
  }
  try {
    const case_ = await loadCaseOnServer(ctx.organizationId, caseId, dataAdapterMode);
    const organization = await getOrganization(ctx.organizationId, dataAdapterMode);
    if (case_) {
      await syncExpectedPickupForCase(
        {
          case_,
          organization: organization ? { id: organization.id, timezone: organization.timezone, cremainsPickupSettings: organization.cremainsPickupSettings } : null,
          paperworkCompletedAt: new Date().toISOString(),
        },
        ctx,
        dataAdapterMode,
      );
    }
  } catch (error) {
    console.error('Failed to sync the expected cremains pickup after an SLA event:', error instanceof Error ? error.message : error);
  }
}

async function announceHardSaveDue(ctx: ActivityContext, case_: Case, attestationAt: string, dataAdapterMode: DataAdapterMode, nowIso: string): Promise<void> {
  try {
    const settings = await slaSettingsFor(ctx.organizationId, dataAdapterMode);
    const hardSave = evaluateCaseSla(case_, settings, nowIso).milestones.find((milestone) => milestone.key === 'hard_save');
    if (!hardSave || hardSave.state !== 'active' || !hardSave.deadline) return;
    const today = toLocalDate(new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date(nowIso)));
    const dueLabel =
      hardSave.deadline === today
        ? `today, by ${formatClock(settings.closingTime)}`
        : `on ${new Date(`${hardSave.deadline}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
    await notifySlaHardSaveDue(
      { ...ctx, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, isSystemGenerated: true },
      { case: { id: case_.id, caseNumber: case_.caseNumber, decedentName: composeDecedentName(case_.decedentName, case_.decedentMiddleName) }, attestationAt, dueLabel },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to announce a Hard Save deadline:', error instanceof Error ? error.message : error);
  }
}

function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Records an event SOLIS observed itself (a received Vital Statistics form).
 * The first time is kept: a later redelivery never moves it, and a time
 * staff already recorded is never overwritten.
 */
export async function recordSlaEventAutomatically(
  organizationId: string,
  caseId: string,
  key: SlaEventKey,
  at: string,
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  if (!isSlaTrackingEnabled(organizationId)) return false;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return false;
  const nowIso = new Date().toISOString();
  const written = await applyToCase(
    organizationId,
    caseId,
    (case_) => (case_.isDeleted || case_.slaEvents?.[key] ? null : { slaEvents: { [key]: { at: when.toISOString(), recordedAt: nowIso, recordedBy: null, source: 'automatic' } } }),
    dataAdapterMode,
  );
  if (!written) return false;
  try {
    await recordSlaEventRecorded(
      { organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: crypto.randomUUID(), isSystemGenerated: true },
      caseId,
      { key, label: SLA_EVENT_LABEL[key], at: when.toISOString(), previousAt: null },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record an automatic SLA event activity:', error instanceof Error ? error.message : error);
  }
  return true;
}

export type SlaDelayInput = {
  milestone: string;
  reason: string;
  responsibleParty?: string | null;
  notes?: string | null;
  expectedResolutionDate?: string | null;
};

const RESPONSIBLE_PARTIES: readonly SlaResponsibleParty[] = ['staff', 'family', 'doctor', 'medical_examiner', 'state', 'crematory', 'other'];

/**
 * Records a delay on a milestone. Any delay already open on that milestone
 * is resolved as "superseded" in the same write — the history stays, and
 * the deadline and overdue state are untouched.
 */
export async function recordSlaDelay(
  ctx: ActivityContext,
  caseId: string,
  input: SlaDelayInput,
  dataAdapterMode: DataAdapterMode,
  nowIso: string = new Date().toISOString(),
  idFactory: () => string = () => crypto.randomUUID(),
): Promise<Case | null> {
  assertEnabled(ctx.organizationId);
  if (!(SLA_MILESTONE_KEYS as readonly string[]).includes(input.milestone)) throw new SlaActionError('Unknown SLA milestone.', 400);
  if (!(SLA_DELAY_REASONS as readonly string[]).includes(input.reason)) throw new SlaActionError('Choose a delay reason.', 422);
  const reason = input.reason as SlaDelayReason;
  const milestone = input.milestone as SlaMilestoneKey;
  const party = input.responsibleParty ?? SLA_DELAY_REASON_PARTY[reason].party;
  if (!(RESPONSIBLE_PARTIES as readonly string[]).includes(party)) throw new SlaActionError('Choose who is responsible.', 422);
  const notes = input.notes?.trim() ? input.notes.trim().slice(0, 1000) : null;
  const expected = input.expectedResolutionDate ? toLocalDate(input.expectedResolutionDate) : null;
  if (input.expectedResolutionDate && !expected) throw new SlaActionError('Enter a valid expected resolution date.', 422);

  const id = idFactory();
  let supersededId: string | null = null;
  const written = await applyToCase(
    ctx.organizationId,
    caseId,
    (case_) => {
      refuseArchived(case_);
      const open = Object.values(case_.slaDelays ?? {}).filter((delay) => delay.milestone === milestone && delay.resolvedAt === null);
      supersededId = open[0]?.id ?? null;
      const superseded = Object.fromEntries(
        open.map((delay) => [delay.id, { ...delay, resolvedAt: nowIso, resolvedBy: ctx.actorIdentityId, resolution: 'superseded' as const }]),
      );
      const record: SlaDelayRecord = {
        id,
        milestone,
        reason,
        responsibleParty: party as SlaResponsibleParty,
        notes,
        expectedResolutionDate: expected,
        recordedAt: nowIso,
        recordedBy: ctx.actorIdentityId,
        resolvedAt: null,
        resolvedBy: null,
        resolution: null,
      };
      return { slaDelays: { ...superseded, [id]: record } };
    },
    dataAdapterMode,
  );
  if (!written) return null;
  try {
    await recordSlaDelayRecorded(
      ctx,
      caseId,
      {
        id,
        milestone,
        milestoneLabel: SLA_MILESTONE_LABEL[milestone],
        reason,
        reasonLabel: SLA_DELAY_REASON_LABEL[reason],
        responsibleParty: party,
        notes,
        expectedResolutionDate: expected,
        supersededId,
      },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record an SLA delay activity:', error instanceof Error ? error.message : error);
  }
  return written;
}

/** Marks a recorded delay resolved. Resolving one already resolved changes nothing. */
export async function resolveSlaDelay(
  ctx: ActivityContext,
  caseId: string,
  delayId: string,
  dataAdapterMode: DataAdapterMode,
  nowIso: string = new Date().toISOString(),
): Promise<Case | null> {
  assertEnabled(ctx.organizationId);
  let resolved: SlaDelayRecord | null = null;
  const written = await applyToCase(
    ctx.organizationId,
    caseId,
    (case_) => {
      refuseArchived(case_);
      const delay = case_.slaDelays?.[delayId];
      if (!delay) throw new SlaActionError('That delay was not found on this case.', 404);
      if (delay.resolvedAt) return null;
      resolved = delay;
      return { slaDelays: { [delayId]: { ...delay, resolvedAt: nowIso, resolvedBy: ctx.actorIdentityId, resolution: 'resolved' } } };
    },
    dataAdapterMode,
  );
  const delay = resolved as SlaDelayRecord | null;
  if (!written || !delay) return written;
  try {
    await recordSlaDelayResolved(
      ctx,
      caseId,
      { id: delayId, milestoneLabel: SLA_MILESTONE_LABEL[delay.milestone], reasonLabel: SLA_DELAY_REASON_LABEL[delay.reason] },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record an SLA delay resolution:', error instanceof Error ? error.message : error);
  }
  return written;
}
