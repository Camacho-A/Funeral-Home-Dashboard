'use client';

import { useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useServicePreparation } from '@/hooks/useServicePreparation';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { servicePreparationFor } from '@/domain/servicePreparation/serviceDefinitions';
import { summarizeServiceReadiness, type EvaluatedPreparationItem, type EffectivePreparationStatus } from '@/domain/servicePreparation/readiness';
import { RELEASE_FOR_CREMATION_UNAVAILABLE_REASON } from '@/domain/servicePreparation/releaseForCremation';
import { DEADLINE_STATE_LABEL } from '@/domain/servicePreparation/deadlines';
import { PREPARATION_STATUS_LABEL, type PreparationDetailDefinition, type PreparationStatus, type PreparationValueRecord, type ServicePreparationDefinition } from '@/domain/servicePreparation/types';
import type { PreparationChange } from '@/domain/servicePreparation/preparationUpdates';
import { formatAppointmentDate, formatAppointmentTime } from '@/utils/scheduling';
import type { Case } from '@/types/case';
import styles from './ServiceReadinessCard.module.css';

/**
 * Service Readiness (Gus Phase 5B/5C, 2026-11). Preparing a service held
 * before cremation, on its own and apart from the case's workflow, so it
 * can be worked while EDRS or any earlier stage is open.
 *
 * Staff answer the family's choices, fill in details, and set each item's
 * status; every save goes to the server (services/servicePreparationService.ts),
 * which records who and when, keeps the history in Activity, and refuses a
 * change to something someone else changed meanwhile (the latest is then
 * shown). The service's date and time come from its appointment in the
 * Schedule tab. Nothing here completes a cremation, permit, medical
 * examiner or crematory step, or moves the workflow.
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

function statusOptions(item: EvaluatedPreparationItem): PreparationStatus[] {
  const base: PreparationStatus[] = item.kind === 'confirmation' ? ['pending', 'awaiting_confirmation', 'confirmed', 'attention_needed'] : ['pending', 'completed', 'attention_needed'];
  return item.mayBeNotRequested ? [...base, 'not_requested'] : base;
}

function when(iso: string, timezone: string): string {
  return `${formatAppointmentDate(iso, timezone)}, ${formatAppointmentTime(iso, timezone)}`;
}

function deadlineText(item: EvaluatedPreparationItem, timezone: string): string | null {
  if (!item.deadline) return null;
  if (item.deadline.state === 'short_notice') return DEADLINE_STATE_LABEL.short_notice;
  if (item.deadline.state === 'overdue') return `Overdue — was due ${when(item.deadline.dueAt, timezone)}`;
  return `${item.deadline.urgent ? 'Urgent — due' : 'Due by'} ${when(item.deadline.dueAt, timezone)}`;
}

function byLine(entry: { at: string; byName?: string | null } | null | undefined, timezone: string): string | null {
  if (!entry) return null;
  return `${entry.byName ?? 'Staff'} · ${when(entry.at, timezone)}`;
}

function DetailInput({ detail, entry, disabled, onSave }: { detail: PreparationDetailDefinition; entry: PreparationValueRecord | undefined; disabled: boolean; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = `prep-detail-${detail.key}`;
  if (detail.kind === 'select') {
    return (
      <label className={styles.detail} htmlFor={id}>
        <span>{detail.label}</span>
        <SelectField id={id} value={entry?.value ?? ''} disabled={disabled} onChange={(e) => e.target.value && onSave(e.target.value)}>
          <option value="">Choose…</option>
          {detail.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </label>
    );
  }
  const value = draft ?? entry?.value ?? '';
  return (
    <label className={styles.detail} htmlFor={id}>
      <span>{detail.label}</span>
      <TextField
        id={id}
        type={detail.kind === 'phone' ? 'tel' : detail.kind === 'number' ? 'number' : 'text'}
        {...(detail.kind === 'number' ? { min: 0, max: detail.max, inputMode: 'numeric' as const } : {})}
        value={value}
        maxLength={300}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== (entry?.value ?? '')) onSave(draft);
          setDraft(null);
        }}
      />
    </label>
  );
}

function ItemRow({
  item,
  timezone,
  documents,
  disabled,
  onSave,
}: {
  item: EvaluatedPreparationItem;
  timezone: string;
  documents: { id: string; fileName: string }[];
  disabled: boolean;
  onSave: (change: Omit<Extract<PreparationChange, { kind: 'item' }>, 'kind' | 'itemId'>) => void;
}) {
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const due = deadlineText(item, timezone);
  const record = item.record;
  const storedStatus: PreparationStatus = record?.status ?? 'pending';
  const linked = documents.find((d) => d.id === record?.documentId);
  const selectId = `prep-status-${item.id}`;
  // Switched off by the family's "Not requested" answer above, not by this item.
  const notRequestedByChoice = item.status === 'not_requested' && storedStatus !== 'not_requested';
  return (
    <li className={styles.item} data-testid={`prep-item-${item.id}`}>
      <div className={styles.itemMain}>
        <span className={styles.itemLabel}>
          <label htmlFor={selectId}>{item.label}</label>
          {record && item.status !== 'pending' && <span className={styles.itemHint}>{byLine(record, timezone)}</span>}
          {item.status === 'needs_reconfirmation' && record?.forServiceStartAt && (
            <span className={styles.reconfirm}>Was confirmed for {when(record.forServiceStartAt, timezone)} — the service has moved.</span>
          )}
          {record?.note && <span className={styles.itemHint}>Note: {record.note}</span>}
        </span>
        <span className={styles.itemMeta}>
          {due && <span className={item.deadline?.needsReview ? styles.dueAlert : styles.due}>{due}</span>}
          <Badge variant={STATUS_VARIANT[item.status]}>{statusLabel(item.status)}</Badge>
        </span>
      </div>
      {notRequestedByChoice ? (
        <span className={styles.itemHint}>Not requested by the family — change it under Family choices.</span>
      ) : !disabled ? (
        <div className={styles.controls}>
          <SelectField
            id={selectId}
            aria-label={`Status of ${item.label}`}
            value={storedStatus}
            onChange={(e) => onSave({ status: e.target.value as PreparationStatus })}
          >
            {statusOptions(item).map((s) => (
              <option key={s} value={s}>
                {s === storedStatus && item.status === 'needs_reconfirmation' ? `${PREPARATION_STATUS_LABEL[s]} (old date)` : PREPARATION_STATUS_LABEL[s]}
              </option>
            ))}
          </SelectField>
          {item.status === 'needs_reconfirmation' && (
            <button type="button" className={styles.smallButton} onClick={() => onSave({ status: storedStatus })}>
              Confirm for the new date
            </button>
          )}
          {item.supportingDocument && (
            <SelectField
              aria-label={`Supporting document for ${item.label}`}
              value={record?.documentId ?? ''}
              onChange={(e) => onSave({ status: storedStatus, documentId: e.target.value || null })}
            >
              <option value="">{documents.length ? `Link ${item.supportingDocument.toLowerCase()}…` : 'No documents on this case yet'}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName}
                </option>
              ))}
            </SelectField>
          )}
          {noteDraft === null ? (
            <button type="button" className={styles.linkButton} onClick={() => setNoteDraft(record?.note ?? '')}>
              {record?.note ? 'Edit note' : 'Add note'}
            </button>
          ) : (
            <span className={styles.noteEditor}>
              <TextField aria-label={`Note for ${item.label}`} value={noteDraft} maxLength={300} onChange={(e) => setNoteDraft(e.target.value)} />
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => {
                  onSave({ status: storedStatus, note: noteDraft });
                  setNoteDraft(null);
                }}
              >
                Save note
              </button>
              <button type="button" className={styles.linkButton} onClick={() => setNoteDraft(null)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      ) : (
        linked && <span className={styles.itemHint}>Document: {linked.fileName}</span>
      )}
      {!disabled && linked && <span className={styles.itemHint}>Linked: {linked.fileName}</span>}
    </li>
  );
}

export function ServiceReadinessCard({ case_, now, onOpenDocuments }: { case_: Case; now?: string; onOpenDocuments?: () => void }) {
  const { organizationId } = useOrganization();
  const organizationRecord = useOrganizationRecord();
  const enabled = getRegisteredOrganizationProfile(organizationId).features.servicePreparation;
  const definition: ServicePreparationDefinition | null = enabled ? servicePreparationFor(case_.workflowSnapshot?.serviceTypeCode) : null;
  const { query, save } = useServicePreparation(organizationId, case_.id, Boolean(definition));
  if (!definition) return null;

  if (query.isPending) {
    return (
      <section aria-label="Service readiness" className={styles.card} aria-busy="true">
        <span className="sx-skeleton" style={{ width: '60%' }} />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section aria-label="Service readiness" className={styles.card}>
        <p className={styles.note} role="alert">The service preparation could not be loaded. Please refresh the page.</p>
      </section>
    );
  }

  const { preparation, canEdit, release } = query.data;
  const timezone = organizationRecord.data?.timezone ?? 'America/New_York';
  const { record, service } = preparation;
  const readiness = summarizeServiceReadiness({ definition, record, service, now: now ?? new Date().toISOString() });
  const editable = canEdit && preparation.storageAvailable && !preparation.isArchived && !record?.release;
  const disabled = !editable || save.isPending;
  const groups = [...new Map(readiness.items.map((i) => [i.groupKey, i.groupLabel])).entries()];
  const total = readiness.items.filter((i) => i.status !== 'not_requested').length;
  const send = (change: PreparationChange, basisAt: string | null) => save.mutate({ change, basisAt });
  const activeDetails = definition.groups.filter((g) => g.details && readiness.items.some((i) => i.groupKey === g.key));

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
        {service
          ? `${when(service.startAt, timezone)} – ${formatAppointmentTime(service.endAt, timezone)}${service.status === 'completed' ? ' · completed' : ''}`
          : `No ${readiness.serviceName} scheduled yet. Add it in the Schedule tab; the deadlines are worked out from it.`}
      </p>
      <p className={styles.separate}>Separate from the cremation steps: nothing here completes the authorization, permit, medical examiner approval or sending to the crematory.</p>

      <dl className={styles.kpis}>
        <div><dt>Completed</dt><dd>{readiness.counts.completed} of {total}</dd></div>
        <div><dt>Awaiting confirmation</dt><dd>{readiness.counts.awaitingConfirmation}</dd></div>
        <div className={readiness.counts.needsReconfirmation > 0 ? styles.kpiWarn : undefined}><dt>Confirm again</dt><dd>{readiness.counts.needsReconfirmation}</dd></div>
        <div className={readiness.counts.urgentOrOverdue > 0 ? styles.kpiAlert : undefined}><dt>Urgent or overdue</dt><dd>{readiness.counts.urgentOrOverdue}</dd></div>
        <div><dt>Before the family arrives</dt><dd>{readiness.counts.outstandingBeforeArrival} open</dd></div>
      </dl>

      {save.isError && (
        <p className="sx-form-banner sx-form-banner-error" role="alert">
          {save.error.message}
        </p>
      )}
      {!preparation.storageAvailable && <p className={styles.notice} role="note">{SERVICE_PREPARATION_STORAGE_PENDING}</p>}
      {preparation.isArchived && <p className={styles.notice} role="note">This case is archived; its preparation is read-only.</p>}
      {preparation.storageAvailable && !canEdit && <p className={styles.notice} role="note">You can view the preparation; changing it needs permission to edit cases.</p>}

      <div className={styles.sectionLabel}>Family choices</div>
      <div className={styles.choices}>
        {definition.choices.map((choice) => {
          const entry = record?.choices[choice.key];
          const id = `prep-choice-${choice.key}`;
          return (
            <label key={choice.key} className={styles.detail} htmlFor={id}>
              <span>
                {choice.label}
                {!entry && <span className={styles.toDecide}> · to decide</span>}
              </span>
              <SelectField id={id} value={entry?.value ?? ''} disabled={disabled} onChange={(e) => e.target.value && send({ kind: 'choice', choice: choice.key, value: e.target.value }, entry?.at ?? null)}>
                <option value="">Not decided</option>
                {choice.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            </label>
          );
        })}
      </div>

      {activeDetails.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Details</div>
          <div className={styles.choices}>
            {activeDetails.flatMap((group) =>
              (group.details ?? []).map((detail) => (
                <DetailInput
                  key={detail.key}
                  detail={detail}
                  entry={record?.details[detail.key]}
                  disabled={disabled}
                  onSave={(value) => send({ kind: 'detail', key: detail.key, value }, record?.details[detail.key]?.at ?? null)}
                />
              )),
            )}
          </div>
        </>
      )}

      {groups.map(([groupKey, groupLabel]) => (
        <div key={groupKey}>
          <div className={styles.sectionLabel}>{groupLabel}</div>
          <ul className={styles.items}>
            {readiness.items
              .filter((i) => i.groupKey === groupKey)
              .map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  timezone={timezone}
                  documents={preparation.documents}
                  disabled={disabled}
                  onSave={(fields) => send({ kind: 'item', itemId: item.id, ...fields }, item.record?.at ?? null)}
                />
              ))}
          </ul>
        </div>
      ))}

      {onOpenDocuments && (
        <p className={styles.note}>
          Supporting documents are kept in the{' '}
          <button type="button" className={styles.linkButton} onClick={onOpenDocuments}>
            Documents tab
          </button>
          ; upload them there, then link them to an item here.
        </p>
      )}

      {(record?.history?.length ?? 0) > 0 && (
        <details className={styles.history} data-testid="prep-history">
          <summary>Preparation history ({record!.history!.length})</summary>
          <p className={styles.note}>Saved with each change on the case itself — complete even if an entry is missing from the Activity tab.</p>
          <ol className={styles.historyList}>
            {[...record!.history!].reverse().map((entry) => (
              <li key={entry.eventId}>
                <span>{entry.description}</span>
                <span className={styles.itemHint}>{byLine({ at: entry.at, byName: entry.actorName }, timezone)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {readiness.warnings.map((w) => (
        <p key={w} className={styles.notice} role="note">
          {w}
        </p>
      ))}

      {readiness.holdsCremation !== false && (
        <div className={styles.release} aria-label="Release for cremation">
          <div className={styles.sectionLabel}>Release for cremation</div>
          <p className={styles.note}>
            Telling the crematory about the service is not a release. The cremation paperwork is released only after the {readiness.serviceName.toLowerCase()} is completed, every
            requirement below is met, and a verified, licensed funeral director approves.
          </p>
          {readiness.holdsCremation === 'undecided' && <p className={styles.note}>Whether cremation waits for this service depends on a choice above.</p>}
          {release && (
            <ul className={styles.requirements} data-testid="release-prerequisites">
              {release.prerequisites.map((r) => (
                <li key={r.key} className={r.met ? styles.met : styles.unmet}>
                  {r.met ? '✓' : '○'} {r.label}
                  {!r.met && r.detail && <span className={styles.itemHint}> — {r.detail}</span>}
                  <span className="sr-only">{r.met ? ' — done' : ' — not yet'}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={styles.releaseButton} disabled aria-describedby={`release-unavailable-${case_.id}`}>
            Release for cremation
          </button>
          <p id={`release-unavailable-${case_.id}`} className={styles.note}>
            {release?.unavailableReason ?? RELEASE_FOR_CREMATION_UNAVAILABLE_REASON}
          </p>
        </div>
      )}
    </section>
  );
}

export const SERVICE_PREPARATION_STORAGE_PENDING =
  'Saving preparation is not available on this site yet: the case field that stores it has not been added. This list shows what is needed and when.';
