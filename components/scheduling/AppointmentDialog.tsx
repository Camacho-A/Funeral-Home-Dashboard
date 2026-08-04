'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { SelectField } from '@/components/ui/SelectField';
import { Checkbox } from '@/components/ui/Checkbox';
import { Badge } from '@/components/ui/Badge';
import { APPOINTMENT_TYPES, APPOINTMENT_TYPE_CATEGORY_LABEL, type AppointmentTypeCategory } from '@/domain/scheduling/appointmentTypeRegistry';
import { resourceStatusVariant, RESOURCE_STATUS_LABEL } from '@/domain/scheduling/appointmentDisplay';
import { useResources } from '@/hooks/useResources';
import { useCreateAppointment } from '@/hooks/useAppointments';
import { SchedulingConflictError, type ConflictDetail } from '@/lib/appointmentsClient';
import { ConflictResolutionDialog } from './ConflictResolutionDialog';
import styles from './AppointmentDialog.module.css';

const CATEGORIES: AppointmentTypeCategory[] = ['family_facing', 'operational', 'internal'];
const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Phase 27 (Scheduling & Resource Management). Structural twin of
 * `RequestSignatureDialog.tsx` — an appointment-type dropdown sourced from
 * the registry (grouped by category), title/notes, start/end date-time,
 * a resource multi-select, an optional recurrence sub-form, and Save (as
 * Draft — automatic when no resources are selected — or Scheduled).
 *
 * No case-search picker exists anywhere in this codebase yet (only an
 * unrelated dashboard search-box context) — building one is out of
 * proportion to this dialog, so when `caseId` isn't supplied by the
 * caller (i.e. opened from the org-wide Calendar rather than a Case
 * Schedule tab), a plain optional "Case ID" text field is offered instead
 * of a live picker.
 */
export function AppointmentDialog({
  open,
  onClose,
  organizationId,
  caseId,
  defaultStartAt,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  /** When supplied (Case Schedule tab), the case is fixed and not editable. */
  caseId?: string;
  /** ISO string to pre-fill the start time with (e.g. a clicked calendar slot). */
  defaultStartAt?: string;
}) {
  const resourcesQuery = useResources(organizationId);
  const createAppointment = useCreateAppointment(organizationId);

  const [appointmentType, setAppointmentType] = useState<string>(APPOINTMENT_TYPES.FAMILY_MEETING.key);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [freeCaseId, setFreeCaseId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [interval, setInterval_] = useState(1);
  const [count, setCount] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<ConflictDetail[] | null>(null);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!open) return;
    const defaultStart = defaultStartAt ? new Date(defaultStartAt) : new Date();
    const defaultEnd = new Date(defaultStart.getTime() + 60 * 60_000);
    setAppointmentType(APPOINTMENT_TYPES.FAMILY_MEETING.key);
    setTitle('');
    setNotes('');
    setFreeCaseId('');
    setStartAt(toDateTimeLocal(defaultStart));
    setEndAt(toDateTimeLocal(defaultEnd));
    setSelectedResourceIds([]);
    setSaveAsDraft(false);
    setIsRecurring(false);
    setFrequency('weekly');
    setInterval_(1);
    setCount(4);
    setError(null);
    setPendingConflicts(null);
  }, [open, defaultStartAt]);

  const resources = resourcesQuery.data ?? [];

  function toggleResource(resourceId: string) {
    setSelectedResourceIds((current) => (current.includes(resourceId) ? current.filter((id) => id !== resourceId) : [...current, resourceId]));
  }

  async function submit(override?: { reason: string }) {
    if (!title.trim() || !startAt || !endAt) return;
    setError(null);
    try {
      await createAppointment.mutateAsync({
        caseId: caseId ?? (freeCaseId.trim() || undefined),
        appointmentType,
        title: title.trim(),
        notes: notes.trim() || undefined,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        timezone,
        resourceIds: selectedResourceIds,
        saveAsDraft,
        recurrence: isRecurring ? { frequency, interval, count } : undefined,
        override,
      });
      setPendingConflicts(null);
      onClose();
    } catch (err) {
      if (err instanceof SchedulingConflictError) {
        setPendingConflicts(err.conflicts);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to create the appointment.');
    }
  }

  return (
    <>
      <Modal open={open && !pendingConflicts} onClose={onClose} title="New Appointment">
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="appointment-type">
              Appointment type
            </label>
            <SelectField id="appointment-type" value={appointmentType} onChange={(e) => setAppointmentType(e.target.value)}>
              {CATEGORIES.map((category) => (
                <optgroup key={category} label={APPOINTMENT_TYPE_CATEGORY_LABEL[category]}>
                  {Object.values(APPOINTMENT_TYPES)
                    .filter((def) => def.category === category)
                    .map((def) => (
                      <option key={def.key} value={def.key}>
                        {def.displayName}
                      </option>
                    ))}
                </optgroup>
              ))}
            </SelectField>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="appointment-title">
              Title
            </label>
            <TextField id="appointment-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>

          {!caseId && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="appointment-case-id">
                Case ID (optional)
              </label>
              <TextField id="appointment-case-id" value={freeCaseId} onChange={(e) => setFreeCaseId(e.target.value)} placeholder="Leave blank for an internal appointment" />
            </div>
          )}

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="appointment-start">
                Starts
              </label>
              <TextField id="appointment-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="appointment-end">
                Ends
              </label>
              <TextField id="appointment-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="appointment-notes">
              Notes
            </label>
            <TextArea id="appointment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Resources</span>
            {resourcesQuery.isPending ? (
              <span className={styles.hint}>Loading resources…</span>
            ) : resources.length === 0 ? (
              <span className={styles.hint}>No resources have been created for this organization yet.</span>
            ) : (
              <div className={styles.resourceList}>
                {resources.map((resource) => (
                  <label key={resource.id} className={styles.resourceRow}>
                    <Checkbox
                      checked={selectedResourceIds.includes(resource.id)}
                      onChange={() => toggleResource(resource.id)}
                      aria-label={`Assign ${resource.name}`}
                    />
                    <span className={styles.resourceName}>{resource.name}</span>
                    <Badge variant={resourceStatusVariant(resource.status)}>{RESOURCE_STATUS_LABEL[resource.status]}</Badge>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className={styles.inlineCheckbox}>
            <Checkbox checked={saveAsDraft} onChange={() => setSaveAsDraft((v) => !v)} aria-label="Save as draft" />
            <span>Save as draft (no conflict check yet — resources can be finalized later)</span>
          </label>

          <label className={styles.inlineCheckbox}>
            <Checkbox checked={isRecurring} onChange={() => setIsRecurring((v) => !v)} aria-label="Make this a recurring appointment" />
            <span>Recurring</span>
          </label>

          {isRecurring && (
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recurrence-frequency">
                  Frequency
                </label>
                <SelectField id="recurrence-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                  {RECURRENCE_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recurrence-interval">
                  Every
                </label>
                <TextField id="recurrence-interval" type="number" min={1} value={interval} onChange={(e) => setInterval_(Number(e.target.value) || 1)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recurrence-count">
                  Occurrences
                </label>
                <TextField id="recurrence-count" type="number" min={1} max={104} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
              </div>
            </div>
          )}

          {error && <span className={styles.error}>{error}</span>}

          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => submit()} disabled={!title.trim() || !startAt || !endAt || createAppointment.isPending}>
              {createAppointment.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      {pendingConflicts && (
        <ConflictResolutionDialog
          open
          conflicts={pendingConflicts}
          onClose={() => setPendingConflicts(null)}
          onOverride={(reason) => submit({ reason })}
          isSubmitting={createAppointment.isPending}
        />
      )}
    </>
  );
}
