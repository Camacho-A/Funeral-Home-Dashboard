import { evaluateDeadline, URGENT_HOURS_BEFORE_SERVICE, type EvaluatedDeadline, type PreparationTarget } from './deadlines';
import type {
  PreparationCondition,
  PreparationGroupDefinition,
  PreparationItemDefinition,
  PreparationItemRecord,
  PreparationStatus,
  PreparationTargetKey,
  ServiceEvent,
  ServicePreparationDefinition,
  ServicePreparationRecord,
} from './types';

/**
 * Service Readiness (Gus Phase 5B, 2026-11): where a service's preparation
 * stands, worked out from the definition, what staff recorded and the
 * service appointment. Pure — it reads nothing about the case's workflow
 * stage, so preparation can start before EDRS or any earlier stage, and it
 * returns nothing that could complete a workflow or legal step.
 */

export type EffectivePreparationStatus = PreparationStatus | 'needs_reconfirmation';

export type EvaluatedPreparationItem = {
  id: string;
  label: string;
  groupKey: string;
  groupLabel: string;
  kind: PreparationItemDefinition['kind'];
  /** Optional items may be Not requested; required ones may not. */
  mayBeNotRequested: boolean;
  status: EffectivePreparationStatus;
  record: PreparationItemRecord | null;
  done: boolean;
  /** Still has to happen before the service is ready. */
  blocking: boolean;
  beforeFamilyArrives: boolean;
  deadline: EvaluatedDeadline | null;
  supportingDocument: string | null;
};

export type PendingDecision = { choice: string; label: string };

export type ServiceReadiness = {
  definitionKey: string;
  serviceName: string;
  provisional: boolean;
  service: ServiceEvent | null;
  /** Whether cremation must wait for this service: undecided while the
      choice that decides it (Mass: body present?) is not made. */
  holdsCremation: boolean | 'undecided';
  decisions: PendingDecision[];
  items: EvaluatedPreparationItem[];
  counts: {
    completed: number;
    awaitingConfirmation: number;
    needsReconfirmation: number;
    attentionNeeded: number;
    upcomingDeadlines: number;
    urgentOrOverdue: number;
    notRequested: number;
    outstandingBeforeArrival: number;
  };
  /** Everything required is done and nothing is undecided. Operational
      only — never a statement about cremation authorization. */
  ready: boolean;
};

const RECORDED_FOR_A_DATE: ReadonlySet<PreparationStatus> = new Set(['awaiting_confirmation', 'confirmed', 'completed']);

function conditionState(condition: PreparationCondition, choices: Record<string, string>): boolean | 'undecided' {
  const value = choices[condition.choice];
  if (!value) return 'undecided';
  return condition.equals.includes(value);
}

function sameInstant(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && Date.parse(a as string) === Date.parse(b);
}

/** The service appointment for a case: this organization's and this
    case's only, of the service's type, never a cancelled one. An upcoming
    or open appointment wins over a completed one. */
export function selectServiceEvent(
  appointments: readonly { id: string; organizationId: string; caseId: string | null; appointmentType: string; startAt: string; endAt: string; status: ServiceEvent['status']; createdAt: string }[],
  params: { organizationId: string; caseId: string; appointmentType: string },
): ServiceEvent | null {
  const candidates = appointments.filter(
    (a) => a.organizationId === params.organizationId && a.caseId === params.caseId && a.appointmentType === params.appointmentType && a.status !== 'cancelled' && a.status !== 'no_show',
  );
  const open = candidates.filter((a) => a.status !== 'completed').sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const completed = candidates.filter((a) => a.status === 'completed').sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  const chosen = open[0] ?? completed[0];
  return chosen ? { appointmentId: chosen.id, startAt: chosen.startAt, endAt: chosen.endAt, status: chosen.status, bookedAt: chosen.createdAt } : null;
}

function evaluateItem(params: {
  item: PreparationItemDefinition;
  group: PreparationGroupDefinition;
  groupNotRequested: boolean;
  record: PreparationItemRecord | null;
  service: ServiceEvent | null;
  now: string;
  targets?: Readonly<Record<PreparationTargetKey, PreparationTarget>>;
}): EvaluatedPreparationItem {
  const { item, group, record, service } = params;
  const mayBeNotRequested = item.requirement === 'optional';
  let status: EffectivePreparationStatus = 'pending';
  if (params.groupNotRequested) status = 'not_requested';
  else if (record) {
    status = record.status === 'not_requested' && !mayBeNotRequested ? 'pending' : record.status;
    // A confirmation for another date and time is kept, but no longer
    // counts: it has to be confirmed again for the current one.
    if (item.dateDependent && RECORDED_FOR_A_DATE.has(record.status) && !(service && sameInstant(record.forServiceStartAt, service.startAt))) {
      status = 'needs_reconfirmation';
    }
  }
  const done = status === 'confirmed' || status === 'completed';
  const blocking = !done && status !== 'not_requested';
  const deadline =
    blocking && item.target && service ? evaluateDeadline({ target: item.target, serviceStartAt: service.startAt, bookedAt: service.bookedAt, now: params.now, targets: params.targets }) : null;
  return {
    id: item.id,
    label: item.label,
    groupKey: group.key,
    groupLabel: group.label,
    kind: item.kind,
    mayBeNotRequested,
    status,
    record,
    done,
    blocking,
    beforeFamilyArrives: item.beforeFamilyArrives,
    deadline,
    supportingDocument: item.supportingDocument ?? null,
  };
}

export function summarizeServiceReadiness(params: {
  definition: ServicePreparationDefinition;
  record: ServicePreparationRecord | null;
  service: ServiceEvent | null;
  now: string;
  targets?: Readonly<Record<PreparationTargetKey, PreparationTarget>>;
}): ServiceReadiness {
  const { definition, service } = params;
  const record = params.record && params.record.definitionKey === definition.key ? params.record : null;
  const choices = record?.choices ?? {};
  const choiceLabel = (key: string) => definition.choices.find((c) => c.key === key)?.label ?? key;
  const decisions = new Map<string, PendingDecision>();
  const items: EvaluatedPreparationItem[] = [];

  for (const choice of definition.choices) {
    if (!choices[choice.key]) decisions.set(choice.key, { choice: choice.key, label: choice.label });
  }

  for (const group of definition.groups) {
    if (group.appliesWhen && conditionState(group.appliesWhen, choices) !== true) continue;
    const groupNotRequested = group.requestedBy ? choices[group.requestedBy] === 'not_requested' : false;
    for (const item of group.items) {
      if (item.appliesWhen && conditionState(item.appliesWhen, choices) !== true) continue;
      items.push(evaluateItem({ item, group, groupNotRequested, record: record?.items[item.id] ?? null, service, now: params.now, targets: params.targets }));
    }
  }

  const holdsCremation = definition.holdsCremation === 'always' ? true : conditionState(definition.holdsCremation, choices);
  if (holdsCremation === 'undecided' && definition.holdsCremation !== 'always') {
    const key = definition.holdsCremation.choice;
    decisions.set(key, { choice: key, label: choiceLabel(key) });
  }

  const counts = {
    completed: items.filter((i) => i.done).length,
    awaitingConfirmation: items.filter((i) => i.status === 'awaiting_confirmation').length,
    needsReconfirmation: items.filter((i) => i.status === 'needs_reconfirmation').length,
    attentionNeeded: items.filter((i) => i.status === 'attention_needed').length,
    upcomingDeadlines: items.filter((i) => i.deadline && !i.deadline.needsReview).length,
    urgentOrOverdue: items.filter((i) => i.deadline?.needsReview || (i.blocking && i.beforeFamilyArrives && service && isWithinUrgentWindow(service, params.now))).length,
    notRequested: items.filter((i) => i.status === 'not_requested').length,
    outstandingBeforeArrival: items.filter((i) => i.blocking && i.beforeFamilyArrives).length,
  };

  return {
    definitionKey: definition.key,
    serviceName: definition.serviceName,
    provisional: definition.status === 'draft',
    service,
    holdsCremation,
    decisions: [...decisions.values()],
    items,
    counts,
    ready: Boolean(service) && decisions.size === 0 && items.every((i) => !i.blocking),
  };
}

function isWithinUrgentWindow(service: ServiceEvent, now: string): boolean {
  return Date.parse(now) >= Date.parse(service.startAt) - URGENT_HOURS_BEFORE_SERVICE * 60 * 60 * 1000;
}
