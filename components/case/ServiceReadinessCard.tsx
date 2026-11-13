'use client';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useCaseAppointments } from '@/hooks/useAppointments';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { servicePreparationFor } from '@/domain/servicePreparation/serviceDefinitions';
import { selectServiceEvent, summarizeServiceReadiness, type EvaluatedPreparationItem, type EffectivePreparationStatus } from '@/domain/servicePreparation/readiness';
import { evaluateReleaseForCremation, LEGAL_REQUIREMENTS_STILL_CHECKED } from '@/domain/servicePreparation/releaseForCremation';
import { DEADLINE_STATE_LABEL } from '@/domain/servicePreparation/deadlines';
import { PREPARATION_STATUS_LABEL } from '@/domain/servicePreparation/types';
import { formatAppointmentDate, formatAppointmentTime } from '@/utils/scheduling';
import type { Case } from '@/types/case';
import styles from './ServiceReadinessCard.module.css';

/**
 * Service Readiness (Gus Phase 5B, 2026-11). Where the preparation for a
 * service held before cremation stands — on its own, apart from the case's
 * workflow, so it can be worked while EDRS or any earlier stage is open.
 *
 * READ-ONLY for now: the service's date and time come from its appointment
 * (the Schedule tab), and the deadlines are worked out from it, but
 * recording preparation needs the `servicePreparation` case field, which
 * is awaiting approval (docs/SERVICE_PREPARATION.md). Nothing here is kept
 * in the browser as a stand-in for that storage.
 *
 * Shown only to organizations with service preparation (Gus), on cases
 * whose service has one. Direct Cremation and Manors never see it.
 */
const STATUS_VARIANT: Record<EffectivePreparationStatus, BadgeVariant> = {
  pending: 'neutral',
  awaiting_confirmation: 'brand',
  confirmed: 'success',
  completed: 'success',
  not_requested: 'neutral',
  attention_needed: 'danger',
  needs_reconfirmation: 'warning',
};

const statusLabel = (status: EffectivePreparationStatus) => (status === 'needs_reconfirmation' ? 'Confirm again for the new date' : PREPARATION_STATUS_LABEL[status]);

export const SERVICE_PREPARATION_STORAGE_PENDING =
  'Recording preparation is not available yet: the case field that saves it is awaiting approval. Until then this list shows what is needed and when.';

function deadlineText(item: EvaluatedPreparationItem, timezone: string): string | null {
  if (!item.deadline) return null;
  const due = `${formatAppointmentDate(item.deadline.dueAt, timezone)}, ${formatAppointmentTime(item.deadline.dueAt, timezone)}`;
  if (item.deadline.state === 'short_notice') return DEADLINE_STATE_LABEL.short_notice;
  if (item.deadline.state === 'overdue') return `Overdue — was due ${due}`;
  return `${item.deadline.urgent ? 'Urgent — due' : 'Due by'} ${due}`;
}

export function ServiceReadinessCard({ case_, now }: { case_: Case; now?: string }) {
  const { organizationId } = useOrganization();
  const organizationRecord = useOrganizationRecord();
  const enabled = getRegisteredOrganizationProfile(organizationId).features.servicePreparation;
  const definition = enabled ? servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode) : null;
  const appointmentsQuery = useCaseAppointments(definition ? organizationId : '', case_.id);
  if (!definition) return null;

  const timezone = organizationRecord.data?.timezone ?? 'America/New_York';
  const service = selectServiceEvent(appointmentsQuery.data ?? [], { organizationId, caseId: case_.id, appointmentType: definition.serviceAppointmentType });
  const readiness = summarizeServiceReadiness({ definition, record: null, service, now: now ?? new Date().toISOString() });
  const release = evaluateReleaseForCremation({ readiness, record: null, actorMayRelease: false });
  const groups = [...new Map(readiness.items.map((i) => [i.groupKey, i.groupLabel])).entries()];
  const total = readiness.items.filter((i) => i.status !== 'not_requested').length;

  return (
    <section aria-label="Service readiness" className={styles.card} data-testid="service-readiness">
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Service readiness</div>
          <h2 className={styles.title}>{readiness.serviceName} preparation</h2>
        </div>
        {readiness.provisional && <Badge variant="warning">Draft — awaiting funeral director approval</Badge>}
      </div>

      <p className={styles.service}>
        {appointmentsQuery.isPending
          ? 'Loading the schedule…'
          : service
            ? `${formatAppointmentDate(service.startAt, timezone)}, ${formatAppointmentTime(service.startAt, timezone)} – ${formatAppointmentTime(service.endAt, timezone)}${service.status === 'completed' ? ' · completed' : ''}`
            : `No ${readiness.serviceName} scheduled yet. Add it in the Schedule tab; the deadlines below are worked out from it.`}
      </p>
      <p className={styles.separate}>Separate from the cremation steps: nothing here completes the authorization, permit, medical examiner approval or sending to the crematory.</p>

      <dl className={styles.kpis}>
        <div><dt>Completed</dt><dd>{readiness.counts.completed} of {total}</dd></div>
        <div><dt>Awaiting confirmation</dt><dd>{readiness.counts.awaitingConfirmation}</dd></div>
        <div><dt>Upcoming deadlines</dt><dd>{readiness.counts.upcomingDeadlines}</dd></div>
        <div className={readiness.counts.urgentOrOverdue > 0 ? styles.kpiAlert : undefined}><dt>Urgent or overdue</dt><dd>{readiness.counts.urgentOrOverdue}</dd></div>
        <div><dt>Before the family arrives</dt><dd>{readiness.counts.outstandingBeforeArrival} open</dd></div>
      </dl>

      {readiness.decisions.length > 0 && (
        <>
          <div className={styles.sectionLabel}>To decide with the family</div>
          <ul className={styles.decisions}>
            {readiness.decisions.map((d) => (
              <li key={d.choice}>{d.label}</li>
            ))}
          </ul>
        </>
      )}

      {groups.map(([groupKey, groupLabel]) => (
        <div key={groupKey}>
          <div className={styles.sectionLabel}>{groupLabel}</div>
          <ul className={styles.items}>
            {readiness.items
              .filter((i) => i.groupKey === groupKey)
              .map((item) => {
                const due = deadlineText(item, timezone);
                return (
                  <li key={item.id} className={styles.item} data-testid={`prep-item-${item.id}`}>
                    <span className={styles.itemLabel}>
                      {item.label}
                      {item.supportingDocument && <span className={styles.itemHint}>Document: {item.supportingDocument} (Documents tab)</span>}
                    </span>
                    <span className={styles.itemMeta}>
                      {due && <span className={item.deadline?.needsReview ? styles.dueAlert : styles.due}>{due}</span>}
                      <Badge variant={STATUS_VARIANT[item.status]}>{statusLabel(item.status)}</Badge>
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}

      <p className={styles.notice} role="note">{SERVICE_PREPARATION_STORAGE_PENDING}</p>

      {release.applies !== false && (
        <div className={styles.release} aria-label="Release for cremation">
          <div className={styles.sectionLabel}>Release for cremation</div>
          {release.applies === 'undecided' && <p className={styles.note}>Whether cremation waits for this service depends on a choice above.</p>}
          <ul className={styles.requirements}>
            {release.requirements.map((r) => (
              <li key={r.key} className={r.met ? styles.met : styles.unmet}>
                {r.met ? '✓' : '○'} {r.label}
                <span className="sr-only">{r.met ? ' — done' : ' — not yet'}</span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>Still required and checked by the cremation steps, not by this release: {LEGAL_REQUIREMENTS_STILL_CHECKED.join('; ')}.</p>
          <button type="button" className={styles.releaseButton} disabled aria-describedby={`release-unavailable-${case_.id}`}>
            Release for cremation
          </button>
          <p id={`release-unavailable-${case_.id}`} className={styles.note}>{release.unavailableReason}</p>
        </div>
      )}
    </section>
  );
}
